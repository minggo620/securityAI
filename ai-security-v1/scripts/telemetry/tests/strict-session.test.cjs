'use strict';

const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const cli = path.join(__dirname, '../strict-session.cjs');
const blockedEnv = {
  ...process.env,
  AI_SECURITY_DB_HOST: '127.0.0.1',
  AI_SECURITY_DB_PORT: '1',
  AI_SECURITY_DB_USER: 'synthetic',
  AI_SECURITY_DB_NAME: 'ai_security',
  MYSQL_PWD: 'synthetic-test-password'
};

function invoke(command, directory, input, extra = []) {
  return cp.spawnSync(process.execPath, [cli, command, '--output-dir', directory, ...extra], {
    input: input === undefined ? '' : JSON.stringify(input),
    encoding: 'utf8',
    env: blockedEnv,
    timeout: 10000
  });
}

function preparedInit() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'strict-session-'));
  fs.mkdirSync(path.join(directory, 'telemetry'), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(directory, 'telemetry', 'preflight-receipt.json'), JSON.stringify({
    protocol_version: '1.5.0', status: 'passed', checked_at: new Date().toISOString(), database: 'ai_security', schema_version: '1.3.0-core', table_count: 36,
    server_version: '8.0.26', tls_active: true, accepted_risks: ['tls_identity_not_verified', 'broad_database_account']
  }), { mode: 0o600 });
  const result = invoke('prepare', directory, {
    kind: 'init',
    operation_mode: 'guidance',
    request_fingerprint: 'a'.repeat(64),
    repo: 'synthetic',
    target: 'synthetic',
    source_ref: null,
    profile: 'standard',
    request_idempotency_key: `synthetic-${Date.now()}-${Math.random()}`
  });
  assert.equal(result.status, 0, result.stdout || result.stderr);
  return { directory, prepared: JSON.parse(result.stdout) };
}

test('prepare init is blocked until check-db has produced a fresh receipt', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'strict-no-preflight-'));
  const result = invoke('prepare', directory, { kind: 'init', operation_mode: 'guidance', request_fingerprint: 'a'.repeat(64) });
  assert.notEqual(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.code, 'DB_UNAVAILABLE');
  assert.equal(fs.existsSync(path.join(directory, 'telemetry', 'config.json')), false);
});

test('prepare init creates two immutable individually-noticed transactions', () => {
  const { directory, prepared } = preparedInit();
  assert.equal(prepared.status, 'prepared');
  assert.equal(prepared.transactions.length, 2);
  assert.deepEqual(prepared.transactions.map((entry) => entry.event_type), ['run.initialized', 'run.preflight_completed']);
  for (const [index, entry] of prepared.transactions.entries()) {
    assert.equal(entry.ordinal, index + 1);
    assert.match(entry.notice_token, /^[0-9a-f]{64}$/);
    assert.ok(entry.notice.target_tables.includes('audit_event'));
    assert.doesNotMatch(JSON.stringify(entry.notice), /synthetic-test-password/);
  }
  const plan = path.join(directory, 'telemetry', 'prepared', `${prepared.plan_id}.json`);
  assert.equal(fs.lstatSync(plan).isSymbolicLink(), false);
  assert.equal(fs.statSync(plan).mode & 0o777, 0o600);
});

test('commit-next rejects wrong order and invalid notice token before database access', () => {
  const { directory, prepared } = preparedInit();
  const second = prepared.transactions[1];
  const outOfOrder = invoke('commit-next', directory, undefined, ['--plan-id', prepared.plan_id, '--ordinal', '2', '--notice-token', second.notice_token]);
  assert.notEqual(outOfOrder.status, 0);
  assert.equal(JSON.parse(outOfOrder.stdout).code, 'ORDER_VIOLATION');
  const first = prepared.transactions[0];
  const invalid = invoke('commit-next', directory, undefined, ['--plan-id', prepared.plan_id, '--ordinal', '1', '--notice-token', '0'.repeat(64)]);
  assert.notEqual(invalid.status, 0);
  assert.equal(JSON.parse(invalid.stdout).code, 'NOTICE_REQUIRED');
  assert.equal(fs.existsSync(path.join(directory, 'telemetry', 'outbox.jsonl')), false);
});

test('a new plan cannot be prepared while the current plan has an uncommitted transaction', () => {
  const { directory, prepared } = preparedInit();
  const result = invoke('prepare', directory, {
    kind: 'event', run_id: prepared.run_id, phase_code: 'P0', event_type: 'interaction.checkpoint_recorded',
    idempotency_key: `run/${prepared.run_id}/checkpoint`, payload: { summary: { category: 'synthetic' }, projections: [] }, source_refs: []
  });
  assert.notEqual(result.status, 0);
  assert.equal(JSON.parse(result.stdout).code, 'ORDER_VIOLATION');
});

