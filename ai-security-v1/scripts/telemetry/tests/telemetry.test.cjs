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
const { operationsFor, operationSql, validateEventAgainstHistory } = require('../projection.cjs');

test('canonical JSON sorts object keys and preserves array order', () => {
  assert.equal(canonicalJson({ z: 1, a: [{ y: 2, x: 1 }] }), '{"a":[{"x":1,"y":2}],"z":1}');
});

test('ULIDs are valid and monotonic within a millisecond', () => {
  const a = ulid(1700000000000);
  const b = ulid(1700000000000);
  assert.match(a, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.ok(b > a);
});

test('default config is remote best effort with standing organization consent', () => {
  const config = validateConfig(defaultConfig());
  assert.equal(config.mode, 'remote');
  assert.equal(config.failure_policy, 'best_effort');
  assert.equal(config.remote_sync.enabled, true);
  assert.equal(config.consent.remote_mysql, true);
  assert.equal(config.consent.authority_type, 'organization_policy');
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

test('new events reject the historical writer actor', () => {
  const config = defaultConfig();
  const runId = ulid();
  assert.throws(() => buildEvent({ run_id: runId, phase_code: 'P1', event_type: 'phase.started', actor_type: 'writer', idempotency_key: `run/${runId}/P1/writer`, payload: { projections: [{ table: 'audit_phase_execution', action: 'insert', values: { phase_execution_id: ulid(), run_id: '$run_id', phase_code: 'P1', attempt_no: 1, status: 'running', schema_version: '1.4.0', source_class: 'P' } }] }, source_refs: [] }, config), /writer actor is reserved/);
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

test('default CLI initializes remote telemetry and preserves an event when MySQL is unavailable', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-cli-'));
  const input = { repo: 'synthetic', target: 'synthetic', source_ref: 'abc123', profile: 'quick', scope_paths: [] };
  const result = cp.spawnSync(process.execPath, [path.join(__dirname, '../cli.cjs'), 'init-run', '--output-dir', directory], { input: JSON.stringify(input), encoding: 'utf8', timeout: 5000, env: { ...process.env, AI_SECURITY_DB_HOST: '127.0.0.1', AI_SECURITY_DB_PORT: '1', AI_SECURITY_DB_USER: 'synthetic', AI_SECURITY_DB_NAME: 'ai_security', MYSQL_PWD: 'synthetic-not-a-real-password' } });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, 'pending_sync');
  assert.equal(outbox.readLines(path.join(directory, 'telemetry/outbox.jsonl')).records.length, 2);
});

test('off mode preserves the original flow and creates no telemetry directory', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-cli-off-'));
  const telemetry = defaultConfig();
  telemetry.mode = 'off';
  telemetry.remote_sync.enabled = false;
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
  assert.equal(outbox.readLines(path.join(directory, 'telemetry/outbox.jsonl')).records.length, 2);
  assert.equal(fs.existsSync(path.join(directory, 'telemetry/checkpoint.json')), false);
});

test('default remote finalization retries sync and records pending status', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-finalize-remote-'));
  const cli = path.join(__dirname, '../cli.cjs');
  const env = { ...process.env, AI_SECURITY_DB_HOST: '127.0.0.1', AI_SECURITY_DB_PORT: '1', AI_SECURITY_DB_USER: 'synthetic', AI_SECURITY_DB_NAME: 'ai_security', MYSQL_PWD: 'synthetic-not-a-real-password' };
  const invoke = (command, input) => cp.spawnSync(process.execPath, [cli, command, '--output-dir', directory], { input: JSON.stringify(input), encoding: 'utf8', timeout: 5000, env });
  const initialized = invoke('init-run', { repo: 'synthetic', target: 'synthetic', source_ref: 'abc', profile: 'quick' });
  assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);
  const init = JSON.parse(initialized.stdout);
  const finalized = invoke('finalize-run', { run_id: init.run_id, run_status: 'complete', expected_row_version: 0 });
  assert.equal(finalized.status, 0, finalized.stderr || finalized.stdout);
  assert.equal(JSON.parse(finalized.stdout).status, 'pending_sync');
  assert.equal(outbox.readLines(path.join(directory, 'telemetry/outbox.jsonl')).records.length, 3);
});

test('all five Parent CLI interfaces preserve a local append-only run', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-cli-interfaces-'));
  const cli = path.join(__dirname, '../cli.cjs');
  const invoke = (command, input) => cp.spawnSync(process.execPath, [cli, command, '--output-dir', directory], { input: JSON.stringify(input || {}), encoding: 'utf8' });
  const base = defaultConfig();
  const localTelemetry = { ...base, mode: 'local', remote_sync: { ...base.remote_sync, enabled: false }, consent: { ...base.consent, remote_mysql: false, authority_type: 'explicit_user', authority_reference: 'local-only test' } };
  const initialized = invoke('init-run', { repo: 'synthetic', target: 'synthetic', source_ref: 'abc123', profile: 'quick', scope_paths: [], telemetry: localTelemetry });
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
  assert.equal(outbox.readLines(path.join(directory, 'telemetry/outbox.jsonl')).records.length, 5);
});

