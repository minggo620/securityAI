#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { defaultConfig, loadConfig, validateConfig } = require('./config.cjs');
const { ulid } = require('./ulid.cjs');
const { canonicalJson } = require('./canonical-json.cjs');
const { buildEvent, sha256 } = require('./event-builder.cjs');
const outbox = require('./outbox.cjs');
const { operationsFor, validateEventAgainstHistory } = require('./projection.cjs');
const { adaptAgentResult } = require('./agent-adapter.cjs');
const writer = require('./mysql-writer.cjs');

function response(value) { process.stdout.write(`${JSON.stringify(value)}\n`); }
function fail(error) {
  const message = error instanceof Error ? error.message : String(error);
  const code = message.match(/^([A-Z_]+):/)?.[1] || 'TELEMETRY_ERROR';
  response({ ok: false, event_id: null, status: 'failed', error: { code, retryable: code === 'DB_UNAVAILABLE' } });
  process.exitCode = 1;
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) { args._.push(item); continue; }
    const key = item.slice(2).replace(/-/g, '_');
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) args[key] = true;
    else { args[key] = next; index += 1; }
  }
  return args;
}

function readInput(args) {
  if (args.input) {
    const file = path.resolve(args.input);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('input must be a regular non-symlink file');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  const text = fs.readFileSync(0, 'utf8');
  return text.trim() ? JSON.parse(text) : {};
}

function mysqlDate(date = new Date()) { return date.toISOString().replace('T', ' ').replace('Z', ''); }

function skillManifestHash() {
  const root = path.resolve(__dirname, '../..');
  const files = [];
  const visit = (directory, relative = '') => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const childRelative = path.join(relative, entry.name);
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'tests') continue;
        visit(child, childRelative);
      } else if (entry.isFile() && /\.(?:md|json|ya?ml|cjs)$/.test(entry.name) && !entry.name.endsWith('.test.cjs')) files.push(childRelative);
    }
  };
  visit(root);
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    const target = path.join(root, file);
    if (fs.existsSync(target)) hash.update(file).update('\0').update(fs.readFileSync(target));
  }
  return hash.digest('hex');
}

function configPath(outputDir) { return path.join(outbox.ensureTelemetryDir(outputDir), 'config.json'); }

function saveConfig(outputDir, config) {
  const file = configPath(outputDir);
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${canonicalJson(config)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, file);
}

function runtimeConfig(args, outputDir) {
  if (args.config) return loadConfig(args.config);
  const file = path.join(path.resolve(outputDir), 'telemetry/config.json');
  return fs.existsSync(file) ? loadConfig(file) : validateConfig(defaultConfig());
}

function appendBuilt(outputDir, config, built) {
  if (config.mode === 'off') return { ok: true, event_id: built.event.event_id, status: 'disabled', error: null };
  operationsFor(built.event);
  const outboxFile = outbox.resolveInside(outputDir, config.outbox_relative_path);
  const history = outbox.readLines(outboxFile, true).records;
  validateEventAgainstHistory(built.event, history);
  const appended = outbox.append(outputDir, config.outbox_relative_path, built);
  if (config.mode !== 'remote') return { ok: true, event_id: appended.record.envelope.event_id, status: appended.appended ? 'appended' : 'already_applied', error: null, sequence: appended.record.sequence };
  try {
    const records = outbox.readLines(outboxFile, true).records;
    const checkpoint = outbox.validateCheckpoint(records, outbox.readCheckpoint(outputDir));
    const state = writer.preflight({ tlsMode: config.remote_sync.tls_mode });
    let result = { status: appended.appended ? 'projected' : 'already_applied' };
    for (const record of records.filter((item) => item.sequence > checkpoint.sequence && item.sequence <= appended.record.sequence)) {
      result = writer.projectRecord(record, state, { tlsMode: config.remote_sync.tls_mode });
      outbox.writeCheckpoint(outputDir, { sequence: record.sequence, record_sha256: record.record_sha256, event_id: record.envelope.event_id, committed_at: new Date().toISOString() });
    }
    return { ok: true, event_id: appended.record.envelope.event_id, status: result.status, error: null, sequence: appended.record.sequence };
  } catch (error) {
    const code = error.code || error.message.match(/^([A-Z_]+):/)?.[1] || 'DB_UNAVAILABLE';
    if (error.retryable === false || new Set(['IDEMPOTENCY_CONFLICT', 'PROJECTION_FAILED', 'SCHEMA_INCOMPATIBLE', 'AUTH_REQUIRED', 'CONCURRENCY_CONFLICT']).has(code)) outbox.deadLetter(outputDir, appended.record, code);
    if (config.failure_policy === 'required') throw error;
    return { ok: true, event_id: appended.record.envelope.event_id, status: 'pending_sync', error: { code, retryable: error.retryable === true }, sequence: appended.record.sequence };
  }
}

