'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const contractDir = __dirname;
const projectDir = path.dirname(contractDir);
const modelPath = path.join(projectDir, 'ai-security-v1-数据库逻辑模型.md');
const outputPath = path.join(contractDir, '001_ai_security_core_schema.sql');
const source = fs.readFileSync(modelPath, 'utf8');

const tablePattern = /CREATE TABLE (audit_[a-z_]+) \([\s\S]*?\) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;/g;
const tables = new Map();
for (const match of source.matchAll(tablePattern)) {
  if (tables.has(match[1])) throw new Error(`duplicate historical table: ${match[1]}`);
  tables.set(match[1], match[0]);
}

function requireTable(name) {
  const statement = tables.get(name);
  if (!statement) throw new Error(`historical table not found: ${name}`);
  return statement;
}

function replaceRequired(value, pattern, replacement, label) {
  const next = value.replace(pattern, replacement);
  if (next === value) throw new Error(`required transformation did not match: ${label}`);
  return next;
}

const coreOrder = [
  'audit_schema_version',
  'audit_run',
  'audit_run_scope',
  'audit_payload',
  'audit_phase_execution',
  'audit_event',
  'audit_agent_task',
  'audit_tool_execution',
  'audit_artifact',
  'audit_evidence',
  'audit_recon_fact',
  'audit_architecture_snapshot',
  'audit_coverage_unit',
  'audit_coverage_attempt',
  'audit_check',
  'audit_hypothesis',
  'audit_hypothesis_version',
  'audit_hypothesis_coverage',
  'audit_hypothesis_relation',
  'audit_hypothesis_evidence',
  'audit_hypothesis_score',
  'audit_attack_plan',
  'audit_attack_step',
  'audit_attack_execution',
  'audit_candidate',
  'audit_candidate_observation',
  'audit_candidate_hypothesis',
  'audit_candidate_coverage',
  'audit_validation',
  'audit_validation_observation',
  'audit_decision',
  'audit_finding',
  'audit_finding_revision',
  'audit_finding_evidence',
  'audit_finding_coverage',
  'audit_human_adjudication'
];

const deferred = new Set([
  'audit_telemetry_consent', 'audit_run_relation', 'audit_writer_lease',
  'audit_event_source_ref', 'audit_source_provenance', 'audit_outbox_checkpoint',
  'audit_ingest_failure', 'audit_surface', 'audit_trust_boundary',
  'audit_coverage_block', 'audit_critic_review', 'audit_critic_item',
  'audit_validator_run', 'audit_report', 'audit_metric_value'
]);

const generated = new Map();
for (const name of coreOrder) {
  if (name !== 'audit_hypothesis_relation' && name !== 'audit_hypothesis_coverage') generated.set(name, requireTable(name));
}