test('event contract rejects missing business projections and wrong phases', () => {
  const built = sampleBuilt();
  built.event.payload.content.projections = [];
  assert.throws(() => operationsFor(built.event), /missing required projection/);
  const other = sampleBuilt();
  other.event.event_type = 'run.preflight_completed';
  other.event.phase_code = 'P1';
  other.event.payload.content.projections = [{ table: 'audit_run', action: 'update', values: { run_status: 'in_progress', row_version: 1 }, where: { run_id: other.event.run_id, row_version: 0 } }];
  assert.throws(() => operationsFor(other.event), /not allowed/);
});

test('hypothesis baseline score is recomputed and mismatch is rejected', () => {
  const built = buildEvent({ run_id: ulid(), phase_code: 'P2', event_type: 'hypothesis.created', idempotency_key: 'score/check', payload: { projections: [
    { table: 'audit_hypothesis', action: 'insert', values: { hypothesis_id: ulid() } },
    { table: 'audit_hypothesis_version', action: 'insert', values: { hypothesis_version_id: ulid() } },
    { table: 'audit_hypothesis_coverage', action: 'insert', values: { hypothesis_coverage_id: ulid() } },
    { table: 'audit_hypothesis_score', action: 'insert', values: { predicted_probability: 0.5, potential_impact: 0.8, coverage_value: 0.2, information_gain: 0.1, estimated_validation_cost: 0.5, validation_cost_unit: 'normalized', priority_score: 9, formula_name: 'hypothesis-research-baseline', formula_version: '1.0' } }
  ] }, source_refs: [] }, defaultConfig());
  assert.throws(() => operationsFor(built.event), /priority_score/);
  built.event.payload.content.projections[3].values.priority_score = (0.5 * 0.8 + 0.2 + 0.1) / 1.5;
  assert.doesNotThrow(() => operationsFor(built.event));
});

test('validation independence is mechanically checked', () => {
  const verifier = ulid();
  const built = buildEvent({ run_id: ulid(), phase_code: 'P3', event_type: 'validation.started', idempotency_key: 'validation/start', causation_id: ulid(), payload: {
    independence: { verifier_task_id: verifier, prohibited_task_ids: [verifier], checked_at: new Date().toISOString() },
    projections: [{ table: 'audit_validation', action: 'insert', values: { validation_id: ulid(), verifier_task_id: verifier, independence_status: 'passed' } }]
  }, source_refs: [] }, defaultConfig());
  assert.throws(() => operationsFor(built.event), /not independent/);
  built.event.payload.content.independence.prohibited_task_ids = [ulid()];
  assert.doesNotThrow(() => operationsFor(built.event));
});

test('causal ordering rejects attack execution before its plan', () => {
  const runId = ulid();
  const plan = buildEvent({ run_id: runId, phase_code: 'P2', event_type: 'attack.plan_created', idempotency_key: 'plan/1', causation_id: ulid(), payload: { projections: [
    { table: 'audit_attack_plan', action: 'insert', values: { attack_plan_id: ulid() } },
    { table: 'audit_attack_step', action: 'insert', values: { attack_step_id: ulid() } }
  ] }, source_refs: [] }, defaultConfig());
  const execution = buildEvent({ run_id: runId, phase_code: 'P2', event_type: 'attack.step_observed', idempotency_key: 'execute/1', causation_id: plan.event.event_id, payload: { projections: [{ table: 'audit_attack_execution', action: 'insert', values: { attack_execution_id: ulid() } }] }, source_refs: [] }, defaultConfig());
  assert.throws(() => validateEventAgainstHistory(execution.event, []), /absent/);
  assert.doesNotThrow(() => validateEventAgainstHistory(execution.event, [{ envelope: plan.event }]));
});

test('Outbox retry is idempotent and conflicting reuse is rejected', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-idempotent-'));
  const built = sampleBuilt();
  const first = outbox.append(directory, 'telemetry/outbox.jsonl', built);
  const retry = outbox.append(directory, 'telemetry/outbox.jsonl', built);
  assert.equal(first.appended, true);
  assert.equal(retry.appended, false);
  const conflict = structuredClone(built);
  conflict.event.payload.content._telemetry.request_sha256 = 'f'.repeat(64);
  const text = canonicalJson(conflict.event);
  conflict.envelope_sha256 = require('node:crypto').createHash('sha256').update(text).digest('hex');
  assert.throws(() => outbox.append(directory, 'telemetry/outbox.jsonl', conflict), /IDEMPOTENCY_CONFLICT/);
});

