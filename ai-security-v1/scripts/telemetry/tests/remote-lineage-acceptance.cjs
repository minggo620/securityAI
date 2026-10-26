#!/usr/bin/env node
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const cp = require('node:child_process');
const { ulid } = require('../ulid.cjs');
const { defaultConfig, loadConfig } = require('../config.cjs');
const { buildEvent, sha256 } = require('../event-builder.cjs');
const outbox = require('../outbox.cjs');
const writer = require('../mysql-writer.cjs');

if (process.env.AI_SECURITY_ACCEPTANCE !== '1') throw new Error('set AI_SECURITY_ACCEPTANCE=1 for the explicitly authorized remote synthetic test');
if (!process.env.MYSQL_PWD) throw new Error('MYSQL_PWD required');
for (const key of ['AI_SECURITY_DB_HOST', 'AI_SECURITY_DB_USER', 'AI_SECURITY_DB_NAME']) if (!process.env[key]) throw new Error(`${key} required`);
const outputDir = process.argv[2] ? path.resolve(process.argv[2]) : fs.mkdtempSync(path.join(os.tmpdir(), 'ai-security-v1-remote-acceptance-'));
if (!fs.existsSync(path.join(outputDir, 'telemetry/config.json'))) {
  const telemetry = defaultConfig();
  telemetry.mode = 'remote';
  telemetry.remote_sync.enabled = true;
  telemetry.consent.remote_mysql = true;
  telemetry.consent.authority_reference = 'explicit user authorization for synthetic remote acceptance';
  const initialized = cp.spawnSync(process.execPath, [path.join(__dirname, '../cli.cjs'), 'init-run', '--output-dir', outputDir], {
    input: JSON.stringify({ repo: '__ai_security_v1_acceptance__', target: '__ai_security_v1_acceptance__', source_ref: 'synthetic', profile: 'quick', scope_paths: [{ path: 'synthetic/' }], telemetry }),
    encoding: 'utf8', env: process.env, maxBuffer: 1024 * 1024
  });
  if (initialized.status !== 0) throw new Error(`remote init failed: ${initialized.stdout || initialized.stderr}`);
  const result = JSON.parse(initialized.stdout);
  if (result.status !== 'projected') throw new Error(`remote init was not projected: ${result.status}`);
}
const config = loadConfig(path.join(outputDir, 'telemetry/config.json'));
if (config.mode !== 'remote' || !config.consent.remote_mysql) throw new Error('remote consent required');
const initial = outbox.readLines(path.join(outputDir, config.outbox_relative_path)).records[0];
const runId = initial.envelope.run_id;
const writerOptions = { tlsMode: config.remote_sync.tls_mode };
const state = writer.preflight(writerOptions);
let checkpoint = outbox.readCheckpoint(outputDir);

function mysqlDate() { return new Date().toISOString().replace('T', ' ').replace('Z', ''); }
function hex(value) { return { $hex: sha256(value) }; }
function json(value) { return { $json: value }; }
function record(input) {
  const built = buildEvent(input, config);
  const appended = outbox.append(outputDir, config.outbox_relative_path, built);
  const result = writer.projectRecord(appended.record, state, writerOptions);
  checkpoint = { sequence: appended.record.sequence, record_sha256: appended.record.record_sha256, event_id: built.event.event_id, committed_at: new Date().toISOString() };
  outbox.writeCheckpoint(outputDir, checkpoint);
  return { event_id: built.event.event_id, payload_id: built.event.payload.content._telemetry.payload_id, result };
}

const p2 = ulid();
record({ run_id: runId, phase_code: 'P2', event_type: 'phase.started', actor_type: 'parent', idempotency_key: `run/${runId}/P2/start`, payload_type: 'phase.started', payload: { _telemetry: { phase_execution_id: p2 }, projections: [{ table: 'audit_phase_execution', action: 'insert', values: { phase_execution_id: p2, run_id: runId, phase_code: 'P2', attempt_no: 1, status: 'running', input_payload_id: '$payload_id', output_payload_id: null, failure_reason: null, started_at: mysqlDate(), ended_at: null, schema_version: '1.4.0', source_class: 'P' } }] }, source_refs: [] });