function initRun(args) {
  const outputDir = path.resolve(args.output_dir || '.');
  const input = readInput(args);
  const config = args.config ? loadConfig(args.config) : validateConfig({ ...defaultConfig(), ...(input.telemetry || {}) });
  const runId = input.run_id || ulid();
  if (config.mode === 'off') return response({ ok: true, run_id: runId, event_id: null, status: 'disabled', error: null });
  saveConfig(outputDir, config);
  const phaseId = input.phase_execution_id || ulid();
  const requestKey = input.request_idempotency_key || null;
  const projections = [{
    table: 'audit_run', action: 'insert', values: {
      run_id: runId,
      request_idempotency_key: requestKey,
      request_idempotency_hash: requestKey ? { $hex: sha256(requestKey.normalize('NFC')) } : null,
      repo: input.repo,
      target_locator_redacted: input.target || input.repo,
      target_locator_policy: 'relative_or_pseudonymized',
      source_ref: input.source_ref,
      worktree_dirty: Boolean(input.worktree_dirty),
      profile: input.profile || 'standard',
      budget: input.budget ?? null,
      execution_policy: input.execution_policy || 'sandboxed-source-and-local-only',
      skill_manifest_sha256: { $hex: skillManifestHash() },
      skill_schema_version: '1.4.0',
      telemetry_mode: config.mode,
      telemetry_failure_policy: config.failure_policy,
      run_status: 'initializing',
      telemetry_local_status: 'healthy',
      telemetry_remote_status: config.mode === 'remote' ? 'pending_sync' : 'disabled',
      outbox_status: 'pending',
      incomplete_reason: null,
      telemetry_incomplete_reason: null,
      started_at: mysqlDate(),
      ended_at: null,
      schema_version: '1.4.0',
      source_class: 'P',
      row_version: 0
    }
  }, {
    table: 'audit_phase_execution', action: 'insert', values: {
      phase_execution_id: phaseId, run_id: runId, phase_code: 'P0', attempt_no: 1, status: 'running', input_payload_id: '$payload_id', output_payload_id: null, failure_reason: null, started_at: mysqlDate(), ended_at: null, schema_version: '1.4.0', source_class: 'P'
    }
  }];
  for (const [index, scope] of (input.scope_paths || []).entries()) projections.push({ table: 'audit_run_scope', action: 'insert', values: { scope_id: ulid(), run_id: runId, ordinal: index + 1, scope_type: scope.scope_type || 'path', scope_value: scope.scope_value || scope.path || String(scope), included: scope.included !== false, reason: scope.reason || null, schema_version: '1.4.0', source_class: scope.source_class || 'S' } });
  const built = buildEvent({
    run_id: runId, phase_code: 'P0', event_type: 'run.initialized', actor_type: 'parent', source_class: 'P', payload_type: 'run.initialized',
    idempotency_key: requestKey ? `request/${requestKey}/P0/init` : `run/${runId}/P0/init`, request_sha256: sha256(canonicalJson({ command: 'init-run', input, config })),
    payload: { _telemetry: { phase_execution_id: phaseId }, run_metadata: input, telemetry_config: config, projections }, source_refs: [{ relative_path: 'SKILL.md', start_line: null, end_line: null, content_sha256: null }]
  }, config);
  const initialized = appendBuilt(outputDir, config, built);
  if (config.mode !== 'off') {
    const initialRecord = outbox.findByIdempotency(outbox.readLines(outbox.resolveInside(outputDir, config.outbox_relative_path), true).records, null, built.event.idempotency_key);
    const effectiveRunId = initialRecord?.envelope.run_id || runId;
    const effectivePhaseId = initialRecord?.envelope.payload?.content?._telemetry?.phase_execution_id || phaseId;
    const preflight = buildEvent({
      run_id: effectiveRunId,
      phase_code: 'P0',
      event_type: 'run.preflight_completed',
      actor_type: 'writer',
      causation_id: built.event.event_id,
      source_class: 'P',
      payload_type: 'run.preflight',
      idempotency_key: `run/${effectiveRunId}/P0/preflight`,
      request_sha256: sha256(canonicalJson({ command: 'run.preflight_completed', run_id: effectiveRunId, config })),
      payload: {
        _telemetry: { phase_execution_id: effectivePhaseId },
        preflight: { status: initialized.status === 'projected' ? 'passed' : 'pending_sync', database: 'ai_security', schema_version: '1.3.0-core', table_count: 36, tls_mode: config.remote_sync.tls_mode },
        projections: [{ table: 'audit_run', action: 'update', values: { run_status: 'in_progress', row_version: 1 }, where: { run_id: effectiveRunId, row_version: 0 } }]
      },
      source_refs: []
    }, config);
    const preflightResult = appendBuilt(outputDir, config, preflight);
    const latest = outbox.findByIdempotency(outbox.readLines(outbox.resolveInside(outputDir, config.outbox_relative_path), true).records, null, preflight.event.idempotency_key);
    response({ run_id: latest?.envelope.run_id || effectiveRunId, phase_execution_id: latest?.envelope.payload?.content?._telemetry?.phase_execution_id || effectivePhaseId, init_event_id: built.event.event_id, ...preflightResult });
    return;
  }
  const record = outbox.findByIdempotency(outbox.readLines(outbox.resolveInside(outputDir, config.outbox_relative_path), true).records, null, built.event.idempotency_key);
  response({ run_id: record?.envelope.run_id || runId, phase_execution_id: record?.envelope.payload?.content?._telemetry?.phase_execution_id || phaseId, ...initialized });
}