test('unavailable MySQL requires exactly one explicit retry and retains one Outbox event', () => {
  const { directory, prepared } = preparedInit();
  const first = prepared.transactions[0];
  const args = ['--plan-id', prepared.plan_id, '--ordinal', '1', '--notice-token', first.notice_token];
  const attempt = invoke('commit-next', directory, undefined, args);
  assert.equal(attempt.status, 75, attempt.stdout || attempt.stderr);
  const firstFailure = JSON.parse(attempt.stdout);
  assert.equal(firstFailure.status, 'retry_required');
  assert.equal(firstFailure.code, 'DB_UNAVAILABLE');
  const retry = invoke('commit-next', directory, undefined, [...args, '--retry', 'true']);
  assert.notEqual(retry.status, 0);
  const finalFailure = JSON.parse(retry.stdout);
  assert.equal(finalFailure.status, 'blocked');
  assert.equal(finalFailure.attempts, 2);
  const lines = fs.readFileSync(path.join(directory, 'telemetry', 'outbox.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  const third = invoke('commit-next', directory, undefined, [...args, '--retry', 'true']);
  assert.notEqual(third.status, 0);
  assert.equal(JSON.parse(third.stdout).code, 'ORDER_VIOLATION');
});

test('database preflight failure returns only a stable safe reason', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'strict-preflight-'));
  const result = invoke('check-db', directory);
  assert.notEqual(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.stage, 'database_preflight');
  assert.equal(output.code, 'DB_UNAVAILABLE');
  assert.equal(output.retryable, true);
  assert.doesNotMatch(result.stdout, /synthetic-test-password|127\.0\.0\.1/);
});

test('interaction and database checkpoint events require no business-table projection', () => {
  const { buildEvent } = require('../event-builder.cjs');
  const { operationsFor } = require('../projection.cjs');
  const { defaultConfig } = require('../config.cjs');
  const { ulid } = require('../ulid.cjs');
  for (const eventType of ['interaction.checkpoint_recorded', 'database.operation_authorized']) {
    const event = buildEvent({ run_id: ulid(), phase_code: 'POST', event_type: eventType, idempotency_key: `${eventType}/synthetic`, payload: { summary: { category: 'synthetic' }, projections: [] }, source_refs: [] }, defaultConfig());
    assert.deepEqual(operationsFor(event.event).operations, []);
  }
});

test('Agent results expand into separately noticed transactions', () => {
  const { directory, prepared } = preparedInit();
  const stateFile = path.join(directory, 'telemetry', 'prepared', `${prepared.plan_id}.state.json`);
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  state.next_ordinal = 3;
  state.commits = prepared.transactions.map((transaction) => ({ ordinal: transaction.ordinal, event_id: transaction.event_id, status: 'projected' }));
  fs.writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 });
  const input = {
    kind: 'event',
    run_id: prepared.run_id,
    phase_code: 'P1',
    actor_type: 'recon',
    agent_task_id: require('../ulid.cjs').ulid(),
    idempotency_key: `run/${prepared.run_id}/P1/recon/synthetic`,
    context: { phase_execution_id: prepared.phase_execution_id, task_row_version: 0, accepted_fact_ids: ['fact-1'], architecture_fact_ids: [] },
    agent_result: {
      summary: 'synthetic observable result',
      _process: {
        schema_version: '1.5.0',
        result_type: 'recon',
        agent_id: 'recon-1',
        explicit_rationale: 'Direct synthetic source observation.',
        observations: [],
        evidence_refs: [{ ref_id: 'ref-1', fact_kind: 'source_fact', relative_path: 'src/app.js', start_line: 1, end_line: 2, scope: 'entry', description: 'Synthetic entry is reachable.', strength: 'direct' }],
        recon_facts: [{ fact_id: 'fact-1', recon_kind: 'surfaces_sinks', fact_kind: 'source_fact', statement: 'Synthetic reachable entry.', evidence_ref_ids: ['ref-1'], evidence_strength: 'direct', unknown_reason: null }]
      }
    }
  };
  const result = invoke('prepare', directory, input);
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const expanded = JSON.parse(result.stdout);
  assert.equal(expanded.transactions.length, 2);
  assert.deepEqual(expanded.transactions.map((item) => item.event_type), ['recon.fact_recorded', 'agent.task_completed']);
  assert.notEqual(expanded.transactions[0].notice_token, expanded.transactions[1].notice_token);
});

