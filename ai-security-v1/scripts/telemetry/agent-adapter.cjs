'use strict';

const crypto = require('node:crypto');
const { canonicalJson } = require('./canonical-json.cjs');
const { sha256 } = require('./event-builder.cjs');
const { validateProcess, ULID } = require('./schema-validator.cjs');

function mysqlDate(value = new Date().toISOString()) { return value.replace('T', ' ').replace('Z', ''); }
function hex(value) { return { $hex: sha256(value) }; }
function json(value) { return { $json: value }; }
function requireUlid(value, name) { if (!ULID.test(value || '')) throw new Error(`INVALID_PROCESS: trusted context requires ${name}`); return value; }
function requireMapValue(map, key, name) { const value = map?.[key]; if (!value) throw new Error(`INVALID_PROCESS: missing trusted ${name} mapping for ${key}`); return value; }

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function stableId(input, logicalKey) {
  const digest = crypto.createHash('sha256').update(`${input.run_id}\0${input.agent_task_id}\0${input.idempotency_key}\0${logicalKey}`).digest().subarray(0, 10);
  let value = BigInt(`0x${digest.toString('hex')}`);
  let output = '';
  for (let index = 0; index < 16; index += 1) { output = CROCKFORD[Number(value & 31n)] + output; value >>= 5n; }
  return input.agent_task_id.slice(0, 10) + output;
}

function base(input, eventType, suffix, eventId = null) {
  return {
    schema_version: '1.4.0', event_id: eventId || stableId(input, `event:${suffix}`), run_id: input.run_id, phase_code: input.phase_code,
    event_type: eventType, actor_type: input.actor_type, actor_id: input.agent_result._process.agent_id,
    agent_task_id: input.agent_task_id, correlation_id: input.correlation_id || input.agent_task_id,
    causation_id: null, occurred_at: input.occurred_at || new Date().toISOString(), source_class: 'P',
    payload_type: eventType, idempotency_key: `${input.idempotency_key}/${suffix}`,
    request_sha256: sha256(canonicalJson({ run_id: input.run_id, phase_code: input.phase_code, actor_type: input.actor_type, agent_task_id: input.agent_task_id, idempotency_key: input.idempotency_key, event_type: eventType, suffix, agent_result: input.agent_result, context: input.context || {}, source_refs: input.source_refs || [] })),
    source_refs: input.source_refs || []
  };
}

function evidenceOperation(input, ref, evidenceId) {
  const location = ref.relative_path || null;
  return { table: 'audit_evidence', action: 'insert', values: {
    evidence_id: evidenceId, run_id: '$run_id', producer_task_id: input.agent_task_id,
    evidence_type: ref.fact_kind, repo_path: location, start_line: ref.start_line, end_line: ref.end_line,
    scope_name: ref.scope, description: ref.description, artifact_id: null, tool_execution_id: null,
    payload_id: location ? null : '$payload_id', evidence_sha256: hex(canonicalJson(ref)),
    schema_version: '1.4.0', source_class: ref.fact_kind === 'source_fact' ? 'S' : 'O'
  } };
}

function adaptRecon(input, process, context, entities) {
  const events = [];
  const refs = new Map(process.evidence_refs.map((ref) => [ref.ref_id, ref]));
  for (const [index, fact] of process.recon_facts.entries()) {
    const event = base(input, 'recon.fact_recorded', `recon/${fact.fact_id}`);
    const firstRef = fact.evidence_ref_ids.map((id) => refs.get(id)).find(Boolean) || null;
    const evidenceId = firstRef ? stableId(input, `recon:${fact.fact_id}:evidence`) : null;
    entities.evidence[fact.fact_id] = evidenceId;
    const projections = [];
    if (firstRef) projections.push(evidenceOperation(input, firstRef, evidenceId));
    projections.push({ table: 'audit_recon_fact', action: 'insert', values: {
      recon_fact_id: stableId(input, `recon:${fact.fact_id}:fact`), run_id: '$run_id', task_id: input.agent_task_id, recon_kind: fact.recon_kind,
      fact_kind: fact.fact_kind, statement: fact.statement, evidence_id: evidenceId,
      evidence_strength: fact.evidence_strength, unknown_reason: fact.unknown_reason,
      accepted_by_parent: context.accepted_fact_ids?.includes(fact.fact_id) || false,
      included_in_architecture: context.architecture_fact_ids?.includes(fact.fact_id) || false,
      schema_version: '1.4.0', source_class: fact.fact_kind === 'source_fact' ? 'S' : 'O'
    } });
    event.payload = { _telemetry: { phase_execution_id: context.phase_execution_id }, agent_process: process, fact_index: index, projections };
    events.push(event);
  }
  return events;
}