function recordEvent(args) {
  const outputDir = path.resolve(args.output_dir || '.');
  const config = runtimeConfig(args, outputDir);
  const input = readInput(args);
  if (config.mode === 'off') return response({ ok: true, event_id: null, status: 'disabled', error: null });
  if (input.agent_result) {
    const adapted = adaptAgentResult(input);
    const results = adapted.events.map((eventInput) => appendBuilt(outputDir, config, buildEvent(eventInput, config)));
    return response({ ok: true, event_id: results.at(-1)?.event_id || null, event_ids: results.map((item) => item.event_id), entities: adapted.entities, status: results.some((item) => item.status === 'pending_sync') ? 'pending_sync' : results.every((item) => item.status === 'already_applied') ? 'already_applied' : 'appended', error: null });
  }
  response(appendBuilt(outputDir, config, buildEvent(input, config)));
}

function recordSnapshot(args) {
  const outputDir = path.resolve(args.output_dir || '.');
  const config = runtimeConfig(args, outputDir);
  const input = readInput(args);
  const file = outbox.resolveInside(outputDir, input.relative_path);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('snapshot target must be a regular non-symlink file');
  const bytes = fs.readFileSync(file);
  const contentHash = crypto.createHash('sha256').update(bytes).digest('hex');
  const artifactId = input.artifact_id || ulid();
  const eventInput = {
    run_id: input.run_id,
    phase_code: input.phase_code,
    event_type: 'artifact.snapshot_created',
    actor_type: 'parent',
    agent_task_id: input.owner_task_id || null,
    source_class: input.source_class || 'O',
    payload_type: input.artifact_kind,
    idempotency_key: input.idempotency_key || `run/${input.run_id}/${input.phase_code}/artifact/${input.artifact_kind}/${input.version_no || 1}/${contentHash}`,
    request_sha256: sha256(canonicalJson({ command: 'record-snapshot', input, content_sha256: contentHash })),
    payload: {
      _telemetry: { phase_execution_id: input.phase_execution_id || null },
      artifact: { relative_path: input.relative_path, content_sha256: contentHash, byte_size: bytes.length },
      snapshot_text: bytes.length <= config.payload_max_bytes ? bytes.toString('utf8') : null,
      projections: [{ table: 'audit_artifact', action: 'insert', values: {
        artifact_id: artifactId, run_id: input.run_id, owner_task_id: input.owner_task_id || null, artifact_kind: input.artifact_kind, version_no: input.version_no || 1, artifact_status: input.artifact_status || 'final', relative_path: input.relative_path, path_hash: { $hex: sha256(input.relative_path.normalize('NFC')) }, content_sha256: { $hex: contentHash }, byte_size: bytes.length, mime_type: input.mime_type || 'application/octet-stream', promotion_status: input.promotion_status || 'promoted', promotion_reason: input.promotion_reason || null, schema_version: '1.4.0', source_class: input.source_class || 'O'
      } }]
    },
    source_refs: input.source_refs || []
  };
  response(appendBuilt(outputDir, config, buildEvent(eventInput, config)));
}