const hunterTask = ulid();
record({ run_id: runId, phase_code: 'P2', event_type: 'agent.task_started', actor_type: 'parent', agent_task_id: hunterTask, idempotency_key: `run/${runId}/P2/task/hunter-acceptance/start`, payload_type: 'agent.task', payload: { _telemetry: { phase_execution_id: p2 }, model: { provider: 'openai', name: 'acceptance-model', reasoning_effort: 'test' }, projections: [{ table: 'audit_agent_task', action: 'insert', values: { task_id: hunterTask, run_id: runId, phase_execution_id: p2, parent_task_id: null, agent_id: 'hunter-acceptance', role: 'hunter', subagent_type: 'general', task_kind: 'hunter_two_checkpoint', scope_summary: 'synthetic acceptance coverage', model_provider: 'openai', model_name: 'acceptance-model', model_version: null, reasoning_effort: 'test', model_config_json: json({ synthetic: true, turn_count: 2 }), input_tokens: null, output_tokens: null, cached_input_tokens: null, cost_amount: null, cost_currency: null, prompt_payload_id: '$payload_id', output_payload_id: null, status: 'running', started_at: mysqlDate(), ended_at: null, queue_duration_ms: null, execution_duration_ms: null, retry_count: 0, failure_reason: null, schema_version: '1.4.0', source_class: 'O', row_version: 0 } }] }, source_refs: [] });

const coverage = ulid();
const coverageId = 'synthetic/surface::synthetic/boundary::synthetic/subsystem::ATTACK-CLASSES.md%23Access%20control';
record({ run_id: runId, phase_code: 'P1', event_type: 'coverage.seeded', actor_type: 'parent', idempotency_key: `run/${runId}/P1/coverage/synthetic`, payload_type: 'coverage.unit', payload: { _telemetry: { phase_execution_id: null }, projections: [{ table: 'audit_coverage_unit', action: 'insert', values: { coverage_unit_id: coverage, run_id: runId, coverage_id: coverageId, coverage_id_hash: hex(coverageId), canonical_refs: json({ surface: 'synthetic/surface', boundary: 'synthetic/boundary', subsystem: 'synthetic/subsystem', attack_class: 'ATTACK-CLASSES.md#Access control' }), surface_label: 'synthetic surface', boundary_label: 'synthetic boundary', subsystem_label: 'synthetic subsystem', attack_class_label: 'Access control', lifecycle_label: null, starting_paths: json(['synthetic/source.js']), blocks_json: json({ ordinary: 'ATTACK-CLASSES.md#Access control', selected: [], excluded: [] }), prior_status: 'none', wave: 1, status: 'in_progress', owner_task_id: hunterTask, reviewed_paths: json([]), result_fingerprints: json([]), unresolved: json([]), schema_version: '1.4.0', source_class: 'S', row_version: 0 } }] }, source_refs: [{ relative_path: 'synthetic/source.js', start_line: 1, end_line: 1, content_sha256: null }] });

