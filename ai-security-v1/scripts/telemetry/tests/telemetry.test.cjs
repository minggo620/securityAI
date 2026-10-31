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

test('default config is strict remote required with standing organization consent', () => {
  const config = validateConfig(defaultConfig());
  assert.equal(config.mode, 'remote');
  assert.equal(config.failure_policy, 'required');
  assert.equal(config.remote_sync.enabled, true);
  assert.equal(config.consent.remote_mysql, true);
  assert.equal(config.consent.authority_type, 'organization_policy');
});

test('process sidecar validates role-specific requirements', () => {
  const common = { schema_version: '1.5.0', agent_id: 'hunter-1', explicit_rationale: 'Evidence-backed short rationale.', evidence_refs: [], observations: [] };
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
  assert.throws(() => buildEvent({ run_id: runId, phase_code: 'P1', event_type: 'phase.started', actor_type: 'writer', idempotency_key: `run/${runId}/P1/writer`, payload: { projections: [{ table: 'audit_phase_execution', action: 'insert', values: { phase_execution_id: ulid(), run_id: '$run_id', phase_code: 'P1', attempt_no: 1, status: 'running', schema_version: '1.5.0', source_class: 'P' } }] }, source_refs: [] }, config), /writer actor is reserved/);
});

function sampleBuilt() {
  const config = defaultConfig();
  const runId = ulid();
  return buildEvent({ run_id: runId, phase_code: 'P1', event_type: 'phase.started', actor_type: 'parent', idempotency_key: `run/${runId}/P1/start`, payload: { projections: [{ table: 'audit_phase_execution', action: 'insert', values: { phase_execution_id: ulid(), run_id: '$run_id', phase_code: 'P1', attempt_no: 1, status: 'running', schema_version: '1.5.0', source_class: 'P' } }] }, source_refs: [] }, config);
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

test('strict config rejects off, local, and best_effort overrides', () => {
  for (const mode of ['off', 'local']) assert.throws(() => validateConfig({ ...defaultConfig(), mode }), /INVALID_CONFIG/);
  assert.throws(() => validateConfig({ ...defaultConfig(), failure_policy: 'best_effort' }), /INVALID_CONFIG/);
});

test('legacy wrapper commands are rejected for new sessions', () => {
  const wrapper = path.join(__dirname, '../audit-session.cjs');
  for (const command of ['init', 'event', 'snapshot', 'flush', 'finalize']) {
    const result = cp.spawnSync(process.execPath, [wrapper, command], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /STRICT_PREPARE_REQUIRED/);
  }
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

