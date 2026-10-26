'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { canonicalJson } = require('../canonical-json.cjs');
const { ulid } = require('../ulid.cjs');
const { defaultConfig, validateConfig } = require('../config.cjs');
const { validateProcess } = require('../schema-validator.cjs');
const { redactPayload } = require('../redactor.cjs');
const { buildEvent, normalizeIdempotencyKey } = require('../event-builder.cjs');
const outbox = require('../outbox.cjs');
const { operationsFor, operationSql } = require('../projection.cjs');

test('canonical JSON sorts object keys and preserves array order', () => {
  assert.equal(canonicalJson({ z: 1, a: [{ y: 2, x: 1 }] }), '{"a":[{"x":1,"y":2}],"z":1}');
});

test('ULIDs are valid and monotonic within a millisecond', () => {
  const a = ulid(1700000000000);
  const b = ulid(1700000000000);
  assert.match(a, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.ok(b > a);
});

test('default config is local best effort and remote requires consent', () => {
  const config = validateConfig(defaultConfig());
  assert.equal(config.mode, 'local');
  assert.equal(config.failure_policy, 'best_effort');
  assert.equal(config.remote_sync.enabled, false);
  assert.throws(() => validateConfig({ ...config, mode: 'remote' }), /AUTH_REQUIRED/);
});

test('process sidecar validates role-specific requirements', () => {
  const common = { schema_version: '1.4.0', agent_id: 'hunter-1', explicit_rationale: 'Evidence-backed short rationale.', evidence_refs: [], observations: [] };
  assert.doesNotThrow(() => validateProcess({ ...common, result_type: 'hunter_plan', hypotheses: [], attack_plans: [], hypothesis_relations: [] }));
  assert.throws(() => validateProcess({ ...common, result_type: 'critic' }), /critic_review/);
  assert.throws(() => validateProcess({ ...common, result_type: 'recon', recon_facts: [{ fact_id: 'f1' }] }), /INVALID_PROCESS/);
});

test('redactor removes credential fields and bounds oversized payloads', () => {
  const redacted = redactPayload({ password: 'value', note: 'ok' });
  assert.equal(redacted.redaction_status, 'redacted');
  assert.equal(redacted.content.password, '[REDACTED]');
  const oversized = redactPayload({ text: 'x'.repeat(1000) }, { maxBytes: 100 });
  assert.equal(oversized.is_truncated, true);
  assert.equal(oversized.content.truncated, true);
  const circular = {};
  circular.self = circular;
  const blocked = redactPayload(circular);
  assert.equal(blocked.redaction_status, 'blocked');
  assert.equal(blocked.content, null);
});

test('idempotency keys require canonical visible text', () => {
  assert.equal(normalizeIdempotencyKey('run/abc/P0/init'), 'run/abc/P0/init');
  assert.throws(() => normalizeIdempotencyKey(' bad '));
  assert.throws(() => normalizeIdempotencyKey('bad\u200bkey'));
});

test('event schema rejects unsafe source references', () => {
  const config = defaultConfig();
  const runId = ulid();
  assert.throws(() => buildEvent({ run_id: runId, phase_code: 'P1', event_type: 'phase.started', actor_type: 'parent', idempotency_key: `run/${runId}/P1/start`, payload: {}, source_refs: [{ relative_path: '../secret' }] }, config), /INVALID_ENVELOPE/);
});

function sampleBuilt() {
  const config = defaultConfig();
  const runId = ulid();
  return buildEvent({ run_id: runId, phase_code: 'P1', event_type: 'phase.started', actor_type: 'parent', idempotency_key: `run/${runId}/P1/start`, payload: { projections: [{ table: 'audit_phase_execution', action: 'insert', values: { phase_execution_id: ulid(), run_id: '$run_id', phase_code: 'P1', attempt_no: 1, status: 'running', schema_version: '1.4.0', source_class: 'P' } }] }, source_refs: [] }, config);
}

test('outbox appends a verified hash chain and recovers an incomplete tail', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-outbox-'));
  const first = outbox.append(directory, 'telemetry/outbox.jsonl', sampleBuilt());
  const second = outbox.append(directory, 'telemetry/outbox.jsonl', sampleBuilt());
  assert.equal(first.record.sequence, 1);
  assert.equal(first.record.envelope_bytes, Buffer.byteLength(canonicalJson(first.record.envelope)));
  assert.equal(second.record.previous_record_sha256, first.record.record_sha256);
  const file = path.join(directory, 'telemetry/outbox.jsonl');
  fs.appendFileSync(file, '{partial');
  const recovered = outbox.readLines(file, true);
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.records.length, 2);
});

