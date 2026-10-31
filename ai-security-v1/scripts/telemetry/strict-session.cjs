#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { adaptAgentResult } = require('./agent-adapter.cjs');
const { canonicalJson } = require('./canonical-json.cjs');
const { defaultConfig, validateConfig } = require('./config.cjs');
const database = require('./database-client.cjs');
const { buildEvent, sha256 } = require('./event-builder.cjs');
const outbox = require('./outbox.cjs');
const { operationsFor, validateEventAgainstHistory, validateTaskStartIds } = require('./projection.cjs');
const { ulid } = require('./ulid.cjs');

const OPERATION_MODES = new Set(['guidance', 'focused_review', 'full_audit', 'database']);
const RETRYABLE = new Set(['DB_UNAVAILABLE']);

function response(value, exitCode = 0) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
  process.exitCode = exitCode;
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
  const text = args.input
    ? fs.readFileSync(assertRegular(path.resolve(args.input), 'input'), 'utf8')
    : fs.readFileSync(0, 'utf8');
  return text.trim() ? JSON.parse(text) : {};
}

function assertRegular(file, name) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error(`${name} must be a single-link regular file`);
  return file;
}

function safeError(error, stage, attempts = 1) {
  const message = error instanceof Error ? error.message : String(error);
  let code = error?.code || message.match(/^([A-Z_]+):/)?.[1] || 'PROJECTION_FAILED';
  if (code === 'DB_UNAVAILABLE' && /CODEX_SANDBOX_NETWORK_DISABLED/i.test(message)) code = 'NETWORK_AUTHORIZATION_REQUIRED';
  if (code === 'OUTBOX_CORRUPT') code = 'OUTBOX_UNWRITABLE';
  const reasons = {
    MYSQL_CLIENT_UNAVAILABLE: 'mysql client is unavailable',
    NETWORK_AUTHORIZATION_REQUIRED: 'network authorization is required',
    DB_UNAVAILABLE: 'remote MySQL is unavailable or timed out',
    AUTH_REQUIRED: 'database authentication or authorization failed',
    TLS_ERROR: 'TLS negotiation failed',
    SCHEMA_INCOMPATIBLE: 'remote ai_security schema does not match the pinned contract',
    OUTBOX_UNWRITABLE: 'local telemetry state is not safely writable',
    PROJECTION_FAILED: 'the telemetry projection was rejected',
    TASK_ID_REUSE: 'an agent task ID was already used in this run; assign a fresh ID before preparing telemetry',
    CONCURRENCY_CONFLICT: 'the remote row version changed concurrently',
    IDEMPOTENCY_CONFLICT: 'the idempotency key conflicts with another request',
    INVALID_CONFIG: 'strict remote telemetry configuration is invalid',
    NOTICE_REQUIRED: 'the prepared transaction notice token is missing or invalid',
    ORDER_VIOLATION: 'prepared transactions must be committed in order'
  };
  return {
    ok: false,
    stage,
    code,
    safe_reason: reasons[code] || 'telemetry operation failed',
    retryable: RETRYABLE.has(code),
    attempts,
    next_action: RETRYABLE.has(code)
      ? (stage === 'database_preflight' ? 'restore database availability and rerun check-db' : 'retry the same transaction with the same notice token')
      : 'resolve the reported blocker before continuing'
  };
}

function defaultOutputDir() {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(os.homedir(), '.codex', 'state', 'ai-security-v1', 'sessions', date, ulid());
}

function ensureOutputDir(value) {
  const directory = path.resolve(value || defaultOutputDir());
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('OUTBOX_UNWRITABLE: session directory is unsafe');
  fs.chmodSync(directory, 0o700);
  outbox.ensureTelemetryDir(directory);
  return directory;
}