let run = generated.get('audit_run');
run = replaceRequired(
  run,
  /  telemetry_enabled BOOLEAN NOT NULL DEFAULT FALSE,\n  remote_sync_enabled BOOLEAN NOT NULL DEFAULT FALSE,\n  run_status VARCHAR\(24\) NOT NULL,\n  telemetry_status VARCHAR\(24\) NOT NULL,\n  outbox_status VARCHAR\(24\) NOT NULL,/,
  "  telemetry_mode VARCHAR(16) NOT NULL,\n  telemetry_failure_policy VARCHAR(16) NOT NULL,\n  run_status VARCHAR(24) NOT NULL,\n  telemetry_local_status VARCHAR(24) NOT NULL,\n  telemetry_remote_status VARCHAR(24) NOT NULL,\n  outbox_status VARCHAR(24) NOT NULL,",
  'audit_run telemetry fields'
);
run = replaceRequired(
  run,
  /  CONSTRAINT chk_run_telemetry CHECK \(telemetry_status IN \('[^\n]+\)\),/,
  "  CONSTRAINT chk_run_telemetry_mode CHECK (telemetry_mode IN ('off','local','remote')),\n  CONSTRAINT chk_run_failure_policy CHECK (telemetry_failure_policy IN ('best_effort','required')),\n  CONSTRAINT chk_run_local_status CHECK (telemetry_local_status IN ('disabled','healthy','degraded','incomplete')),\n  CONSTRAINT chk_run_remote_status CHECK (telemetry_remote_status IN ('disabled','pending_sync','syncing','synced','incomplete')),",
  'audit_run telemetry checks'
);
generated.set('audit_run', run);

let phaseExecution = generated.get('audit_phase_execution');
phaseExecution = replaceRequired(
  phaseExecution,
  "  CONSTRAINT chk_phase_code CHECK (phase_code IN ('P0','P1','P2','P3','P4','P5','P6')),",
  "  CONSTRAINT chk_phase_code CHECK (phase_code IN ('P0','P1','P2','P3','P4','P5','P6','POST')),",
  'post-run research phase'
);
generated.set('audit_phase_execution', phaseExecution);

let event = generated.get('audit_event');
event = replaceRequired(
  event,
  '  payload_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,',
  "  payload_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,\n  source_refs_json JSON NOT NULL,",
  'audit_event source refs'
);
generated.set('audit_event', event);

let artifact = generated.get('audit_artifact');
artifact = replaceRequired(artifact, '  owner_task_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,', "  owner_task_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,\n  artifact_kind VARCHAR(32) NOT NULL,\n  version_no INT UNSIGNED NOT NULL DEFAULT 1,\n  artifact_status VARCHAR(24) NOT NULL,", 'artifact parent ownership');
artifact = replaceRequired(artifact, '  UNIQUE KEY uq_artifact_owner_path (owner_task_id, path_hash),', "  UNIQUE KEY uq_artifact_version (run_id, artifact_kind, version_no, path_hash),\n  KEY ix_artifact_owner (owner_task_id, created_at),", 'artifact uniqueness');
artifact = replaceRequired(artifact, "  CONSTRAINT chk_artifact_status CHECK (promotion_status IN ('declared','promoted','rejected','discarded')),", "  CONSTRAINT chk_artifact_kind CHECK (artifact_kind IN ('agent_evidence','run_metadata','architecture','coverage_ledger','findings_json','report','findings_detail','needs_validation','validator_input','validator_output')),\n  CONSTRAINT chk_artifact_lifecycle CHECK (artifact_status IN ('draft','final','partial','superseded','discarded')),\n  CONSTRAINT chk_artifact_status CHECK (promotion_status IN ('declared','promoted','rejected','discarded')),", 'artifact checks');
generated.set('audit_artifact', artifact);

let coverage = generated.get('audit_coverage_unit');
coverage = replaceRequired(coverage, '  starting_paths JSON NOT NULL,', "  starting_paths JSON NOT NULL,\n  blocks_json JSON NOT NULL,", 'coverage blocks JSON');
generated.set('audit_coverage_unit', coverage);

let hypothesis = generated.get('audit_hypothesis');
hypothesis = replaceRequired(hypothesis, /  related_hypothesis_id CHAR\(26\)[^\n]+\n  relation_kind VARCHAR\(16\) NULL,\n/, '', 'remove single hypothesis relation columns');
hypothesis = replaceRequired(hypothesis, /  CONSTRAINT fk_hypothesis_related[^\n]+\n/, '', 'remove single hypothesis relation FK');
hypothesis = replaceRequired(hypothesis, /  CONSTRAINT chk_hypothesis_relation[^\n]+\n/, '', 'remove single hypothesis relation check');
generated.set('audit_hypothesis', hypothesis);

generated.set('audit_hypothesis_relation', `CREATE TABLE audit_hypothesis_relation (
  hypothesis_relation_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  run_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  from_hypothesis_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  to_hypothesis_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  relation_kind VARCHAR(24) NOT NULL,
  event_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  rationale TEXT NOT NULL,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL DEFAULT 'P',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_hypothesis_relation (from_hypothesis_id, to_hypothesis_id, relation_kind),
  KEY ix_hypothesis_relation_to (to_hypothesis_id, relation_kind),
  CONSTRAINT fk_hr_run FOREIGN KEY (run_id) REFERENCES audit_run(run_id) ON DELETE RESTRICT,
  CONSTRAINT fk_hr_from FOREIGN KEY (from_hypothesis_id) REFERENCES audit_hypothesis(hypothesis_id) ON DELETE RESTRICT,
  CONSTRAINT fk_hr_to FOREIGN KEY (to_hypothesis_id) REFERENCES audit_hypothesis(hypothesis_id) ON DELETE RESTRICT,
  CONSTRAINT fk_hr_event FOREIGN KEY (event_id) REFERENCES audit_event(event_id) ON DELETE RESTRICT,
  CONSTRAINT chk_hr_distinct CHECK (from_hypothesis_id<>to_hypothesis_id),
  CONSTRAINT chk_hr_kind CHECK (relation_kind IN ('supersedes','merged_into','split_from','alternative_to')),
  CONSTRAINT chk_hr_source CHECK (source_class='P')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;`);

generated.set('audit_hypothesis_coverage', `CREATE TABLE audit_hypothesis_coverage (
  hypothesis_coverage_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  hypothesis_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  coverage_unit_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  relation_kind VARCHAR(24) NOT NULL,
  ordinal INT UNSIGNED NOT NULL,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL DEFAULT 'P',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_hypothesis_coverage (hypothesis_id, coverage_unit_id, relation_kind),
  UNIQUE KEY uq_hypothesis_coverage_order (hypothesis_id, ordinal),
  CONSTRAINT fk_hc_hypothesis FOREIGN KEY (hypothesis_id) REFERENCES audit_hypothesis(hypothesis_id) ON DELETE RESTRICT,
  CONSTRAINT fk_hc_coverage FOREIGN KEY (coverage_unit_id) REFERENCES audit_coverage_unit(coverage_unit_id) ON DELETE RESTRICT,
  CONSTRAINT chk_hc_relation CHECK (relation_kind IN ('primary','supporting','affected')),
  CONSTRAINT chk_hc_source CHECK (source_class='P')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;`);

let observation = generated.get('audit_candidate_observation');
observation = replaceRequired(observation, '  candidate_observation_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,', "  candidate_observation_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,\n  run_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,", 'observation run');
observation = replaceRequired(observation, '  candidate_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,', '  candidate_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,', 'observation nullable candidate');
observation = replaceRequired(observation, '  hunter_task_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,', "  producer_task_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,\n  observation_kind VARCHAR(24) NOT NULL,", 'observation generic producer');
observation = replaceRequired(observation, '  UNIQUE KEY uq_candidate_observation (candidate_id, hunter_task_id, hypothesis_version_id),', '  UNIQUE KEY uq_candidate_observation (run_id, producer_task_id, hypothesis_version_id, local_fingerprint_hash),', 'observation identity');
observation = replaceRequired(observation, '  KEY ix_candidate_observation_local (hunter_task_id, local_fingerprint_hash),', '  KEY ix_candidate_observation_local (producer_task_id, local_fingerprint_hash),', 'observation producer index');
observation = replaceRequired(observation, '  CONSTRAINT fk_co_hunter FOREIGN KEY (hunter_task_id) REFERENCES audit_agent_task(task_id) ON DELETE RESTRICT,', "  CONSTRAINT fk_co_producer FOREIGN KEY (producer_task_id) REFERENCES audit_agent_task(task_id) ON DELETE RESTRICT,\n  CONSTRAINT chk_co_kind CHECK (observation_kind IN ('hunter_proposal','prior_carried','verifier_new_root')),", 'observation producer FK');
observation = replaceRequired(observation, '  CONSTRAINT fk_co_candidate FOREIGN KEY (candidate_id) REFERENCES audit_candidate(candidate_id) ON DELETE RESTRICT,', "  CONSTRAINT fk_co_run FOREIGN KEY (run_id) REFERENCES audit_run(run_id) ON DELETE RESTRICT,\n  CONSTRAINT fk_co_candidate FOREIGN KEY (candidate_id) REFERENCES audit_candidate(candidate_id) ON DELETE RESTRICT,", 'observation run FK');
generated.set('audit_candidate_observation', observation);

let validation = generated.get('audit_validation');
validation = replaceRequired(validation, '  candidate_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,', "  candidate_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,\n  input_hypothesis_version_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,\n  input_finding_revision_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,\n  input_sha256 BINARY(32) NOT NULL,", 'validation frozen inputs');
validation = replaceRequired(validation, '  CONSTRAINT fk_validation_candidate FOREIGN KEY (candidate_id) REFERENCES audit_candidate(candidate_id) ON DELETE RESTRICT,', "  CONSTRAINT fk_validation_candidate FOREIGN KEY (candidate_id) REFERENCES audit_candidate(candidate_id) ON DELETE RESTRICT,\n  CONSTRAINT fk_validation_hv FOREIGN KEY (input_hypothesis_version_id) REFERENCES audit_hypothesis_version(hypothesis_version_id) ON DELETE RESTRICT,", 'validation hypothesis input FK');
validation = replaceRequired(validation, "  CONSTRAINT chk_validation_phase CHECK (phase_code IN ('P3','P5')),", "  CONSTRAINT chk_validation_phase CHECK (phase_code IN ('P3','P5')),\n  CONSTRAINT chk_validation_input CHECK ((phase_code='P3' AND input_hypothesis_version_id IS NOT NULL AND input_finding_revision_id IS NULL) OR (phase_code='P5' AND input_finding_revision_id IS NOT NULL)),", 'validation input check');
generated.set('audit_validation', validation);

let adjudication = generated.get('audit_human_adjudication');
adjudication = replaceRequired(adjudication, '  run_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,', "  run_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,\n  subject_type VARCHAR(16) NOT NULL,\n  label_scheme VARCHAR(32) NOT NULL,", 'adjudication subject fields');
adjudication = replaceRequired(adjudication, "  CONSTRAINT chk_adjudication_subject CHECK ((hypothesis_id IS NOT NULL) + (candidate_id IS NOT NULL) + (finding_id IS NOT NULL) = 1),\n  CONSTRAINT chk_adjudication_label CHECK (label IN ('exact_match','partial_match','wrong_hypothesis','unresolved')),", "  CONSTRAINT chk_adjudication_subject CHECK ((subject_type='hypothesis' AND hypothesis_id IS NOT NULL AND candidate_id IS NULL AND finding_id IS NULL) OR (subject_type='candidate' AND hypothesis_id IS NULL AND candidate_id IS NOT NULL AND finding_id IS NULL) OR (subject_type='finding' AND hypothesis_id IS NULL AND candidate_id IS NULL AND finding_id IS NOT NULL)),\n  CONSTRAINT chk_adjudication_label CHECK ((subject_type='hypothesis' AND label_scheme='hypothesis_match_v1' AND label IN ('exact_match','partial_match','wrong_hypothesis','unresolved')) OR (subject_type IN ('candidate','finding') AND label_scheme='security_validity_v1' AND label IN ('true_positive','false_positive','indeterminate'))),", 'adjudication label semantics');
generated.set('audit_human_adjudication', adjudication);

const missing = coreOrder.filter((name) => !generated.has(name));
if (missing.length) throw new Error(`missing generated tables: ${missing.join(', ')}`);
if (new Set(coreOrder).size !== 36) throw new Error('core table inventory must contain exactly 36 unique tables');
for (const name of deferred) {
  if (coreOrder.includes(name)) throw new Error(`deferred table leaked into core inventory: ${name}`);
}

const statements = [];
statements.push('-- ai-security-v1 telemetry core schema 1.3.0-core-draft');
statements.push('-- GENERATED by generate-core-ddl.cjs. Review and fully validate on target-compatible MySQL 8.0.26 before execution.');
statements.push('-- This file contains no USE, DROP, DELETE, GRANT, credentials, or connection settings.');
statements.push('SET NAMES utf8mb4 COLLATE utf8mb4_general_ci;');
statements.push("SET time_zone = '+00:00';");

for (const name of coreOrder) {
  statements.push(`\n-- core table ${coreOrder.indexOf(name) + 1}/36: ${name}`);
  statements.push(generated.get(name));
  if (name === 'audit_agent_task') {
    statements.push('ALTER TABLE audit_event\n  ADD CONSTRAINT fk_event_task FOREIGN KEY (agent_task_id) REFERENCES audit_agent_task(task_id) ON DELETE RESTRICT;');
  }
  if (name === 'audit_hypothesis_version') {
    statements.push('ALTER TABLE audit_hypothesis\n  ADD CONSTRAINT fk_hypothesis_current_version FOREIGN KEY (hypothesis_id, current_version_id) REFERENCES audit_hypothesis_version(hypothesis_id, hypothesis_version_id) ON DELETE RESTRICT;');
  }
  if (name === 'audit_finding_revision') {
    statements.push('ALTER TABLE audit_finding\n  ADD CONSTRAINT fk_finding_current_revision FOREIGN KEY (finding_id, current_revision_id) REFERENCES audit_finding_revision(finding_id, finding_revision_id) ON DELETE RESTRICT;');
    statements.push('ALTER TABLE audit_validation\n  ADD CONSTRAINT fk_validation_finding_revision FOREIGN KEY (input_finding_revision_id) REFERENCES audit_finding_revision(finding_revision_id) ON DELETE RESTRICT;');
  }
}

statements.push(`
CREATE OR REPLACE VIEW audit_v_run_progress AS
SELECT r.run_id, r.repo, r.profile, r.run_status,
       r.telemetry_mode, r.telemetry_failure_policy,
       r.telemetry_local_status, r.telemetry_remote_status,
       COALESCE(p.phase_attempts,0) AS phase_attempts,
       COALESCE(t.agent_tasks,0) AS agent_tasks,
       COALESCE(cu.coverage_units,0) AS coverage_units,
       COALESCE(c.candidates,0) AS candidates,
       COALESCE(f.final_records,0) AS final_records
FROM audit_run r
LEFT JOIN (SELECT run_id,COUNT(*) phase_attempts FROM audit_phase_execution GROUP BY run_id) p ON p.run_id=r.run_id
LEFT JOIN (SELECT run_id,COUNT(*) agent_tasks FROM audit_agent_task GROUP BY run_id) t ON t.run_id=r.run_id
LEFT JOIN (SELECT run_id,COUNT(*) coverage_units FROM audit_coverage_unit GROUP BY run_id) cu ON cu.run_id=r.run_id
LEFT JOIN (SELECT run_id,COUNT(*) candidates FROM audit_candidate GROUP BY run_id) c ON c.run_id=r.run_id
LEFT JOIN (SELECT run_id,COUNT(*) final_records FROM audit_finding GROUP BY run_id) f ON f.run_id=r.run_id;

CREATE OR REPLACE VIEW audit_v_hypothesis_first_prediction AS
SELECT h.run_id, h.hypothesis_id, hv.hypothesis_version_id, hv.version_no,
       hs.hypothesis_score_id, hs.score_no, hs.predicted_probability,
       hs.priority_score, hs.evidence_as_of_event_id,
       f.current_verdict,
       ha.label AS human_label, ha.eligible_for_metrics
FROM audit_hypothesis h
JOIN audit_hypothesis_version hv ON hv.hypothesis_id=h.hypothesis_id AND hv.version_no=1
JOIN audit_hypothesis_score hs ON hs.hypothesis_version_id=hv.hypothesis_version_id AND hs.score_no=1
LEFT JOIN audit_candidate_hypothesis ch ON ch.hypothesis_version_id=hv.hypothesis_version_id AND ch.is_primary=TRUE
LEFT JOIN audit_candidate c ON c.candidate_id=ch.candidate_id
LEFT JOIN audit_finding f ON f.candidate_id=c.candidate_id
LEFT JOIN audit_human_adjudication ha ON ha.adjudication_id=(
  SELECT ha2.adjudication_id FROM audit_human_adjudication ha2
  WHERE ha2.subject_type='hypothesis' AND ha2.hypothesis_id=h.hypothesis_id AND ha2.eligible_for_metrics=TRUE
  ORDER BY ha2.adjudicated_at DESC,ha2.adjudication_id DESC LIMIT 1
);
`);

const schemaBody = `${statements.join('\n')}\n`;
const ddlBodyHash = crypto.createHash('sha256').update(schemaBody, 'utf8').digest('hex');
const seed = `INSERT INTO audit_schema_version\n  (version, ddl_sha256, description, schema_version, applied_at, source_class)\nVALUES\n  ('1.3.0-core-draft', UNHEX('${ddlBodyHash}'),\n   '36-table core contract; ddl_sha256 covers statements before this seed record',\n   '1.3.0-core-draft', CURRENT_TIMESTAMP(6), 'P');\n`;
const finalSql = `${schemaBody}\n-- schema body SHA-256: ${ddlBodyHash}\n${seed}`;
fs.writeFileSync(outputPath, finalSql, { encoding: 'utf8', mode: 0o644, flag: 'w' });
console.log(JSON.stringify({ output: outputPath, tables: coreOrder.length, ddl_body_sha256: ddlBodyHash }));
