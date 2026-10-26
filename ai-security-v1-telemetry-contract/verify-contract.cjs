'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');

const dir = __dirname;
const ddlPath = path.join(dir, '001_ai_security_core_schema.sql');
const generatorPath = path.join(dir, 'generate-core-ddl.cjs');
const prepareProbeGeneratorPath = path.join(dir, 'generate-remote-prepare-probe.cjs');
const alignmentVerifierPath = path.join(dir, 'verify-skill-db-alignment.cjs');
const jsonFiles = [
  'event-envelope.schema.json',
  'telemetry-config.schema.json',
  'agent-process-extension.schema.json',
  'projection-map.json',
  'skill-storage-contract.json',
  'target-mysql-profile.json'
];

function fail(message) { throw new Error(message); }
function sha256(value) { return crypto.createHash('sha256').update(value, 'utf8').digest('hex'); }
function readJson(name) {
  const text = fs.readFileSync(path.join(dir, name), 'utf8');
  const value = JSON.parse(text);
  return { text, value };
}

const before = fs.readFileSync(ddlPath, 'utf8');
const generation = cp.spawnSync(process.execPath, [generatorPath], { encoding: 'utf8' });
if (generation.status !== 0) fail(`DDL generator failed: ${generation.stderr || generation.stdout}`);
const ddl = fs.readFileSync(ddlPath, 'utf8');
if (ddl !== before) fail('DDL generation is not reproducible: committed output changed');

const prepareProbe = cp.spawnSync(process.execPath, [prepareProbeGeneratorPath], { encoding: 'utf8' });
if (prepareProbe.status !== 0) fail(`remote PREPARE probe generation failed: ${prepareProbe.stderr || prepareProbe.stdout}`);
if (/\bEXECUTE\s+audit_probe_stmt\b/i.test(prepareProbe.stdout)) fail('remote PREPARE probe must never execute candidate DDL');
if ((prepareProbe.stdout.match(/^PREPARE audit_probe_stmt/gm) || []).length !== 40) fail('remote PREPARE probe statement count mismatch');
if ((prepareProbe.stdout.match(/^DEALLOCATE PREPARE audit_probe_stmt/gm) || []).length !== 40) fail('remote PREPARE probe deallocation count mismatch');