function checkDb(args) {
  const outputDir = ensureOutputDir(args.output_dir);
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const state = database.preflight({ tlsMode: 'PREFERRED' });
      database.runMysql("START TRANSACTION; SET @strict_probe=1; PREPARE strict_probe FROM 'SELECT ?'; EXECUTE strict_probe USING @strict_probe; DEALLOCATE PREPARE strict_probe; ROLLBACK;", { tlsMode: 'PREFERRED' });
      const receipt = {
        protocol_version: '1.5.0',
        status: 'passed',
        checked_at: new Date().toISOString(),
        database: 'ai_security',
        schema_version: '1.3.0-core',
        table_count: state.columns.size,
        server_version: state.server_version,
        tls_active: Boolean(state.ssl_cipher),
        accepted_risks: ['tls_identity_not_verified', 'broad_database_account']
      };
      const receiptPath = preflightFile(outputDir);
      if (fs.existsSync(receiptPath)) assertRegular(receiptPath, 'database preflight receipt');
      replaceSecure(receiptPath, receipt);
      return response({
        ok: true,
        stage: 'database_preflight',
        status: 'passed',
        attempts: attempt,
        output_dir: outputDir,
        receipt_file: receiptPath,
        database: receipt.database,
        schema_version: receipt.schema_version,
        table_count: receipt.table_count,
        server_version: receipt.server_version,
        tls_active: receipt.tls_active,
        accepted_risks: receipt.accepted_risks
      });
    } catch (error) {
      const failure = safeError(error, 'database_preflight', attempt);
      if (failure.code === 'DB_UNAVAILABLE' && attempt === 1) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
        continue;
      }
      return response(failure, 1);
    }
  }
}

function configFile(outputDir) { return path.join(outputDir, 'telemetry', 'config.json'); }
function preflightFile(outputDir) { return path.join(outputDir, 'telemetry', 'preflight-receipt.json'); }

function writeExclusive(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, `${canonicalJson(value)}\n`, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function replaceSecure(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  writeExclusive(temporary, value);
  fs.renameSync(temporary, file);
}

function loadPreflightReceipt(outputDir, requireFresh = false) {
  const file = preflightFile(outputDir);
  if (!fs.existsSync(file)) throw new Error('DB_UNAVAILABLE: database preflight receipt is missing');
  const receipt = JSON.parse(fs.readFileSync(assertRegular(file, 'database preflight receipt'), 'utf8'));
  const checkedAt = Date.parse(receipt.checked_at);
  if (receipt.status !== 'passed' || receipt.database !== 'ai_security' || receipt.schema_version !== '1.3.0-core' || receipt.table_count !== 36 || !Number.isFinite(checkedAt) || checkedAt > Date.now() + 60000 || (requireFresh && Date.now() - checkedAt > 15 * 60 * 1000)) {
    throw new Error('DB_UNAVAILABLE: database preflight receipt is absent, stale, or invalid');
  }
  return receipt;
}

function assertNoPendingPlans(outputDir) {
  const directory = path.join(outputDir, 'telemetry', 'prepared');
  if (!fs.existsSync(directory)) return;
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('OUTBOX_UNWRITABLE: prepared-plan directory is unsafe');
  for (const entry of fs.readdirSync(directory).filter((name) => /^[0-9A-HJKMNP-TV-Z]{26}\.json$/.test(name))) {
    const plan = JSON.parse(fs.readFileSync(assertRegular(path.join(directory, entry), 'prepared plan'), 'utf8'));
    const state = JSON.parse(fs.readFileSync(assertRegular(path.join(directory, `${plan.plan_id}.state.json`), 'prepared state'), 'utf8'));
    if (state.next_ordinal !== plan.transactions.length + 1 || state.commits.length !== plan.transactions.length) {
      throw new Error('ORDER_VIOLATION: the current prepared plan is not fully committed');
    }
    for (const transaction of plan.transactions) {
      const commit = state.commits.find((item) => item.ordinal === transaction.ordinal);
      if (!commit || commit.event_id !== transaction.event_id || !['projected', 'already_applied'].includes(commit.status)) throw new Error('ORDER_VIOLATION: the current prepared plan lacks a committed transaction proof');
    }
  }
}

function loadStrictConfig(outputDir, create = false) {
  const file = configFile(outputDir);
  if (!fs.existsSync(file)) {
    if (!create) throw new Error('INVALID_CONFIG: strict session has not been initialized');
    const config = validateConfig(defaultConfig());
    writeExclusive(file, config);
    return config;
  }
  const config = JSON.parse(fs.readFileSync(assertRegular(file, 'config'), 'utf8'));
  return validateConfig(config);
}

function mysqlDate(date = new Date()) { return date.toISOString().replace('T', ' ').replace('Z', ''); }

function skillManifestHash() {
  const root = path.resolve(__dirname, '../..');
  const files = [];
  const visit = (directory, relative = '') => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const childRelative = path.join(relative, entry.name);
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'tests') visit(child, childRelative);
      } else if (entry.isFile() && /\.(?:md|json|ya?ml|cjs)$/.test(entry.name) && !entry.name.endsWith('.test.cjs')) files.push(childRelative);
    }
  };
  visit(root);
  const hash = crypto.createHash('sha256');
  for (const file of files) hash.update(file).update('\0').update(fs.readFileSync(path.join(root, file)));
  return hash.digest('hex');
}