const hypothesis = ulid();
const hypothesisVersion = ulid();
const hypothesisCreated = record({ run_id: runId, phase_code: 'P2', event_type: 'hypothesis.created', actor_type: 'parent', agent_task_id: hunterTask, idempotency_key: `run/${runId}/P2/hypothesis/h1/version/1`, payload_type: 'hypothesis.version', payload: { _telemetry: { phase_execution_id: p2 }, score_formula: 'hypothesis-research-baseline/1.0', projections: [
  { table: 'audit_hypothesis', action: 'insert', values: { hypothesis_id: hypothesis, run_id: runId, coverage_unit_id: coverage, creator_task_id: hunterTask, local_hypothesis_key: 'h1', current_version_id: null, status: 'investigating', schema_version: '1.4.0', source_class: 'P', row_version: 0 } },
  { table: 'audit_hypothesis_version', action: 'insert', values: { hypothesis_version_id: hypothesisVersion, hypothesis_id: hypothesis, version_no: 1, author_task_id: hunterTask, attacker_principal: 'synthetic lower-trust principal', attacker_capabilities: json(['controls synthetic input']), controlled_input: 'synthetic input', entrypoint: 'synthetic/source.js:1', expected_invariant: 'synthetic authorization invariant', suspected_control_failure: 'synthetic control is bypassed', predicted_trace: json(['entry', 'decision', 'sink']), target_boundary: 'synthetic trust boundary', affected_resource: 'synthetic record', predicted_result: 'synthetic unauthorized read', preconditions_json: json(['synthetic fixture']), unknown_facts_json: json([]), alternative_explanations_json: json(['control may reject']), revision_reason: 'initial source-only hypothesis', schema_version: '1.4.0', source_class: 'P' } },
  { table: 'audit_hypothesis_coverage', action: 'insert', values: { hypothesis_coverage_id: ulid(), hypothesis_id: hypothesis, coverage_unit_id: coverage, relation_kind: 'primary', ordinal: 1, schema_version: '1.4.0', source_class: 'P' } },
  { table: 'audit_hypothesis_score', action: 'insert', values: { hypothesis_score_id: ulid(), hypothesis_version_id: hypothesisVersion, score_no: 1, scorer_task_id: hunterTask, predicted_probability: 0.7, probability_rationale: 'synthetic pre-validation rationale', potential_impact: 0.6, coverage_value: 0.8, information_gain: 0.7, estimated_validation_cost: 0.2, validation_cost_unit: 'normalized', estimated_duration_ms: 100, estimated_agent_calls: 1, estimated_token_count: 100, priority_score: 1.6, formula_name: 'hypothesis-research-baseline', formula_version: '1.0', scoring_protocol: 'two-checkpoint-source-first', scoring_protocol_version: '1.0', model_config_sha256: hex('acceptance-model'), prompt_template_sha256: hex('hunter-plan-template'), evidence_as_of_event_id: '$event_id', scored_at: mysqlDate(), schema_version: '1.4.0', source_class: 'P' } },
  { table: 'audit_hypothesis', action: 'update', values: { current_version_id: hypothesisVersion, row_version: 1 }, where: { hypothesis_id: hypothesis, row_version: 0 } }
] }, source_refs: [{ relative_path: 'synthetic/source.js', start_line: 1, end_line: 1, content_sha256: null }] });

const plan = ulid();
const step = ulid();
record({ run_id: runId, phase_code: 'P2', event_type: 'attack.plan_created', actor_type: 'parent', agent_task_id: hunterTask, causation_id: hypothesisCreated.event_id, idempotency_key: `run/${runId}/P2/attack/h1/plan/1`, payload_type: 'attack.plan', payload: { _telemetry: { phase_execution_id: p2 }, projections: [
  { table: 'audit_attack_plan', action: 'insert', values: { attack_plan_id: plan, hypothesis_version_id: hypothesisVersion, plan_version_no: 1, author_task_id: hunterTask, plan_mode: 'source_only', objective: 'test synthetic invariant', stop_condition: 'stop after minimum boundary result', expected_boundary_result: 'synthetic unauthorized read', status: 'approved', schema_version: '1.4.0', source_class: 'P' } },
  { table: 'audit_attack_step', action: 'insert', values: { attack_step_id: step, attack_plan_id: plan, ordinal: 1, action_kind: 'source_trace', action_text: 'trace synthetic input to decision', precondition_text: 'synthetic source exists', input_description: 'synthetic fixture', expected_result: 'control failure visible in source', planned_tool: null, status: 'planned', schema_version: '1.4.0', source_class: 'P' } }
] }, source_refs: [] });