function adaptHunterPlan(input, process, context, entities) {
  const events = [];
  const hypothesisEvents = new Map();
  const evidenceRefs = new Map(process.evidence_refs.map((ref) => [ref.ref_id, ref]));
  for (const hypothesis of process.hypotheses) {
    const coverageId = requireMapValue(context.coverage_units, hypothesis.primary_coverage_id, 'coverage unit');
    const hypothesisId = context.hypotheses?.[hypothesis.hypothesis_key]?.hypothesis_id || stableId(input, `hypothesis:${hypothesis.hypothesis_key}`);
    const versionId = stableId(input, `hypothesis:${hypothesis.hypothesis_key}:version:${hypothesis.version}`);
    const eventId = stableId(input, `event:hypothesis:${hypothesis.hypothesis_key}:version:${hypothesis.version}`);
    const priorRowVersion = hypothesis.version === 1 ? 0 : requireMapValue(context.hypotheses, hypothesis.hypothesis_key, 'hypothesis').row_version;
    entities.hypotheses[hypothesis.hypothesis_key] = { hypothesis_id: hypothesisId, hypothesis_version_id: versionId, event_id: eventId, row_version: hypothesis.version === 1 ? 1 : priorRowVersion + 2 };
    hypothesisEvents.set(hypothesis.hypothesis_key, eventId);
    const eventType = hypothesis.version === 1 ? 'hypothesis.created' : 'hypothesis.revised';
    const event = base(input, eventType, `hypothesis/${hypothesis.hypothesis_key}/v${hypothesis.version}`, eventId);
    const score = hypothesis.score;
    const projections = [{ table: 'audit_hypothesis', action: hypothesis.version === 1 ? 'insert' : 'update', values: hypothesis.version === 1 ? {
      hypothesis_id: hypothesisId, run_id: '$run_id', coverage_unit_id: coverageId, creator_task_id: input.agent_task_id,
      local_hypothesis_key: hypothesis.hypothesis_key, current_version_id: null, status: hypothesis.status,
      schema_version: '1.4.0', source_class: 'P', row_version: 0
    } : { status: hypothesis.status, row_version: priorRowVersion + 1 }, where: hypothesis.version === 1 ? null : {
      hypothesis_id: hypothesisId, row_version: priorRowVersion
    } }, { table: 'audit_hypothesis_version', action: 'insert', values: {
      hypothesis_version_id: versionId, hypothesis_id: hypothesisId, version_no: hypothesis.version, author_task_id: input.agent_task_id,
      attacker_principal: hypothesis.attacker_principal, attacker_capabilities: json(hypothesis.attacker_capabilities), controlled_input: hypothesis.controlled_input,
      entrypoint: hypothesis.entrypoint, expected_invariant: hypothesis.security_invariant, suspected_control_failure: hypothesis.suspected_control_failure,
      predicted_trace: json(hypothesis.predicted_trace), target_boundary: hypothesis.trust_boundary, affected_resource: hypothesis.affected_resource,
      predicted_result: hypothesis.predicted_result, preconditions_json: json(hypothesis.preconditions), unknown_facts_json: json(hypothesis.unknown_facts),
      alternative_explanations_json: json(hypothesis.alternative_explanations), revision_reason: hypothesis.revision_reason || 'initial version',
      schema_version: '1.4.0', source_class: 'P'
    } }];
    hypothesis.coverage_ids.forEach((coverageKey, ordinal) => projections.push({ table: 'audit_hypothesis_coverage', action: 'insert', values: {
      hypothesis_coverage_id: stableId(input, `hypothesis:${hypothesis.hypothesis_key}:coverage:${ordinal + 1}`), hypothesis_id: hypothesisId, coverage_unit_id: requireMapValue(context.coverage_units, coverageKey, 'coverage unit'),
      relation_kind: coverageKey === hypothesis.primary_coverage_id ? 'primary' : 'supporting', ordinal: ordinal + 1, schema_version: '1.4.0', source_class: 'P'
    } }));
    for (const refId of hypothesis.evidence_refs) {
      const ref = evidenceRefs.get(refId);
      if (!ref) throw new Error(`INVALID_PROCESS: missing evidence reference ${refId}`);
      const evidenceId = stableId(input, `hypothesis:${hypothesis.hypothesis_key}:evidence:${refId}`);
      projections.push(evidenceOperation(input, ref, evidenceId));
      projections.push({ table: 'audit_hypothesis_evidence', action: 'insert', values: {
        hypothesis_evidence_id: stableId(input, `hypothesis:${hypothesis.hypothesis_key}:evidence-link:${refId}`), hypothesis_version_id: versionId, evidence_id: evidenceId,
        relation_kind: ref.fact_kind === 'unknown' ? 'unknown' : 'supports', weight: null,
        rationale: ref.description, schema_version: '1.4.0', source_class: ref.fact_kind === 'source_fact' ? 'S' : 'O'
      } });
    }
    projections.push({ table: 'audit_hypothesis_score', action: 'insert', values: {
      hypothesis_score_id: stableId(input, `hypothesis:${hypothesis.hypothesis_key}:score:${hypothesis.version}`), hypothesis_version_id: versionId, score_no: 1, scorer_task_id: input.agent_task_id,
      predicted_probability: score.predicted_probability, probability_rationale: score.probability_rationale, potential_impact: score.potential_impact,
      coverage_value: score.coverage_value, information_gain: score.information_gain, estimated_validation_cost: score.estimated_validation_cost,
      validation_cost_unit: score.cost_unit, estimated_duration_ms: score.estimated_duration_ms ?? null,
      estimated_agent_calls: score.estimated_agent_calls ?? null, estimated_token_count: score.estimated_token_count ?? null,
      priority_score: score.priority_score, formula_name: score.formula_name, formula_version: score.formula_version,
      scoring_protocol: 'agent-explicit-pre-validation', scoring_protocol_version: '1.0', model_config_sha256: null,
      prompt_template_sha256: null, evidence_as_of_event_id: '$event_id', scored_at: mysqlDate(event.occurred_at), schema_version: '1.4.0', source_class: 'P'
    } });
    projections.push({ table: 'audit_hypothesis', action: 'update', values: {
      current_version_id: versionId, row_version: hypothesis.version === 1 ? 1 : priorRowVersion + 2
    }, where: { hypothesis_id: hypothesisId, row_version: hypothesis.version === 1 ? 0 : priorRowVersion + 1 } });
    event.payload = { _telemetry: { phase_execution_id: context.phase_execution_id }, agent_process: process, hypothesis_key: hypothesis.hypothesis_key, projections };
    events.push(event);
  }
  for (const [index, relation] of process.hypothesis_relations.entries()) {
    const from = entities.hypotheses[relation.from_hypothesis_key] || requireMapValue(context.hypotheses, relation.from_hypothesis_key, 'hypothesis');
    const to = entities.hypotheses[relation.to_hypothesis_key] || requireMapValue(context.hypotheses, relation.to_hypothesis_key, 'hypothesis');
    const event = base(input, 'hypothesis.related', `hypothesis-relation/${index + 1}`);
    event.causation_id = to.event_id || from.event_id || null;
    event.payload = { _telemetry: { phase_execution_id: context.phase_execution_id }, relation, projections: [{ table: 'audit_hypothesis_relation', action: 'insert', values: {
      hypothesis_relation_id: stableId(input, `hypothesis-relation:${index + 1}`), run_id: '$run_id', from_hypothesis_id: from.hypothesis_id, to_hypothesis_id: to.hypothesis_id,
      relation_kind: relation.relation_kind, event_id: '$event_id', rationale: relation.rationale,
      schema_version: '1.4.0', source_class: 'P'
    } }] };
    events.push(event);
  }
  for (const plan of process.attack_plans) {
    const hypothesis = entities.hypotheses[plan.hypothesis_key] || requireMapValue(context.hypotheses, plan.hypothesis_key, 'hypothesis');
    const planId = stableId(input, `attack-plan:${plan.hypothesis_key}:${plan.plan_version}`);
    const event = base(input, 'attack.plan_created', `attack-plan/${plan.hypothesis_key}/v${plan.plan_version}`);
    event.causation_id = hypothesis.event_id || hypothesisEvents.get(plan.hypothesis_key) || requireMapValue(context.hypothesis_event_ids, plan.hypothesis_key, 'hypothesis event');
    const steps = {};
    const projections = [{ table: 'audit_attack_plan', action: 'insert', values: {
      attack_plan_id: planId, hypothesis_version_id: hypothesis.hypothesis_version_id, plan_version_no: plan.plan_version,
      author_task_id: input.agent_task_id, plan_mode: plan.mode, objective: plan.objective, stop_condition: plan.stop_condition,
      expected_boundary_result: plan.expected_boundary_result, status: plan.status === 'ready' ? 'approved' : plan.status,
      schema_version: '1.4.0', source_class: 'P'
    } }];
    for (const step of plan.steps) {
      const stepId = stableId(input, `attack-plan:${plan.hypothesis_key}:${plan.plan_version}:step:${step.ordinal}`); steps[step.ordinal] = stepId;
      projections.push({ table: 'audit_attack_step', action: 'insert', values: {
        attack_step_id: stepId, attack_plan_id: planId, ordinal: step.ordinal, action_kind: step.action_kind,
        action_text: step.action, precondition_text: step.precondition, input_description: step.input_description,
        expected_result: step.expected_result, planned_tool: step.planned_tool, status: 'planned', schema_version: '1.4.0', source_class: 'P'
      } });
    }
    entities.attack_plans[plan.hypothesis_key] = { attack_plan_id: planId, event_id: event.event_id, steps };
    event.payload = { _telemetry: { phase_execution_id: context.phase_execution_id }, agent_process: process, plan_key: plan.hypothesis_key, projections };
    events.push(event);
  }
  return events;
}