function initEvents(input) {
  const operationMode = input.operation_mode;
  if (!OPERATION_MODES.has(operationMode)) throw new Error('INVALID_CONFIG: invalid operation_mode');
  const runId = input.run_id || ulid();
  const phaseId = input.phase_execution_id || ulid();
  const initializedEventId = ulid();
  const requestKey = input.request_idempotency_key || `strict/${input.request_fingerprint || sha256(canonicalJson(input))}`;
  const projections = [{
    table: 'audit_run', action: 'insert', values: {
      run_id: runId,
      request_idempotency_key: requestKey,
      request_idempotency_hash: { $hex: sha256(requestKey.normalize('NFC')) },
      repo: input.repo || 'non-repository',
      target_locator_redacted: input.target || 'unspecified',
      target_locator_policy: 'relative_or_pseudonymized',
      source_ref: input.source_ref || 'not-applicable',
      worktree_dirty: Boolean(input.worktree_dirty),
      profile: input.profile || 'standard',
      budget: input.budget ?? null,
      execution_policy: input.execution_policy || 'sandboxed-source-and-local-only',
      skill_manifest_sha256: { $hex: skillManifestHash() },
      skill_schema_version: '1.5.0',
      telemetry_mode: 'remote',
      telemetry_failure_policy: 'required',
      run_status: 'initializing',
      telemetry_local_status: 'healthy',
      telemetry_remote_status: 'pending_sync',
      outbox_status: 'pending',
      incomplete_reason: null,
      telemetry_incomplete_reason: null,
      started_at: mysqlDate(),
      ended_at: null,
      schema_version: '1.5.0',
      source_class: 'P',
      row_version: 0
    }
  }, {
    table: 'audit_phase_execution', action: 'insert', values: {
      phase_execution_id: phaseId, run_id: runId, phase_code: 'P0', attempt_no: 1, status: 'running', input_payload_id: '$payload_id', output_payload_id: null, failure_reason: null, started_at: mysqlDate(), ended_at: null, schema_version: '1.5.0', source_class: 'P'
    }
  }];
  for (const [index, scope] of (input.scope_paths || []).entries()) projections.push({ table: 'audit_run_scope', action: 'insert', values: { scope_id: ulid(), run_id: runId, ordinal: index + 1, scope_type: scope.scope_type || 'path', scope_value: scope.scope_value || scope.path || String(scope), included: scope.included !== false, reason: scope.reason || null, schema_version: '1.5.0', source_class: scope.source_class || 'S' } });
  const initialized = {
    event_id: initializedEventId, run_id: runId, phase_code: 'P0', event_type: 'run.initialized', actor_type: 'parent', source_class: 'P', payload_type: 'run.initialized',
    idempotency_key: `request/${requestKey}/P0/init`,
    payload: { _telemetry: { phase_execution_id: phaseId }, session: { operation_mode: operationMode, request_fingerprint: input.request_fingerprint || null, target: input.target || 'unspecified' }, projections }, source_refs: []
  };
  const preflight = {
    run_id: runId, phase_code: 'P0', event_type: 'run.preflight_completed', actor_type: 'parent', causation_id: initializedEventId, source_class: 'P', payload_type: 'run.preflight',
    idempotency_key: `run/${runId}/P0/preflight`,
    payload: { _telemetry: { phase_execution_id: phaseId }, preflight: { status: 'passed', database: 'ai_security', schema_version: '1.3.0-core', table_count: 36, operation_mode: operationMode }, projections: [{ table: 'audit_run', action: 'update', values: { run_status: 'in_progress', row_version: 1 }, where: { run_id: runId, row_version: 0 } }] }, source_refs: []
  };
  return { events: [initialized, preflight], run_id: runId, phase_execution_id: phaseId };
}