function syncOutbox(outputDir, config) {
  if (config.mode !== 'remote' || !config.remote_sync.enabled || !config.consent.remote_mysql) throw new Error('AUTH_REQUIRED: remote flush requires remote mode and consent');
  const result = outbox.withLock(outputDir, () => {
    const file = outbox.resolveInside(outputDir, config.outbox_relative_path);
    const records = outbox.readLines(file, true).records;
    const checkpoint = outbox.validateCheckpoint(records, outbox.readCheckpoint(outputDir));
    const options = { tlsMode: config.remote_sync.tls_mode };
    const state = writer.preflight(options);
    let applied = 0;
    for (const record of records.filter((item) => item.sequence > checkpoint.sequence)) {
      try {
        writer.projectRecord(record, state, options);
        outbox.writeCheckpoint(outputDir, { sequence: record.sequence, record_sha256: record.record_sha256, event_id: record.envelope.event_id, committed_at: new Date().toISOString() });
        applied += 1;
      } catch (error) {
        const code = error.code || error.message.match(/^([A-Z_]+):/)?.[1] || 'DB_UNAVAILABLE';
        if (error.retryable === false || new Set(['IDEMPOTENCY_CONFLICT', 'PROJECTION_FAILED', 'SCHEMA_INCOMPATIBLE', 'AUTH_REQUIRED', 'CONCURRENCY_CONFLICT']).has(code)) outbox.deadLetter(outputDir, record, code);
        throw error;
      }
    }
    return { ok: true, event_id: null, status: 'synced', error: null, applied, total: records.length, ssl_cipher: state.ssl_cipher };
  });
  return result;
}

function flushOutbox(args) {
  const outputDir = path.resolve(args.output_dir || '.');
  const config = runtimeConfig(args, outputDir);
  const result = syncOutbox(outputDir, config);
  response(result);
}

function finalizeRun(args) {
  const outputDir = path.resolve(args.output_dir || '.');
  const config = runtimeConfig(args, outputDir);
  const input = readInput(args);
  if (config.mode === 'off') return response({ ok: true, event_id: null, status: 'disabled', error: null });
  let preFinalizeSync = null;
  if (config.mode === 'remote') {
    try {
      preFinalizeSync = syncOutbox(outputDir, config);
    } catch (error) {
      const code = error.code || error.message.match(/^([A-Z_]+):/)?.[1] || 'DB_UNAVAILABLE';
      if (config.failure_policy === 'required') throw error;
      preFinalizeSync = { status: 'pending_sync', error: { code, retryable: error.retryable === true } };
    }
  }
  const projections = [{ table: 'audit_run', action: 'update', values: {
    run_status: input.run_status,
    telemetry_local_status: input.telemetry_local_status || 'healthy',
    telemetry_remote_status: input.telemetry_remote_status || (config.mode === 'remote' ? (preFinalizeSync?.status === 'synced' ? 'synced' : 'pending_sync') : 'disabled'),
    outbox_status: input.outbox_status || (config.mode === 'remote' ? (preFinalizeSync?.status === 'synced' ? 'empty' : 'pending') : 'pending'),
    incomplete_reason: input.incomplete_reason || null,
    telemetry_incomplete_reason: input.telemetry_incomplete_reason || null,
    ended_at: mysqlDate(),
    row_version: (input.expected_row_version || 0) + 1
  }, where: { run_id: input.run_id, row_version: input.expected_row_version || 0 } }];
  if (input.phase_execution_id) projections.push({ table: 'audit_phase_execution', action: 'update', values: { status: input.run_status === 'complete' ? 'completed' : 'incomplete', ended_at: mysqlDate() }, where: { phase_execution_id: input.phase_execution_id } });
  const built = buildEvent({ run_id: input.run_id, phase_code: 'P6', event_type: 'run.finalized', actor_type: 'parent', source_class: 'P', payload_type: 'run.finalized', idempotency_key: input.idempotency_key || `run/${input.run_id}/P6/final/${input.run_status}`, request_sha256: sha256(canonicalJson({ command: 'finalize-run', input })), payload: { _telemetry: { phase_execution_id: input.phase_execution_id || null }, final_status: input, projections }, source_refs: [] }, config);
  response(appendBuilt(outputDir, config, built));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (command === 'init-run') return initRun(args);
  if (command === 'record-event') return recordEvent(args);
  if (command === 'record-snapshot') return recordSnapshot(args);
  if (command === 'flush-outbox') return flushOutbox(args);
  if (command === 'finalize-run') return finalizeRun(args);
  throw new Error('unknown command; use init-run, record-event, record-snapshot, flush-outbox, or finalize-run');
}

try { main(); } catch (error) { fail(error); }