function adaptHunterResult(input, process, context, entities) {
  const events = [];
  const refs = new Map(process.evidence_refs.map((ref) => [ref.ref_id, ref]));
  for (const observation of process.observations) {
    if (observation.step_ordinal != null) {
      const plan = requireMapValue(context.attack_plans, observation.hypothesis_key, 'attack plan');
      const event = base(input, 'attack.step_observed', `attack/${observation.observation_id}`);
      event.causation_id = plan.event_id;
      const firstRef = observation.evidence_refs.map((refId) => refs.get(refId)).find(Boolean) || null;
      const evidenceId = firstRef ? stableId(input, `hunter-observation:${observation.observation_id}:evidence`) : null;
      const projections = [];
      if (firstRef) projections.push(evidenceOperation(input, firstRef, evidenceId));
      projections.push({ table: 'audit_attack_execution', action: 'insert', values: {
        attack_execution_id: stableId(input, `hunter-observation:${observation.observation_id}:execution`), attack_step_id: requireMapValue(plan.steps, String(observation.step_ordinal), 'attack step'),
        execution_no: 1, executor_task_id: input.agent_task_id, execution_mode: observation.execution_mode,
        status: observation.status, actual_input_payload_id: observation.actual_input ? '$payload_id' : null,
        observed_result: observation.observed, tool_execution_id: null, evidence_id: evidenceId, blocker_reason: observation.blocker_reason,
        started_at: null, ended_at: mysqlDate(event.occurred_at), schema_version: '1.4.0', source_class: 'O'
      } });
      event.payload = { _telemetry: { phase_execution_id: context.phase_execution_id }, observation, projections };
      events.push(event);
    }
    if (observation.candidate_fingerprint) {
      const hv = requireMapValue(context.hypotheses, observation.hypothesis_key, 'hypothesis');
      const event = base(input, 'candidate.observed', `candidate-observation/${observation.observation_id}`);
      const observationId = stableId(input, `candidate-observation:${observation.observation_id}`);
      entities.candidate_observations[observation.observation_id] = { candidate_observation_id: observationId, event_id: event.event_id };
      event.payload = { _telemetry: { phase_execution_id: context.phase_execution_id }, observation, projections: [{ table: 'audit_candidate_observation', action: 'insert', values: {
        candidate_observation_id: observationId, run_id: '$run_id', candidate_id: null, producer_task_id: input.agent_task_id,
        observation_kind: 'hunter_proposal', hypothesis_version_id: hv.hypothesis_version_id,
        local_fingerprint: observation.candidate_fingerprint, local_fingerprint_hash: hex(observation.candidate_fingerprint.normalize('NFC')),
        proposed_verdict: observation.relation_to_claim === 'supports' ? 'confirmed' : 'needs_validation', payload_id: '$payload_id',
        observed_at: mysqlDate(event.occurred_at), schema_version: '1.4.0', source_class: 'O'
      } }] };
      events.push(event);
    }
  }
  return events;
}