const evidence = ulid();
record({ run_id: runId, phase_code: 'P2', event_type: 'attack.step_observed', actor_type: 'parent', agent_task_id: hunterTask, idempotency_key: `run/${runId}/P2/attack/h1/step/1/execution/1`, payload_type: 'attack.observation', payload: { _telemetry: { phase_execution_id: p2 }, observation: { mode: 'source_only', status: 'succeeded' }, projections: [
  { table: 'audit_evidence', action: 'insert', values: { evidence_id: evidence, run_id: runId, producer_task_id: hunterTask, evidence_type: 'source', repo_path: 'synthetic/source.js', start_line: 1, end_line: 1, scope_name: 'syntheticFunction', description: 'synthetic source supports the predicted path', artifact_id: null, tool_execution_id: null, payload_id: '$payload_id', evidence_sha256: hex('synthetic source supports the predicted path'), schema_version: '1.4.0', source_class: 'S' } },
  { table: 'audit_attack_execution', action: 'insert', values: { attack_execution_id: ulid(), attack_step_id: step, execution_no: 1, executor_task_id: hunterTask, execution_mode: 'source_only', status: 'succeeded', actual_input_payload_id: '$payload_id', observed_result: 'synthetic path established', tool_execution_id: null, evidence_id: evidence, blocker_reason: null, started_at: mysqlDate(), ended_at: mysqlDate(), schema_version: '1.4.0', source_class: 'O' } }
] }, source_refs: [{ relative_path: 'synthetic/source.js', start_line: 1, end_line: 1, content_sha256: null }] });

const fingerprint = 'synthetic:authorization:acceptance';
const observation = ulid();
record({ run_id: runId, phase_code: 'P2', event_type: 'candidate.observed', actor_type: 'parent', agent_task_id: hunterTask, idempotency_key: `run/${runId}/P2/candidate-observation/${fingerprint}`, payload_type: 'candidate.observation', payload: { _telemetry: { phase_execution_id: p2 }, projections: [{ table: 'audit_candidate_observation', action: 'insert', values: { candidate_observation_id: observation, run_id: runId, candidate_id: null, producer_task_id: hunterTask, observation_kind: 'hunter_proposal', hypothesis_version_id: hypothesisVersion, local_fingerprint: fingerprint, local_fingerprint_hash: hex(fingerprint), proposed_verdict: 'confirmed', payload_id: '$payload_id', observed_at: mysqlDate(), schema_version: '1.4.0', source_class: 'O' } }] }, source_refs: [] });

const candidate = ulid();
record({ run_id: runId, phase_code: 'P2', event_type: 'candidate.consolidated', actor_type: 'parent', idempotency_key: `run/${runId}/P2/candidate/${fingerprint}/consolidated`, payload_type: 'candidate.consolidated', payload: { _telemetry: { phase_execution_id: p2 }, projections: [
  { table: 'audit_candidate', action: 'insert', values: { candidate_id: candidate, run_id: runId, fingerprint, fingerprint_hash: hex(fingerprint), consolidated_payload_id: '$payload_id', status: 'queued_for_validation', schema_version: '1.4.0', source_class: 'P', row_version: 0 } },
  { table: 'audit_candidate_observation', action: 'update', values: { candidate_id: candidate }, where: { candidate_observation_id: observation } },
  { table: 'audit_candidate_hypothesis', action: 'insert', values: { candidate_hypothesis_id: ulid(), candidate_id: candidate, hypothesis_version_id: hypothesisVersion, relation_kind: 'origin', is_primary: true, schema_version: '1.4.0', source_class: 'P' } },
  { table: 'audit_candidate_coverage', action: 'insert', values: { candidate_coverage_id: ulid(), candidate_id: candidate, coverage_unit_id: coverage, relation_kind: 'origin', schema_version: '1.4.0', source_class: 'P' } }
] }, source_refs: [] });