const tableNames = [...ddl.matchAll(/CREATE TABLE (audit_[a-z_]+) \(/g)].map((m) => m[1]);
if (tableNames.length !== 36) fail(`expected 36 CREATE TABLE statements, found ${tableNames.length}`);
if (new Set(tableNames).size !== 36) fail('duplicate CREATE TABLE name');

const expectedTables = [
  'audit_schema_version','audit_run','audit_run_scope','audit_payload','audit_phase_execution','audit_event',
  'audit_agent_task','audit_tool_execution','audit_artifact','audit_evidence','audit_recon_fact','audit_architecture_snapshot',
  'audit_coverage_unit','audit_coverage_attempt','audit_check','audit_hypothesis','audit_hypothesis_version','audit_hypothesis_coverage',
  'audit_hypothesis_relation','audit_hypothesis_evidence','audit_hypothesis_score','audit_attack_plan','audit_attack_step',
  'audit_attack_execution','audit_candidate','audit_candidate_observation','audit_candidate_hypothesis',
  'audit_candidate_coverage','audit_validation','audit_validation_observation','audit_decision','audit_finding',
  'audit_finding_revision','audit_finding_evidence','audit_finding_coverage','audit_human_adjudication'
];
if (JSON.stringify(tableNames) !== JSON.stringify(expectedTables)) fail('table order or inventory differs from the frozen 36-table contract');

const deferred = [
  'audit_telemetry_consent','audit_run_relation','audit_writer_lease','audit_event_source_ref','audit_source_provenance',
  'audit_outbox_checkpoint','audit_ingest_failure','audit_surface','audit_trust_boundary','audit_coverage_block',
  'audit_critic_review','audit_critic_item','audit_validator_run','audit_report','audit_metric_value'
];
for (const name of deferred) if (ddl.includes(`CREATE TABLE ${name} (`)) fail(`deferred table leaked into core DDL: ${name}`);

const sqlWithoutComments = ddl.replace(/^--.*$/gm, '');
const forbiddenSql = /^\s*(DROP\b|TRUNCATE\b|DELETE\s+FROM\b|GRANT\b|REVOKE\b|CREATE\s+USER\b|ALTER\s+USER\b|SET\s+PASSWORD\b|USE\b)/im;
const forbiddenMatch = sqlWithoutComments.match(forbiddenSql);
if (forbiddenMatch) fail(`forbidden SQL operation present: ${forbiddenMatch[1]}`);
if (/password|passwd|secret|api[_-]?key|authorization\s*:/i.test(ddl)) fail('credential-like material present in DDL');
if (!ddl.includes('COLLATE=utf8mb4_general_ci')) fail('required table collation missing');
if (!ddl.includes("telemetry_failure_policy IN ('best_effort','required')")) fail('dual telemetry failure policy missing');
if (!ddl.includes('candidate_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL')) fail('candidate observation is not nullable before consolidation');
if (!ddl.includes('input_finding_revision_id')) fail('P5 finding revision input missing');
if (!ddl.includes('CREATE TABLE audit_hypothesis_relation')) fail('many-to-many hypothesis relation missing');
if (!ddl.includes('CREATE TABLE audit_hypothesis_coverage')) fail('many-to-many hypothesis coverage missing');
if (!ddl.includes("observation_kind IN ('hunter_proposal','prior_carried','verifier_new_root')")) fail('candidate observation origin semantics missing');
if (!ddl.includes("label_scheme='hypothesis_match_v1'")) fail('subject-specific adjudication scheme missing');

const constraintNames = [...ddl.matchAll(/CONSTRAINT ([a-z0-9_]+)/g)].map((m) => m[1]);
const duplicateConstraints = constraintNames.filter((name, index) => constraintNames.indexOf(name) !== index);
if (duplicateConstraints.length) fail(`duplicate constraint names: ${[...new Set(duplicateConstraints)].join(', ')}`);

const tableSet = new Set(tableNames);
const tableColumns = new Map();
for (const match of ddl.matchAll(/CREATE TABLE (audit_[a-z_]+) \(\n([\s\S]*?)\n\) ENGINE=/g)) {
  const columns = new Set();
  for (const line of match[2].split('\n')) {
    const column = line.match(/^  ([a-z][a-z0-9_]*)\s/);
    if (column) columns.add(column[1]);
  }
  tableColumns.set(match[1], columns);
}
for (const match of ddl.matchAll(/REFERENCES (audit_[a-z_]+)\s*\(/g)) {
  if (!tableSet.has(match[1])) fail(`foreign key references non-core table: ${match[1]}`);
}
for (const match of ddl.matchAll(/(?:KEY|UNIQUE KEY)\s+[a-z0-9_]+\s*\(([^)]+)\)/g)) {
  const createMatches = [...ddl.slice(0, match.index).matchAll(/CREATE TABLE (audit_[a-z_]+) \(/g)];
  if (!createMatches.length) continue;
  const table = createMatches[createMatches.length - 1][1];
  const columns = tableColumns.get(table) || new Set();
  for (const column of match[1].split(',').map((value) => value.trim().replace(/\s+\(\d+\)$/, ''))) {
    if (!columns.has(column)) fail(`index ${table}.${match[0].trim()} references missing column ${column}`);
  }
}

const bodyMarker = '\n-- schema body SHA-256: ';
const markerIndex = ddl.indexOf(bodyMarker);
if (markerIndex < 0) fail('schema body hash marker missing');
const body = ddl.slice(0, markerIndex);
const declaredBodyHash = ddl.slice(markerIndex + bodyMarker.length, markerIndex + bodyMarker.length + 64);
if (sha256(body) !== declaredBodyHash) fail('schema body SHA-256 mismatch');
if (!ddl.includes(`UNHEX('${declaredBodyHash}')`)) fail('schema version seed does not use schema body hash');
if (!ddl.includes("'1.3.0-core-draft', CURRENT_TIMESTAMP(6), 'P'")) fail('schema version seed must record its application time');

const loaded = Object.fromEntries(jsonFiles.map((name) => [name, readJson(name)]));
for (const [name, entry] of Object.entries(loaded)) {
  if (!entry.value || typeof entry.value !== 'object' || Array.isArray(entry.value)) fail(`${name} must contain one JSON object`);
  if (entry.value.schema_version && entry.value.schema_version !== '1.3.0') fail(`${name} schema_version mismatch`);
}

const eventSchema = loaded['event-envelope.schema.json'].value;
const requiredEnvelope = ['schema_version','event_id','idempotency_key','run_id','phase_code','event_type','actor_type','occurred_at','source_class','payload_type','payload','source_refs'];
for (const key of requiredEnvelope) if (!eventSchema.required.includes(key)) fail(`event envelope missing required field: ${key}`);
if (eventSchema.additionalProperties !== false) fail('event envelope must reject unknown fields');

const configText = loaded['telemetry-config.schema.json'].text;
for (const forbidden of ['"password"','"passwd"','"secret"','"token"','"api_key"']) {
  if (configText.toLowerCase().includes(forbidden)) fail(`telemetry config exposes forbidden credential property: ${forbidden}`);
}

const projection = loaded['projection-map.json'].value;
if (projection.database_contract !== '1.3.0-core-draft') fail('projection map database contract mismatch');
if (projection.projection_policy.database_is_a_replica !== true) fail('projection map must state that database is a replica');
const eventTypes = projection.events.map((entry) => entry.event_type);
if (new Set(eventTypes).size !== eventTypes.length) fail('duplicate projection event type');
for (const entry of projection.events) {
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(entry.event_type)) fail(`invalid event type: ${entry.event_type}`);
  for (const table of entry.tables) if (!tableSet.has(table)) fail(`projection references non-core table ${table} in ${entry.event_type}`);
}
const projectedTables = new Set(projection.events.flatMap((entry) => entry.tables));
for (const table of expectedTables) {
  if (table === 'audit_schema_version') continue;
  if (!projectedTables.has(table)) fail(`core table has no projection event: ${table}`);
}

const agentSchemaText = loaded['agent-process-extension.schema.json'].text.toLowerCase();
for (const forbidden of ['chain_of_thought', 'hidden_reasoning', 'private_reasoning']) {
  if (agentSchemaText.includes(forbidden)) fail(`agent schema contains forbidden hidden reasoning field: ${forbidden}`);
}
const agentSchema = loaded['agent-process-extension.schema.json'].value;
if (!agentSchema.required.includes('agent_id') || agentSchema.required.includes('task_id')) fail('agent sidecar must use observable agent_id and must not accept Parent-generated task_id');
if (!agentSchema.properties.recon_facts || !agentSchema.properties.critic_review) fail('agent sidecar is missing recon or critic process data');

const target = loaded['target-mysql-profile.json'].value;
if (target.observation_mode !== 'read_only') fail('target profile must come from read-only observation');
if (target.server.version !== '8.0.26') fail(`target MySQL version mismatch: ${target.server.version}`);
if (target.server.character_set_server !== 'utf8mb4' || target.server.collation_server !== 'utf8mb4_0900_ai_ci') fail('target server charset/collation mismatch');
if (target.schema_observation.database_character_set !== 'utf8mb4' || target.schema_observation.database_collation !== 'utf8mb4_general_ci') fail('target database charset/collation mismatch');
if (target.schema_observation.existing_audit_table_count !== 36) fail('target audit_* table count does not match the applied core schema');
if (target.connection_observation.required_writer_collation !== 'utf8mb4_general_ci') fail('required writer collation mismatch');
if (target.account_observation.acceptable_for_runtime_writer !== false) fail('overprivileged configured account must not be approved as runtime Writer');
if (target.connection_observation.verify_identity_result !== 'blocked_missing_trusted_ca') fail('unexpected TLS identity verification state');

const alignment = cp.spawnSync(process.execPath, [alignmentVerifierPath], { encoding: 'utf8' });
if (alignment.status !== 0) fail(`Skill/DB alignment verification failed: ${alignment.stderr || alignment.stdout}`);
const alignmentResult = JSON.parse(alignment.stdout);
if (alignmentResult.status !== 'pass' || alignmentResult.tables !== 36) fail('Skill/DB alignment result mismatch');

console.log(JSON.stringify({
  status: 'pass',
  contract_version: '1.3.0',
  tables: tableNames.length,
  constraints: constraintNames.length,
  projection_events: projection.events.length,
  aligned_columns: alignmentResult.columns,
  source_contracts: alignmentResult.source_contracts,
  ddl_sha256: sha256(ddl),
  ddl_body_sha256: declaredBodyHash,
  target_runtime_validation: 'remote_parser_pass_isolated_execution_pending'
}, null, 2));