function adaptVerifier(input, process, context) {
  const events = [];
  const refs = new Map(process.evidence_refs.map((ref) => [ref.ref_id, ref]));
  const startedEvent = requireUlid(context.validation_started_event_id, 'validation_started_event_id');
  const validationId = requireUlid(context.validation_id, 'validation_id');
  for (const [index, observation] of process.observations.entries()) {
    const event = base(input, 'validation.observation_recorded', `validation-observation/${observation.observation_id}`);
    event.causation_id = startedEvent;
    const firstRef = observation.evidence_refs.map((refId) => refs.get(refId)).find(Boolean) || null;
    const evidenceId = context.evidence_ids?.[observation.observation_id] || (firstRef ? stableId(input, `validation-observation:${observation.observation_id}:evidence`) : null);
    const projections = [];
    if (firstRef && !context.evidence_ids?.[observation.observation_id]) projections.push(evidenceOperation(input, firstRef, evidenceId));
    projections.push({ table: 'audit_validation_observation', action: 'insert', values: {
      validation_observation_id: stableId(input, `validation-observation:${observation.observation_id}`), validation_id: validationId, ordinal: index + 1, observation_kind: observation.kind,
      expected_text: observation.expected, observed_text: observation.observed, relation_to_claim: observation.relation_to_claim,
      evidence_id: evidenceId, schema_version: '1.4.0', source_class: 'O'
    } });
    event.payload = { _telemetry: { phase_execution_id: context.phase_execution_id }, observation, projections };
    events.push(event);
  }
  if (context.decision) {
    const event = base(input, 'validation.decided', `validation-decision/${context.decision.decision_no || 1}`);
    event.causation_id = startedEvent;
    event.payload = { _telemetry: { phase_execution_id: context.phase_execution_id }, agent_process: process, projections: [{ table: 'audit_decision', action: 'insert', values: {
      decision_id: context.decision.decision_id || stableId(input, `validation-decision:${context.decision.decision_no || 1}`), validation_id: validationId, decision_no: context.decision.decision_no || 1,
      decision: context.decision.decision, reason: context.decision.reason, record_payload_id: '$payload_id',
      material_change: Boolean(context.decision.material_change), supersedes_decision_id: context.decision.supersedes_decision_id || null,
      decided_at: mysqlDate(event.occurred_at), schema_version: '1.4.0', source_class: 'P'
    } }, { table: 'audit_candidate', action: 'update', values: {
      status: 'decided', row_version: context.candidate_row_version + 1
    }, where: { candidate_id: requireUlid(context.candidate_id, 'candidate_id'), row_version: context.candidate_row_version } }] };
    events.push(event);
  }
  return events;
}