const p3 = ulid();
record({ run_id: runId, phase_code: 'P3', event_type: 'phase.started', actor_type: 'parent', idempotency_key: `run/${runId}/P3/start`, payload_type: 'phase.started', payload: { _telemetry: { phase_execution_id: p3 }, projections: [{ table: 'audit_phase_execution', action: 'insert', values: { phase_execution_id: p3, run_id: runId, phase_code: 'P3', attempt_no: 1, status: 'running', input_payload_id: '$payload_id', output_payload_id: null, failure_reason: null, started_at: mysqlDate(), ended_at: null, schema_version: '1.4.0', source_class: 'P' } }] }, source_refs: [] });

const verifierTask = ulid();
record({ run_id: runId, phase_code: 'P3', event_type: 'agent.task_started', actor_type: 'parent', agent_task_id: verifierTask, idempotency_key: `run/${runId}/P3/task/verifier-acceptance/start`, payload_type: 'agent.task', payload: { _telemetry: { phase_execution_id: p3 }, projections: [{ table: 'audit_agent_task', action: 'insert', values: { task_id: verifierTask, run_id: runId, phase_execution_id: p3, parent_task_id: null, agent_id: 'verifier-acceptance', role: 'verifier', subagent_type: 'general', task_kind: 'candidate_validation', scope_summary: fingerprint, model_provider: 'openai', model_name: 'acceptance-model', model_version: null, reasoning_effort: 'test', model_config_json: json({ synthetic: true }), input_tokens: null, output_tokens: null, cached_input_tokens: null, cost_amount: null, cost_currency: null, prompt_payload_id: '$payload_id', output_payload_id: null, status: 'running', started_at: mysqlDate(), ended_at: null, queue_duration_ms: null, execution_duration_ms: null, retry_count: 0, failure_reason: null, schema_version: '1.4.0', source_class: 'O', row_version: 0 } }] }, source_refs: [] });

const validation = ulid();
record({ run_id: runId, phase_code: 'P3', event_type: 'validation.started', actor_type: 'parent', agent_task_id: verifierTask, idempotency_key: `run/${runId}/P3/validation/${fingerprint}/1/start`, payload_type: 'validation.started', payload: { _telemetry: { phase_execution_id: p3 }, projections: [{ table: 'audit_validation', action: 'insert', values: { validation_id: validation, candidate_id: candidate, input_hypothesis_version_id: hypothesisVersion, input_finding_revision_id: null, input_sha256: hex(fingerprint), validation_no: 1, phase_code: 'P3', verifier_task_id: verifierTask, validation_kind: 'candidate', independence_status: 'passed', method_summary: 'synthetic independent source check', strongest_control: 'synthetic guard', status: 'running', started_at: mysqlDate(), ended_at: null, schema_version: '1.4.0', source_class: 'O' } }] }, source_refs: [] });

record({ run_id: runId, phase_code: 'P3', event_type: 'validation.observation_recorded', actor_type: 'parent', agent_task_id: verifierTask, idempotency_key: `run/${runId}/P3/validation/${fingerprint}/1/observation/1`, payload_type: 'validation.observation', payload: { _telemetry: { phase_execution_id: p3 }, projections: [{ table: 'audit_validation_observation', action: 'insert', values: { validation_observation_id: ulid(), validation_id: validation, ordinal: 1, observation_kind: 'counterexample', expected_text: 'guard rejects', observed_text: 'synthetic path remains reachable', relation_to_claim: 'supports', evidence_id: evidence, schema_version: '1.4.0', source_class: 'O' } }] }, source_refs: [] });