function finalEvent(input) {
  const expected = input.expected_row_version ?? 1;
  return {
    run_id: input.run_id, phase_code: 'P6', event_type: 'run.finalized', actor_type: 'parent', source_class: 'P', payload_type: 'run.finalized',
    idempotency_key: input.idempotency_key || `run/${input.run_id}/P6/final/${input.run_status || 'complete'}`,
    payload: { _telemetry: { phase_execution_id: input.phase_execution_id || null }, final_status: { operation_mode: input.operation_mode, outcome_category: input.outcome_category || null, action_categories: input.action_categories || [], evidence_count: input.evidence_count || 0, conclusion_count: input.conclusion_count || 0, run_status: input.run_status || 'complete' }, projections: [{ table: 'audit_run', action: 'update', values: { run_status: input.run_status || 'complete', telemetry_local_status: 'healthy', telemetry_remote_status: 'synced', outbox_status: 'empty', incomplete_reason: input.incomplete_reason || null, telemetry_incomplete_reason: null, ended_at: mysqlDate(), row_version: expected + 1 }, where: { run_id: input.run_id, row_version: expected } }] }, source_refs: []
  };
}

function snapshotEvent(outputDir, input) {
  const file = outbox.resolveInside(outputDir, input.relative_path);
  const bytes = fs.readFileSync(assertRegular(file, 'snapshot target'));
  const contentHash = sha256(bytes);
  return {
    run_id: input.run_id, phase_code: input.phase_code, event_type: 'artifact.snapshot_created', actor_type: 'parent', source_class: input.source_class || 'O', payload_type: input.artifact_kind,
    idempotency_key: input.idempotency_key || `run/${input.run_id}/${input.phase_code}/artifact/${input.artifact_kind}/${input.version_no || 1}/${contentHash}`,
    payload: { _telemetry: { phase_execution_id: input.phase_execution_id || null }, artifact: { relative_path: input.relative_path, content_sha256: contentHash, byte_size: bytes.length }, snapshot_text: bytes.length <= 5242880 ? bytes.toString('utf8') : null, projections: [{ table: 'audit_artifact', action: 'insert', values: { artifact_id: input.artifact_id || ulid(), run_id: input.run_id, owner_task_id: input.owner_task_id || null, artifact_kind: input.artifact_kind, version_no: input.version_no || 1, artifact_status: input.artifact_status || 'final', relative_path: input.relative_path, path_hash: { $hex: sha256(input.relative_path.normalize('NFC')) }, content_sha256: { $hex: contentHash }, byte_size: bytes.length, mime_type: input.mime_type || 'application/octet-stream', promotion_status: input.promotion_status || 'promoted', promotion_reason: input.promotion_reason || null, schema_version: '1.5.0', source_class: input.source_class || 'O' } }] }, source_refs: input.source_refs || []
  };
}

const PURPOSES = {
  'run.initialized': 'record the security task start and strict execution policy',
  'run.preflight_completed': 'record successful database and isolation preflight',
  'interaction.checkpoint_recorded': 'record a redacted structured interaction summary',
  'database.operation_authorized': 'record the authorized database operation checkpoint',
  'database.operation_completed': 'record database operation outcome metadata',
  'run.finalized': 'record the terminal run and telemetry state'
};