function completionEvent(input, process, context) {
  if (!Number.isInteger(context.task_row_version) || context.task_row_version < 0) throw new Error('INVALID_PROCESS: trusted context requires task_row_version');
  const event = base(input, 'agent.task_completed', 'task-completed');
  event.payload = { _telemetry: { phase_execution_id: context.phase_execution_id }, agent_result: input.agent_result, projections: [{ table: 'audit_agent_task', action: 'update', values: {
    output_payload_id: '$payload_id', status: 'succeeded', ended_at: mysqlDate(event.occurred_at),
    execution_duration_ms: context.execution_duration_ms ?? null, row_version: context.task_row_version + 1
  }, where: { task_id: input.agent_task_id, row_version: context.task_row_version } }] };
  return event;
}

function adaptAgentResult(input) {
  if (!input.agent_result || typeof input.agent_result !== 'object' || Array.isArray(input.agent_result)) throw new Error('INVALID_PROCESS: agent_result must be an object');
  const process = validateProcess(input.agent_result._process);
  const context = input.context || {};
  requireUlid(input.run_id, 'run_id'); requireUlid(input.agent_task_id, 'agent_task_id'); requireUlid(context.phase_execution_id, 'phase_execution_id');
  const expectedRole = { recon: 'recon', hunter_plan: 'hunter', hunter_result: 'hunter', critic: 'critic', candidate_validation: 'verifier', final_review: 'replacement_verifier' }[process.result_type];
  if (input.actor_type !== expectedRole && !(process.result_type === 'final_review' && input.actor_type === 'verifier')) throw new Error('INVALID_PROCESS: actor_type does not match result_type');
  const entities = { evidence: {}, hypotheses: {}, attack_plans: {}, candidate_observations: {} };
  let events = [];
  if (process.result_type === 'recon') events = adaptRecon(input, process, context, entities);
  else if (process.result_type === 'hunter_plan') events = adaptHunterPlan(input, process, context, entities);
  else if (process.result_type === 'hunter_result') events = adaptHunterResult(input, process, context, entities);
  else if (process.result_type === 'candidate_validation' || process.result_type === 'final_review') events = adaptVerifier(input, process, context, entities);
  else if (process.result_type === 'critic') {
    if (!Number.isInteger(context.task_row_version) || context.task_row_version < 0) throw new Error('INVALID_PROCESS: trusted context requires task_row_version');
    const event = base(input, 'critic.review_completed', 'critic-review');
    event.payload = { _telemetry: { phase_execution_id: context.phase_execution_id }, agent_process: process, projections: [{ table: 'audit_agent_task', action: 'update', values: {
      output_payload_id: '$payload_id', status: 'succeeded', ended_at: mysqlDate(event.occurred_at), row_version: context.task_row_version + 1
    }, where: { task_id: input.agent_task_id, row_version: context.task_row_version } }] };
    events.push(event);
    for (const item of context.reopened_units || []) {
      requireUlid(item.coverage_unit_id, 'reopened coverage_unit_id');
      requireUlid(item.new_owner_task_id, 'reopened new_owner_task_id');
      if (!Number.isInteger(item.row_version) || !Number.isInteger(item.wave) || item.wave < 1 || !item.reason) throw new Error('INVALID_PROCESS: invalid reopened coverage unit context');
      const reopened = base(input, 'coverage.reopened', `coverage-reopened/${item.coverage_unit_id}/wave/${item.wave}`);
      reopened.causation_id = event.event_id;
      reopened.payload = { _telemetry: { phase_execution_id: context.phase_execution_id }, critic_item: item, projections: [{ table: 'audit_coverage_attempt', action: 'insert', values: {
        coverage_attempt_id: stableId(input, `coverage:${item.coverage_unit_id}:attempt:${item.wave}`), coverage_unit_id: item.coverage_unit_id, wave: item.wave, status: item.prior_status || 'blocked',
        owner_task_id: item.prior_owner_task_id || input.agent_task_id, snapshot_payload_id: '$payload_id', reassignment_reason: item.reason,
        schema_version: '1.4.0', source_class: 'P'
      } }, { table: 'audit_coverage_unit', action: 'update', values: {
        wave: item.wave, status: 'planned', owner_task_id: item.new_owner_task_id, row_version: item.row_version + 1
      }, where: { coverage_unit_id: item.coverage_unit_id, row_version: item.row_version } }] };
      events.push(reopened);
    }
    return { events, entities };
  }
  events.push(completionEvent(input, process, context));
  return { events, entities };
}

module.exports = { adaptAgentResult };