test('outbox rejects envelope tampering even if a record is rehashed', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-outbox-tamper-'));
  outbox.append(directory, 'telemetry/outbox.jsonl', sampleBuilt());
  const file = path.join(directory, 'telemetry/outbox.jsonl');
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  record.envelope.phase_code = 'P2';
  const base = {
    sequence: record.sequence,
    previous_record_sha256: record.previous_record_sha256,
    envelope_sha256: record.envelope_sha256,
    envelope_bytes: record.envelope_bytes,
    envelope: record.envelope
  };
  record.record_sha256 = require('node:crypto').createHash('sha256').update(canonicalJson(base)).digest('hex');
  fs.writeFileSync(file, `${canonicalJson(record)}\n`);
  assert.throws(() => outbox.readLines(file), /envelope hash mismatch/);
});

test('checkpoint must reference the exact Outbox chain record', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-checkpoint-'));
  const appended = outbox.append(directory, 'telemetry/outbox.jsonl', sampleBuilt());
  outbox.writeCheckpoint(directory, { sequence: 1, record_sha256: '0'.repeat(64) });
  const records = outbox.readLines(path.join(directory, 'telemetry/outbox.jsonl')).records;
  assert.throws(() => outbox.validateCheckpoint(records, outbox.readCheckpoint(directory)), /does not match/);
  outbox.writeCheckpoint(directory, { sequence: 1, record_sha256: appended.record.record_sha256 });
  assert.doesNotThrow(() => outbox.validateCheckpoint(records, outbox.readCheckpoint(directory)));
});

test('projection rejects tables outside the event allowlist', () => {
  const built = sampleBuilt();
  built.event.payload.content.projections[0].table = 'audit_finding';
  assert.throws(() => operationsFor(built.event), /not writable/);
});

test('projection uses prepared statements and enforces row-version CAS', () => {
  const columns = new Map([['audit_run', new Set(['run_id', 'run_status', 'row_version'])]]);
  const sql = operationSql({ table: 'audit_run', action: 'update', values: { run_status: 'complete', row_version: 2 }, where: { run_id: ulid(), row_version: 1 } }, columns, 0);
  assert.match(sql, /PREPARE telemetry_stmt/);
  assert.match(sql, /CONCURRENCY_CONFLICT/);
  assert.doesNotMatch(sql, /complete/);
  assert.throws(() => operationSql({ table: 'audit_run', action: 'update', values: { run_status: 'complete' }, where: { run_id: ulid() } }, columns, 0), /row_version CAS/);
});

test('local CLI initializes a run without contacting MySQL', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-cli-'));
  const input = { repo: 'synthetic', target: 'synthetic', source_ref: 'abc123', profile: 'quick', scope_paths: [] };
  const result = cp.spawnSync(process.execPath, [path.join(__dirname, '../cli.cjs'), 'init-run', '--output-dir', directory], { input: JSON.stringify(input), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, 'appended');
  assert.equal(outbox.readLines(path.join(directory, 'telemetry/outbox.jsonl')).records.length, 1);
});

