'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { canonicalJson } = require('./canonical-json.cjs');
const { validateEnvelope } = require('./schema-validator.cjs');

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function resolveInside(root, relative) {
  const base = path.resolve(root);
  const target = path.resolve(base, relative);
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) throw new Error('OUTBOX_UNWRITABLE: path escapes output directory');
  return target;
}

function ensureTelemetryDir(outputDir) {
  const directory = resolveInside(outputDir, 'telemetry');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('OUTBOX_UNWRITABLE: telemetry path is unsafe');
  try { fs.chmodSync(directory, 0o700); } catch {}
  return directory;
}

function withLock(outputDir, fn) {
  const directory = ensureTelemetryDir(outputDir);
  const lockPath = path.join(directory, 'database.lock');
  let fd;
  try {
    fd = fs.openSync(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') {
      let stale = false;
      try {
        const stat = fs.lstatSync(lockPath);
        const pid = Number(fs.readFileSync(lockPath, 'utf8').trim());
        let alive = Number.isInteger(pid) && pid > 0;
        if (alive) {
          try { process.kill(pid, 0); } catch (probe) { if (probe.code === 'ESRCH') alive = false; }
        }
        stale = stat.isFile() && !stat.isSymbolicLink() && !alive && Date.now() - stat.mtimeMs > 300000;
      } catch {}
      if (stale) {
        fs.unlinkSync(lockPath);
        fd = fs.openSync(lockPath, 'wx', 0o600);
      } else throw new Error('OUTBOX_UNWRITABLE: database lock is held');
    } else throw error;
  }
  try {
    fs.writeFileSync(fd, `${process.pid}\n`, 'utf8');
    fs.fsyncSync(fd);
    return fn();
  } finally {
    try { fs.closeSync(fd); } catch {}
    try { fs.unlinkSync(lockPath); } catch {}
  }
}

function findByIdempotency(records, runId, idempotencyKey) {
  return records.find((record) => (runId == null || record.envelope.run_id === runId) && record.envelope.idempotency_key === idempotencyKey) || null;
}

function readLines(file, recoverTail = false) {
  if (!fs.existsSync(file)) return { records: [], recovered: false };
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('OUTBOX_CORRUPT: outbox must be a regular file');
  const text = fs.readFileSync(file, 'utf8');
  const hasTail = text.length > 0 && !text.endsWith('\n');
  if (hasTail && !recoverTail) throw new Error('OUTBOX_CORRUPT: incomplete tail');
  const complete = hasTail ? text.slice(0, text.lastIndexOf('\n') + 1) : text;
  if (hasTail) {
    const fd = fs.openSync(file, 'r+');
    try { fs.ftruncateSync(fd, Buffer.byteLength(complete)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
  const records = complete.split('\n').filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch { throw new Error(`OUTBOX_CORRUPT: invalid JSON at record ${index + 1}`); }
  });
  let previous = null;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.sequence !== index + 1 || record.previous_record_sha256 !== previous) throw new Error(`OUTBOX_CORRUPT: chain mismatch at record ${index + 1}`);
    const envelopeText = canonicalJson(record.envelope);
    const envelopeSha256 = sha256(envelopeText);
    if (record.envelope_sha256 !== envelopeSha256) throw new Error(`OUTBOX_CORRUPT: envelope hash mismatch at record ${index + 1}`);
    if (record.envelope_bytes !== undefined && record.envelope_bytes !== Buffer.byteLength(envelopeText)) throw new Error(`OUTBOX_CORRUPT: envelope length mismatch at record ${index + 1}`);
    const base = { sequence: record.sequence, previous_record_sha256: record.previous_record_sha256, envelope_sha256: record.envelope_sha256 };
    if (record.envelope_bytes !== undefined) base.envelope_bytes = record.envelope_bytes;
    base.envelope = record.envelope;
    const expected = sha256(canonicalJson(base));
    if (record.record_sha256 !== expected) throw new Error(`OUTBOX_CORRUPT: record hash mismatch at record ${index + 1}`);
    validateEnvelope(record.envelope);
    previous = record.record_sha256;
  }
  return { records, recovered: hasTail };
}