const decision = ulid();
const decided = record({ run_id: runId, phase_code: 'P3', event_type: 'validation.decided', actor_type: 'parent', agent_task_id: verifierTask, idempotency_key: `run/${runId}/P3/validation/${fingerprint}/1/decision`, payload_type: 'validation.decision', payload: { _telemetry: { phase_execution_id: p3 }, projections: [
  { table: 'audit_decision', action: 'insert', values: { decision_id: decision, validation_id: validation, decision_no: 1, decision: 'confirmed', reason: 'synthetic independent confirmation', record_payload_id: '$payload_id', material_change: false, supersedes_decision_id: null, decided_at: mysqlDate(), schema_version: '1.4.0', source_class: 'O' } },
  { table: 'audit_candidate', action: 'update', values: { status: 'decided', row_version: 1 }, where: { candidate_id: candidate, row_version: 0 } },
  { table: 'audit_coverage_unit', action: 'update', values: { status: 'candidate', reviewed_paths: json(['synthetic/source.js']), result_fingerprints: json([fingerprint]), unresolved: json([]), row_version: 1 }, where: { coverage_unit_id: coverage, row_version: 0 } }
] }, source_refs: [] });

const finding = ulid();
const revision = ulid();
record({ run_id: runId, phase_code: 'P4', event_type: 'finding.revision_created', actor_type: 'parent', causation_id: decided.event_id, idempotency_key: `run/${runId}/P4/finding/${fingerprint}/revision/1`, payload_type: 'finding.revision', payload: { _telemetry: { phase_execution_id: null }, projections: [
  { table: 'audit_finding', action: 'insert', values: { finding_id: finding, run_id: runId, candidate_id: candidate, fingerprint, fingerprint_hash: hex(fingerprint), current_revision_id: null, current_verdict: 'confirmed', status: 'independently_decided', schema_version: '1.4.0', source_class: 'P', row_version: 0 } },
  { table: 'audit_finding_revision', action: 'insert', values: { finding_revision_id: revision, finding_id: finding, decision_id: decision, revision_no: 1, verdict: 'confirmed', title: 'Synthetic acceptance finding', record_payload_id: '$payload_id', severity_overall: 'medium', confidence_score: 'high', confidence_reason: 'synthetic independent confirmation', severity_likelihood: 'medium', severity_impact: 'medium', status: 'independently_decided', supersedes_revision_id: null, change_reason: 'initial independently decided revision', schema_version: '1.4.0', source_class: 'P' } },
  { table: 'audit_finding_evidence', action: 'insert', values: { finding_evidence_id: ulid(), finding_revision_id: revision, evidence_id: evidence, relation_kind: 'root_cause', ordinal: 1, schema_version: '1.4.0', source_class: 'P' } },
  { table: 'audit_finding_coverage', action: 'insert', values: { finding_coverage_id: ulid(), finding_revision_id: revision, coverage_unit_id: coverage, relation_kind: 'origin', ordinal: 1, schema_version: '1.4.0', source_class: 'P' } },
  { table: 'audit_finding', action: 'update', values: { current_revision_id: revision, row_version: 1 }, where: { finding_id: finding, row_version: 0 } }
] }, source_refs: [] });

record({ run_id: runId, phase_code: 'POST', event_type: 'human.adjudication_recorded', actor_type: 'human', actor_id: 'synthetic-reviewer', idempotency_key: `run/${runId}/POST/finding/${finding}/adjudication/1`, payload_type: 'human.adjudication', payload: { _telemetry: { phase_execution_id: null }, projections: [{ table: 'audit_human_adjudication', action: 'insert', values: { adjudication_id: ulid(), run_id: runId, subject_type: 'finding', label_scheme: 'security_validity_v1', hypothesis_id: null, candidate_id: null, finding_id: finding, adjudicator_pseudonym: 'synthetic-reviewer', label: 'false_positive', rationale: 'synthetic disagreement exercises separation of internal and human labels', evidence_payload_id: '$payload_id', eligible_for_metrics: false, adjudicated_at: mysqlDate(), schema_version: '1.4.0', source_class: 'P' } }] }, source_refs: [] });