test('off mode preserves the original flow and creates no telemetry directory', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-cli-off-'));
  const telemetry = defaultConfig();
  telemetry.mode = 'off';
  telemetry.consent.local_outbox = false;
  const result = cp.spawnSync(process.execPath, [path.join(__dirname, '../cli.cjs'), 'init-run', '--output-dir', directory], {
    input: JSON.stringify({ repo: 'synthetic', target: 'synthetic', source_ref: 'abc123', profile: 'quick', telemetry }),
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).status, 'disabled');
  assert.equal(fs.existsSync(path.join(directory, 'telemetry')), false);
});

test('remote best-effort keeps a durable event when MySQL is unavailable', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-cli-remote-'));
  const telemetry = defaultConfig();
  telemetry.mode = 'remote';
  telemetry.remote_sync.enabled = true;
  telemetry.consent.remote_mysql = true;
  telemetry.consent.authority_reference = 'synthetic unit-test authorization';
  const result = cp.spawnSync(process.execPath, [path.join(__dirname, '../cli.cjs'), 'init-run', '--output-dir', directory], {
    input: JSON.stringify({ repo: 'synthetic', target: 'synthetic', source_ref: 'abc123', profile: 'quick', telemetry }),
    encoding: 'utf8',
    timeout: 5000,
    env: {
      ...process.env,
      AI_SECURITY_DB_HOST: '127.0.0.1',
      AI_SECURITY_DB_PORT: '1',
      AI_SECURITY_DB_USER: 'synthetic',
      AI_SECURITY_DB_NAME: 'ai_security',
      MYSQL_PWD: 'synthetic-not-a-real-password'
    }
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).status, 'pending_sync');
  assert.equal(outbox.readLines(path.join(directory, 'telemetry/outbox.jsonl')).records.length, 1);
  assert.equal(fs.existsSync(path.join(directory, 'telemetry/checkpoint.json')), false);
});

test('all five Parent CLI interfaces preserve a local append-only run', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-cli-interfaces-'));
  const cli = path.join(__dirname, '../cli.cjs');
  const invoke = (command, input) => cp.spawnSync(process.execPath, [cli, command, '--output-dir', directory], { input: JSON.stringify(input || {}), encoding: 'utf8' });
  const initialized = invoke('init-run', { repo: 'synthetic', target: 'synthetic', source_ref: 'abc123', profile: 'quick', scope_paths: [] });
  assert.equal(initialized.status, 0, initialized.stdout);
  const init = JSON.parse(initialized.stdout);
  const phaseExecutionId = ulid();
  const phase = invoke('record-event', {
    run_id: init.run_id, phase_code: 'P1', event_type: 'phase.started', actor_type: 'parent', idempotency_key: `run/${init.run_id}/P1/start`, payload_type: 'phase.started',
    payload: { _telemetry: { phase_execution_id: phaseExecutionId }, projections: [{ table: 'audit_phase_execution', action: 'insert', values: { phase_execution_id: phaseExecutionId, run_id: '$run_id', phase_code: 'P1', attempt_no: 1, status: 'running', schema_version: '1.4.0', source_class: 'P' } }] }, source_refs: []
  });
  assert.equal(phase.status, 0, phase.stdout);
  fs.writeFileSync(path.join(directory, 'architecture.md'), '# Synthetic architecture\n');
  const snapshot = invoke('record-snapshot', { run_id: init.run_id, phase_code: 'P1', phase_execution_id: phaseExecutionId, artifact_kind: 'architecture', relative_path: 'architecture.md', mime_type: 'text/markdown' });
  assert.equal(snapshot.status, 0, snapshot.stdout);
  const finalized = invoke('finalize-run', { run_id: init.run_id, run_status: 'complete', telemetry_remote_status: 'disabled', outbox_status: 'pending', expected_row_version: 0 });
  assert.equal(finalized.status, 0, finalized.stdout);
  const flush = invoke('flush-outbox', {});
  assert.notEqual(flush.status, 0);
  assert.equal(JSON.parse(flush.stdout).error.code, 'AUTH_REQUIRED');
  assert.equal(outbox.readLines(path.join(directory, 'telemetry/outbox.jsonl')).records.length, 4);
});