function append(outputDir, relativePath, built) {
  return withLock(outputDir, () => {
    const file = resolveInside(outputDir, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const state = readLines(file, true);
    const existing = findByIdempotency(state.records, built.event.event_type === 'run.initialized' ? null : built.event.run_id, built.event.idempotency_key);
    if (existing) {
      const oldRequest = existing.envelope.payload?.content?._telemetry?.request_sha256;
      const newRequest = built.event.payload?.content?._telemetry?.request_sha256;
      if (oldRequest && newRequest && oldRequest === newRequest) return { record: existing, recovered_tail: state.recovered, appended: false };
      if (existing.envelope_sha256 === built.envelope_sha256) return { record: existing, recovered_tail: state.recovered, appended: false };
      throw new Error('IDEMPOTENCY_CONFLICT: same run and idempotency key has different request content');
    }
    const previous = state.records.length ? state.records[state.records.length - 1].record_sha256 : null;
    const envelopeText = canonicalJson(built.event);
    const envelopeSha256 = sha256(envelopeText);
    if (built.envelope_sha256 !== envelopeSha256) throw new Error('INVALID_ENVELOPE: envelope hash does not match event');
    const base = {
      sequence: state.records.length + 1,
      previous_record_sha256: previous,
      envelope_sha256: built.envelope_sha256,
      envelope_bytes: Buffer.byteLength(envelopeText),
      envelope: built.event
    };
    const record = { ...base, record_sha256: sha256(canonicalJson(base)) };
    const fd = fs.openSync(file, 'a', 0o600);
    try { fs.writeSync(fd, `${canonicalJson(record)}\n`, null, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    return { record, recovered_tail: state.recovered, appended: true };
  });
}

function readCheckpoint(outputDir) {
  const file = resolveInside(outputDir, 'telemetry/checkpoint.json');
  if (!fs.existsSync(file)) return { sequence: 0, record_sha256: null };
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('OUTBOX_CORRUPT: checkpoint must be a regular file');
  let checkpoint;
  try { checkpoint = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error('OUTBOX_CORRUPT: checkpoint is not valid JSON'); }
  if (!Number.isInteger(checkpoint.sequence) || checkpoint.sequence < 0) throw new Error('OUTBOX_CORRUPT: invalid checkpoint sequence');
  if (checkpoint.sequence === 0 && checkpoint.record_sha256 !== null) throw new Error('OUTBOX_CORRUPT: invalid empty checkpoint hash');
  if (checkpoint.sequence > 0 && !/^[0-9a-f]{64}$/.test(checkpoint.record_sha256 || '')) throw new Error('OUTBOX_CORRUPT: invalid checkpoint hash');
  return checkpoint;
}

function validateCheckpoint(records, checkpoint) {
  if (checkpoint.sequence > records.length) throw new Error('OUTBOX_CORRUPT: checkpoint is ahead of Outbox');
  if (checkpoint.sequence > 0 && records[checkpoint.sequence - 1].record_sha256 !== checkpoint.record_sha256) throw new Error('OUTBOX_CORRUPT: checkpoint does not match Outbox chain');
  return checkpoint;
}

function writeCheckpoint(outputDir, checkpoint) {
  const directory = ensureTelemetryDir(outputDir);
  const file = path.join(directory, 'checkpoint.json');
  const temporary = path.join(directory, `checkpoint.${process.pid}.tmp`);
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(fd, `${canonicalJson(checkpoint)}\n`, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
  const dirfd = fs.openSync(directory, 'r');
  try { fs.fsyncSync(dirfd); } finally { fs.closeSync(dirfd); }
}

function deadLetter(outputDir, record, errorCode, retryCount = 0) {
  const directory = ensureTelemetryDir(outputDir);
  const file = path.join(directory, 'dead-letter.jsonl');
  const item = { envelope_sha256: record.envelope_sha256, error_code: errorCode, retry_count: retryCount, occurred_at: new Date().toISOString() };
  const fd = fs.openSync(file, 'a', 0o600);
  try { fs.writeSync(fd, `${canonicalJson(item)}\n`, null, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

module.exports = { append, deadLetter, ensureTelemetryDir, findByIdempotency, readCheckpoint, readLines, resolveInside, validateCheckpoint, writeCheckpoint, withLock };