test('oversized payload preserves projection controls', () => {
  const config = { ...defaultConfig(), payload_max_bytes: 2000 };
  const built = buildEvent({ run_id: ulid(), phase_code: 'P1', event_type: 'phase.started', idempotency_key: 'oversized/1', payload: {
    raw_agent_output: 'x'.repeat(10000), projections: [{ table: 'audit_phase_execution', action: 'insert', values: { phase_execution_id: ulid() } }]
  }, source_refs: [] }, config);
  assert.equal(built.event.payload.is_truncated, true);
  assert.equal(built.event.payload.content.projections.length, 1);
  assert.equal(built.event.payload.content_sha256, require('node:crypto').createHash('sha256').update(canonicalJson({ raw_agent_output: 'x'.repeat(10000), projections: [{ table: 'audit_phase_execution', action: 'insert', values: { phase_execution_id: built.event.payload.content.projections[0].values.phase_execution_id } }], _telemetry: built.event.payload.content._telemetry })).digest('hex'));
  assert.doesNotThrow(() => operationsFor(built.event));
});

test('init-run retry with request key creates one Outbox record', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-init-retry-'));
  const cli = path.join(__dirname, '../cli.cjs');
  const base = defaultConfig();
  const localTelemetry = { ...base, mode: 'local', remote_sync: { ...base.remote_sync, enabled: false }, consent: { ...base.consent, remote_mysql: false, authority_type: 'explicit_user', authority_reference: 'local-only test' } };
  const input = { repo: 'synthetic', target: 'synthetic', source_ref: 'abc123', profile: 'quick', scope_paths: [], request_idempotency_key: 'stable-request-1', telemetry: localTelemetry };
  const one = cp.spawnSync(process.execPath, [cli, 'init-run', '--output-dir', directory], { input: JSON.stringify(input), encoding: 'utf8' });
  const two = cp.spawnSync(process.execPath, [cli, 'init-run', '--output-dir', directory], { input: JSON.stringify(input), encoding: 'utf8' });
  assert.equal(one.status, 0, one.stdout);
  assert.equal(two.status, 0, two.stdout);
  assert.equal(JSON.parse(two.stdout).status, 'already_applied');
  assert.equal(outbox.readLines(path.join(directory, 'telemetry/outbox.jsonl')).records.length, 2);
});

test('Recon agent result is automatically validated and projected', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-agent-adapter-'));
  const cli = path.join(__dirname, '../cli.cjs');
  const base = defaultConfig();
  const localTelemetry = { ...base, mode: 'local', remote_sync: { ...base.remote_sync, enabled: false }, consent: { ...base.consent, remote_mysql: false, authority_type: 'explicit_user', authority_reference: 'local-only test' } };
  const initialized = cp.spawnSync(process.execPath, [cli, 'init-run', '--output-dir', directory], { input: JSON.stringify({ repo: 'synthetic', target: 'synthetic', source_ref: 'abc', profile: 'quick', telemetry: localTelemetry }), encoding: 'utf8' });
  const init = JSON.parse(initialized.stdout);
  const input = { run_id: init.run_id, phase_code: 'P1', actor_type: 'recon', agent_task_id: ulid(), idempotency_key: `run/${init.run_id}/P1/recon/r1`, context: { phase_execution_id: init.phase_execution_id, task_row_version: 0, accepted_fact_ids: ['fact-1'] }, agent_result: { summary: 'observable core result', _process: {
    schema_version: '1.4.0', result_type: 'recon', agent_id: 'recon-1', explicit_rationale: 'Direct source observation.', observations: [],
    evidence_refs: [{ ref_id: 'ref-1', fact_kind: 'source_fact', relative_path: 'src/app.js', start_line: 1, end_line: 2, scope: 'entry', description: 'Entry is reachable.', strength: 'direct' }],
    recon_facts: [{ fact_id: 'fact-1', recon_kind: 'surfaces_sinks', fact_kind: 'source_fact', statement: 'Reachable entry.', evidence_ref_ids: ['ref-1'], evidence_strength: 'direct', unknown_reason: null }]
  } } };
  const recorded = cp.spawnSync(process.execPath, [cli, 'record-event', '--output-dir', directory], { input: JSON.stringify(input), encoding: 'utf8' });
  assert.equal(recorded.status, 0, recorded.stdout);
  const retry = cp.spawnSync(process.execPath, [cli, 'record-event', '--output-dir', directory], { input: JSON.stringify(input), encoding: 'utf8' });
  assert.equal(retry.status, 0, retry.stdout);
  assert.equal(JSON.parse(retry.stdout).status, 'already_applied');
  const records = outbox.readLines(path.join(directory, 'telemetry/outbox.jsonl')).records;
  assert.deepEqual(records.slice(-2).map((record) => record.envelope.event_type), ['recon.fact_recorded', 'agent.task_completed']);
  assert.equal(records.length, 4);
});