function manifestFor(built, ordinal, planId) {
  const { operations } = operationsFor(built.event);
  const tables = [...new Set(['audit_payload', 'audit_event', ...operations.map((item) => item.table)])];
  const data = operations.length ? operations.map((item) => `${item.action}:${item.table}`).join(', ') : built.event.payload_type;
  const notice = {
    position: `${built.event.phase_code} / ${built.event.event_type}`,
    purpose: PURPOSES[built.event.event_type] || `record ${built.event.event_type}`,
    data_summary: data,
    target_tables: tables,
    data_level: 'redacted structured data; excludes credentials, complete environments, raw sensitive rows, and hidden reasoning'
  };
  const noticeToken = sha256(canonicalJson({ plan_id: planId, ordinal, envelope_sha256: built.envelope_sha256, notice }));
  return { ordinal, event_id: built.event.event_id, event_type: built.event.event_type, phase_code: built.event.phase_code, envelope_sha256: built.envelope_sha256, estimated_rows: operations.length + 2, notice, notice_token: noticeToken };
}

function prepare(args) {
  const outputDir = ensureOutputDir(args.output_dir);
  const input = readInput(args);
  loadPreflightReceipt(outputDir, input.kind === 'init');
  assertNoPendingPlans(outputDir);
  if (input.kind === 'init' && fs.existsSync(configFile(outputDir))) throw new Error('INVALID_CONFIG: strict session is already initialized');
  const config = loadStrictConfig(outputDir, input.kind === 'init');
  let eventInputs;
  let extra = {};
  if (input.kind === 'init') {
    const initialized = initEvents(input);
    eventInputs = initialized.events;
    extra = { run_id: initialized.run_id, phase_execution_id: initialized.phase_execution_id };
  } else if (input.kind === 'event') {
    if (input.agent_result) {
      const adapted = adaptAgentResult(input);
      eventInputs = adapted.events;
      extra = { entities: adapted.entities };
    } else eventInputs = [input.event || input];
  } else if (input.kind === 'snapshot') eventInputs = [snapshotEvent(outputDir, input)];
  else if (input.kind === 'finalize') eventInputs = [finalEvent(input)];
  else throw new Error('INVALID_CONFIG: prepare kind must be init, event, snapshot, or finalize');

  const outboxFile = outbox.resolveInside(outputDir, config.outbox_relative_path);
  const history = outbox.readLines(outboxFile, false).records;
  validateTaskStartIds(eventInputs, history);

  const built = eventInputs.map((eventInput) => buildEvent(eventInput, config));
  const planId = ulid();
  const transactions = built.map((item, index) => manifestFor(item, index + 1, planId));
  const plan = { schema_version: '1.5.0', plan_id: planId, created_at: new Date().toISOString(), output_dir: outputDir, transactions, built };
  const directory = path.join(outputDir, 'telemetry', 'prepared');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const preparedStat = fs.lstatSync(directory);
  if (!preparedStat.isDirectory() || preparedStat.isSymbolicLink()) throw new Error('OUTBOX_UNWRITABLE: prepared-plan directory is unsafe');
  fs.chmodSync(directory, 0o700);
  writeExclusive(path.join(directory, `${planId}.json`), plan);
  writeExclusive(path.join(directory, `${planId}.state.json`), { plan_id: planId, next_ordinal: 1, attempts: {}, commits: [] });
  response({ ok: true, status: 'prepared', output_dir: outputDir, plan_id: planId, transactions, ...extra });
}

function loadPlan(outputDir, planId) {
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(planId || '')) throw new Error('INVALID_CONFIG: invalid plan_id');
  const directory = path.join(outputDir, 'telemetry', 'prepared');
  const plan = JSON.parse(fs.readFileSync(assertRegular(path.join(directory, `${planId}.json`), 'prepared plan'), 'utf8'));
  const stateFile = assertRegular(path.join(directory, `${planId}.state.json`), 'prepared state');
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  return { plan, state, stateFile };
}