const finalized = record({ run_id: runId, phase_code: 'P6', event_type: 'run.finalized', actor_type: 'parent', idempotency_key: `run/${runId}/P6/final/complete`, payload_type: 'run.finalized', payload: { _telemetry: { phase_execution_id: null }, projections: [{ table: 'audit_run', action: 'update', values: { run_status: 'complete', telemetry_local_status: 'healthy', telemetry_remote_status: 'synced', outbox_status: 'empty', incomplete_reason: null, telemetry_incomplete_reason: null, ended_at: mysqlDate(), row_version: 1 }, where: { run_id: runId, row_version: 0 } }] }, source_refs: [] });

const replay = writer.projectRecord(initial, state, writerOptions);
if (replay.status !== 'already_applied') throw new Error(`idempotency replay failed: ${replay.status}`);
const escapedRun = `'${runId}'`;
const summaryQuery = `SELECT r.run_status,r.telemetry_remote_status,r.outbox_status,COUNT(DISTINCT t.task_id),COUNT(DISTINCT h.hypothesis_id),COUNT(DISTINCT s.hypothesis_score_id),COUNT(DISTINCT ap.attack_plan_id),COUNT(DISTINCT ae.attack_execution_id),COUNT(DISTINCT c.candidate_id),COUNT(DISTINCT v.validation_id),COUNT(DISTINCT d.decision_id),COUNT(DISTINCT f.finding_id),COUNT(DISTINCT fr.finding_revision_id),COUNT(DISTINCT ha.adjudication_id) FROM audit_run r LEFT JOIN audit_agent_task t ON t.run_id=r.run_id LEFT JOIN audit_hypothesis h ON h.run_id=r.run_id LEFT JOIN audit_hypothesis_version hv ON hv.hypothesis_id=h.hypothesis_id LEFT JOIN audit_hypothesis_score s ON s.hypothesis_version_id=hv.hypothesis_version_id LEFT JOIN audit_attack_plan ap ON ap.hypothesis_version_id=hv.hypothesis_version_id LEFT JOIN audit_attack_step ast ON ast.attack_plan_id=ap.attack_plan_id LEFT JOIN audit_attack_execution ae ON ae.attack_step_id=ast.attack_step_id LEFT JOIN audit_candidate c ON c.run_id=r.run_id LEFT JOIN audit_validation v ON v.candidate_id=c.candidate_id LEFT JOIN audit_decision d ON d.validation_id=v.validation_id LEFT JOIN audit_finding f ON f.run_id=r.run_id LEFT JOIN audit_finding_revision fr ON fr.finding_id=f.finding_id LEFT JOIN audit_human_adjudication ha ON ha.run_id=r.run_id WHERE r.run_id=${escapedRun} GROUP BY r.run_id;`;
const summaryResult = cp.spawnSync('mysql', writer.mysqlArgs(writerOptions), { input: summaryQuery, encoding: 'utf8', env: process.env, maxBuffer: 1024 * 1024 });
if (summaryResult.status !== 0) throw new Error('remote acceptance summary query failed');
const summary = summaryResult.stdout.trim().split('\t');
if (summary.length !== 14 || summary.slice(0, 3).join('/') !== 'complete/synced/empty' || summary.slice(3).some((value) => Number(value) < 1)) throw new Error(`remote lineage verification failed: ${summary.join('/')}`);

process.stdout.write(`${JSON.stringify({ status: 'pass', output_dir: outputDir, run_id: runId, hunter_task_id: hunterTask, verifier_task_id: verifierTask, hypothesis_id: hypothesis, hypothesis_version_id: hypothesisVersion, coverage_unit_id: coverage, candidate_id: candidate, validation_id: validation, finding_id: finding, finding_revision_id: revision, final_event_id: finalized.event_id, checkpoint_sequence: checkpoint.sequence, replay_status: replay.status, lineage_counts: summary.slice(3).map(Number) })}\n`);