function replaceState(file, state) {
  const temporary = `${file}.${process.pid}.tmp`;
  writeExclusive(temporary, state);
  fs.renameSync(temporary, file);
}

function projectThrough(outputDir, config, targetSequence) {
  const outboxFile = outbox.resolveInside(outputDir, config.outbox_relative_path);
  const records = outbox.readLines(outboxFile, true).records;
  const checkpoint = outbox.validateCheckpoint(records, outbox.readCheckpoint(outputDir));
  const distance = targetSequence - checkpoint.sequence;
  if (distance === 0) {
    const record = records[targetSequence - 1];
    if (record && database.existingEnvelope(record, { tlsMode: config.remote_sync.tls_mode }) === record.envelope_sha256) return 'already_applied';
    throw new Error('PROJECTION_FAILED: checkpointed event is absent remotely');
  }
  if (distance !== 1) throw new Error('ORDER_VIOLATION: commit-next may project exactly one transaction');
  const remote = database.preflight({ tlsMode: config.remote_sync.tls_mode });
  let status = 'already_applied';
  for (const record of records.filter((item) => item.sequence > checkpoint.sequence && item.sequence <= targetSequence)) {
    const result = database.applyEvent(record, remote, { tlsMode: config.remote_sync.tls_mode });
    status = result.status;
    outbox.writeCheckpoint(outputDir, { sequence: record.sequence, record_sha256: record.record_sha256, event_id: record.envelope.event_id, committed_at: new Date().toISOString() });
  }
  return status;
}

function commitNext(args) {
  const outputDir = ensureOutputDir(args.output_dir);
  const config = loadStrictConfig(outputDir, false);
  const { plan, state, stateFile } = loadPlan(outputDir, args.plan_id);
  const ordinal = Number(args.ordinal);
  if (ordinal !== state.next_ordinal) return response(safeError(new Error('ORDER_VIOLATION: wrong ordinal'), 'transaction_commit', 0), 1);
  const transaction = plan.transactions[ordinal - 1];
  if (!transaction || args.notice_token !== transaction.notice_token) return response(safeError(new Error('NOTICE_REQUIRED: invalid token'), 'transaction_commit', 0), 1);
  const attempts = state.attempts[String(ordinal)] || 0;
  const retry = args.retry === true || args.retry === 'true';
  if ((attempts === 0 && retry) || (attempts === 1 && !retry) || attempts > 1) return response(safeError(new Error('ORDER_VIOLATION: invalid retry state'), 'transaction_commit', attempts), 1);
  const built = plan.built[ordinal - 1];
  try {
    operationsFor(built.event);
    const outboxFile = outbox.resolveInside(outputDir, config.outbox_relative_path);
    const history = outbox.readLines(outboxFile, true).records;
    validateEventAgainstHistory(built.event, history);
    const appended = outbox.append(outputDir, config.outbox_relative_path, built);
    state.attempts[String(ordinal)] = attempts + 1;
    replaceState(stateFile, state);
    if (retry) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    }
    const status = projectThrough(outputDir, config, appended.record.sequence);
    state.next_ordinal += 1;
    state.commits.push({ ordinal, event_id: appended.record.envelope.event_id, status, notice_sha256: sha256(canonicalJson(transaction.notice)), committed_at: new Date().toISOString() });
    replaceState(stateFile, state);
    return response({ ok: true, stage: 'transaction_commit', status, attempts: attempts + 1, plan_id: plan.plan_id, ordinal, event_id: appended.record.envelope.event_id, position: transaction.notice.position, transaction: 'committed' });
  } catch (error) {
    state.attempts[String(ordinal)] = attempts + 1;
    replaceState(stateFile, state);
    const failure = safeError(error, 'transaction_commit', attempts + 1);
    if (failure.code === 'DB_UNAVAILABLE' && attempts === 0) return response({ ...failure, status: 'retry_required', retry_after_ms: 1000, plan_id: plan.plan_id, ordinal, position: transaction.notice.position }, 75);
    return response({ ...failure, status: 'blocked', plan_id: plan.plan_id, ordinal, position: transaction.notice.position }, 1);
  }
}

function validateTerminalSequence(records, preflightReceipt) {
  const events = records.map((record) => record.envelope);
  const types = events.map((event) => event.event_type);
  const runIds = new Set(events.map((event) => event.run_id));
  if (runIds.size !== 1) throw new Error('OUTBOX_CORRUPT: a strict session may contain only one run');
  if (types[0] !== 'run.initialized' || types[1] !== 'run.preflight_completed') throw new Error('PROJECTION_FAILED: initialization sequence is incomplete');
  if (types.at(-1) !== 'run.finalized' || types.filter((type) => type === 'run.finalized').length !== 1) throw new Error('PROJECTION_FAILED: terminal event is missing or duplicated');
  const initializedAt = Date.parse(events[0].occurred_at);
  if (!Number.isFinite(initializedAt) || initializedAt < Date.parse(preflightReceipt.checked_at)) throw new Error('PROJECTION_FAILED: database preflight did not precede task initialization');
  const operationMode = events[0].payload?.content?.session?.operation_mode;
  if (!OPERATION_MODES.has(operationMode)) throw new Error('PROJECTION_FAILED: operation mode is missing from initialization');
  const requireType = (type) => { if (!types.includes(type)) throw new Error(`PROJECTION_FAILED: required ${type} event is missing`); };
  if (operationMode === 'guidance') {
    const expected = ['run.initialized', 'run.preflight_completed', 'interaction.checkpoint_recorded', 'run.finalized'];
    if (canonicalJson(types) !== canonicalJson(expected)) throw new Error('PROJECTION_FAILED: Guidance requires exactly four ordered transactions');
  } else if (operationMode === 'focused_review') {
    for (const type of ['phase.started', 'interaction.checkpoint_recorded', 'phase.completed']) requireType(type);
    if (types.indexOf('phase.started') > types.indexOf('phase.completed')) throw new Error('PROJECTION_FAILED: focused-review phase ordering is invalid');
  } else if (operationMode === 'database') {
    requireType('database.operation_authorized');
    requireType('database.operation_completed');
    if (types.indexOf('database.operation_authorized') > types.indexOf('database.operation_completed')) throw new Error('PROJECTION_FAILED: database operation completion precedes authorization');
  } else if (operationMode === 'full_audit') {
    for (const phase of ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6']) {
      if (!events.some((event) => event.phase_code === phase)) throw new Error(`PROJECTION_FAILED: full audit is missing ${phase} records`);
    }
    requireType('artifact.snapshot_created');
    requireType('research.input_frozen');
  }
  const started = new Set(events.filter((event) => event.event_type === 'agent.task_started').map((event) => event.agent_task_id));
  const terminal = new Set(events.filter((event) => ['agent.task_completed', 'agent.task_discarded'].includes(event.event_type)).map((event) => event.agent_task_id));
  for (const event of events.filter((item) => item.agent_task_id && item.event_type !== 'agent.task_started')) {
    if (!started.has(event.agent_task_id)) throw new Error('PROJECTION_FAILED: Agent result has no matching task-start event');
  }
  for (const taskId of started) if (!terminal.has(taskId)) throw new Error('PROJECTION_FAILED: Agent task has no terminal result event');
  return { events, operationMode };
}

function verify(args) {
  const outputDir = ensureOutputDir(args.output_dir);
  const config = loadStrictConfig(outputDir, false);
  try {
    const file = outbox.resolveInside(outputDir, config.outbox_relative_path);
    const records = outbox.readLines(file, false).records;
    if (!records.length) throw new Error('OUTBOX_CORRUPT: no telemetry events');
    const checkpoint = outbox.validateCheckpoint(records, outbox.readCheckpoint(outputDir));
    if (checkpoint.sequence !== records.length) throw new Error('OUTBOX_CORRUPT: uncommitted Outbox tail');
    const preflightReceipt = loadPreflightReceipt(outputDir, false);
    const { events, operationMode } = validateTerminalSequence(records, preflightReceipt);
    const preparedDirectory = path.join(outputDir, 'telemetry', 'prepared');
    const committedEventIds = new Set();
    for (const entry of fs.readdirSync(preparedDirectory).filter((name) => /^[0-9A-HJKMNP-TV-Z]{26}\.json$/.test(name))) {
      const plan = JSON.parse(fs.readFileSync(assertRegular(path.join(preparedDirectory, entry), 'prepared plan'), 'utf8'));
      const state = JSON.parse(fs.readFileSync(assertRegular(path.join(preparedDirectory, `${plan.plan_id}.state.json`), 'prepared state'), 'utf8'));
      if (state.next_ordinal !== plan.transactions.length + 1 || state.commits.length !== plan.transactions.length) throw new Error('OUTBOX_CORRUPT: prepared plan is not fully committed');
      for (const [index, transaction] of plan.transactions.entries()) {
        const ordinal = index + 1;
        const commit = state.commits.find((item) => item.ordinal === ordinal);
        const expectedToken = sha256(canonicalJson({ plan_id: plan.plan_id, ordinal, envelope_sha256: transaction.envelope_sha256, notice: transaction.notice }));
        if (transaction.ordinal !== ordinal || transaction.notice_token !== expectedToken || !commit || commit.event_id !== transaction.event_id || commit.notice_sha256 !== sha256(canonicalJson(transaction.notice)) || !['projected', 'already_applied'].includes(commit.status)) {
          throw new Error('OUTBOX_CORRUPT: prepared notice or commit proof is invalid');
        }
        if (committedEventIds.has(commit.event_id)) throw new Error('OUTBOX_CORRUPT: duplicate prepared commit proof');
        committedEventIds.add(commit.event_id);
      }
    }
    if (committedEventIds.size !== records.length || records.some((record) => !committedEventIds.has(record.envelope.event_id))) throw new Error('OUTBOX_CORRUPT: an event lacks an individual prepared commit proof');
    const last = records.at(-1);
    for (const record of records) {
      const remoteHash = database.existingEnvelope(record, { tlsMode: config.remote_sync.tls_mode });
      if (remoteHash !== record.envelope_sha256) throw new Error('PROJECTION_FAILED: a remote event commit proof is absent');
    }
    const expectedRunStatus = last.envelope.payload?.content?.final_status?.run_status;
    const remoteRun = database.runMysql(`SELECT run_status,telemetry_remote_status,outbox_status FROM audit_run WHERE run_id='${last.envelope.run_id}' LIMIT 1;`, { tlsMode: config.remote_sync.tls_mode }).trim().split('\t');
    if (!expectedRunStatus || remoteRun[0] !== expectedRunStatus || remoteRun[1] !== 'synced' || remoteRun[2] !== 'empty') throw new Error('PROJECTION_FAILED: remote run terminal state differs from the local terminal event');
    const receipt = { schema_version: '1.5.0', operation_mode: operationMode, run_id: last.envelope.run_id, final_event_id: last.envelope.event_id, outbox_records: records.length, checkpoint_sequence: checkpoint.sequence, remote_envelope_sha256: last.envelope_sha256, verified_event_count: events.length, verified_at: new Date().toISOString() };
    const receiptFile = path.join(outputDir, 'telemetry', 'completion-receipt.json');
    if (!fs.existsSync(receiptFile)) writeExclusive(receiptFile, receipt);
    return response({ ok: true, stage: 'session_verify', status: 'verified', receipt_file: receiptFile, ...receipt });
  } catch (error) {
    return response(safeError(error, 'session_verify', 1), 1);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (command === 'check-db') return checkDb(args);
  if (command === 'prepare') return prepare(args);
  if (command === 'commit-next') return commitNext(args);
  if (command === 'verify') return verify(args);
  throw new Error('unknown strict command; use check-db, prepare, commit-next, or verify');
}

try { main(); } catch (error) { response(safeError(error, 'strict_session', 1), 1); }

