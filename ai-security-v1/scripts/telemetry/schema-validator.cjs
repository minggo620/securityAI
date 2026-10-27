'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { canonicalJson } = require('./canonical-json.cjs');

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const AGENT_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/;
const EVENT_TYPE = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const PROCESS_TYPES = new Set(['recon', 'hunter_plan', 'hunter_result', 'critic', 'candidate_validation', 'final_review']);
const SCHEMA_CACHE = new Map();

function loadSchema(name) {
  if (!SCHEMA_CACHE.has(name)) {
    const file = path.join(__dirname, '../../references/telemetry', name);
    SCHEMA_CACHE.set(name, JSON.parse(fs.readFileSync(file, 'utf8')));
  }
  return SCHEMA_CACHE.get(name);
}

function typeMatches(value, type) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}

function resolveRef(root, ref) {
  if (!ref.startsWith('#/')) throw new Error(`unsupported schema reference: ${ref}`);
  return ref.slice(2).split('/').reduce((value, part) => value[part.replace(/~1/g, '/').replace(/~0/g, '~')], root);
}

function validateNode(value, schema, root, location, errors) {
  if (schema.$ref) return validateNode(value, resolveRef(root, schema.$ref), root, location, errors);
  if (schema.const !== undefined && canonicalJson(value) !== canonicalJson(schema.const)) errors.push(`${location} must equal the required constant`);
  if (schema.enum && !schema.enum.some((item) => canonicalJson(item) === canonicalJson(value))) errors.push(`${location} is not an allowed value`);
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => typeMatches(value, type))) {
      errors.push(`${location} has invalid type`);
      return;
    }
  }
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((branch) => {
      const branchErrors = [];
      validateNode(value, branch, root, location, branchErrors);
      return branchErrors.length === 0;
    }).length;
    if (matches !== 1) errors.push(`${location} must match exactly one schema branch`);
  }
  if (schema.not) {
    const branchErrors = [];
    validateNode(value, schema.not, root, location, branchErrors);
    if (branchErrors.length === 0) errors.push(`${location} matches a forbidden schema`);
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${location} is too short`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${location} is too long`);
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) errors.push(`${location} has invalid format`);
    if (schema.format === 'date-time' && !Number.isFinite(Date.parse(value))) errors.push(`${location} is not a date-time`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${location} is below minimum`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${location} is above maximum`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${location} has too few items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${location} has too many items`);
    if (schema.uniqueItems) {
      const keys = value.map((item) => canonicalJson(item));
      if (new Set(keys).size !== keys.length) errors.push(`${location} contains duplicate items`);
    }
    if (schema.items) value.forEach((item, index) => validateNode(item, schema.items, root, `${location}[${index}]`, errors));
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const required of schema.required || []) if (!Object.hasOwn(value, required)) errors.push(`${location}.${required} is required`);
    if (schema.additionalProperties === false) {
      const known = new Set(Object.keys(schema.properties || {}));
      for (const key of Object.keys(value)) if (!known.has(key)) errors.push(`${location}.${key} is not allowed`);
    }
    for (const [key, childSchema] of Object.entries(schema.properties || {})) if (Object.hasOwn(value, key)) validateNode(value[key], childSchema, root, `${location}.${key}`, errors);
  }
  for (const branch of schema.allOf || []) {
    if (branch.if) {
      const conditionErrors = [];
      validateNode(value, branch.if, root, location, conditionErrors);
      if (conditionErrors.length === 0 && branch.then) validateNode(value, branch.then, root, location, errors);
    } else validateNode(value, branch, root, location, errors);
  }
}

function assertSchema(value, name, code) {
  const schema = loadSchema(name);
  const errors = [];
  validateNode(value, schema, schema, '$', errors);
  if (errors.length) throw new Error(`${code}: ${errors.slice(0, 8).join('; ')}`);
}

function projectionMap() {
  const file = path.join(__dirname, '../../references/telemetry/projection-map.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function validateEnvelope(value) {
  assertSchema(value, 'event-envelope.schema.json', 'INVALID_ENVELOPE');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_ENVELOPE: envelope must be an object');
  const required = ['schema_version', 'event_id', 'idempotency_key', 'run_id', 'phase_code', 'event_type', 'actor_type', 'occurred_at', 'source_class', 'payload_type', 'payload', 'source_refs'];
  for (const key of required) if (!Object.hasOwn(value, key)) throw new Error(`INVALID_ENVELOPE: missing ${key}`);
  const allowed = new Set([...required, 'actor_id', 'agent_task_id', 'correlation_id', 'causation_id']);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`INVALID_ENVELOPE: unknown ${key}`);
  if (value.schema_version !== '1.4.0') throw new Error('INVALID_ENVELOPE: unsupported schema_version');
  if (!ULID.test(value.event_id) || !ULID.test(value.run_id)) throw new Error('INVALID_ENVELOPE: invalid ULID');
  for (const key of ['agent_task_id', 'correlation_id', 'causation_id']) if (value[key] != null && !ULID.test(value[key])) throw new Error(`INVALID_ENVELOPE: invalid ${key}`);
  if (typeof value.idempotency_key !== 'string' || value.idempotency_key.length < 1 || value.idempotency_key.length > 1024 || /[\u0000-\u001f\u007f]/u.test(value.idempotency_key)) throw new Error('INVALID_ENVELOPE: invalid idempotency_key');
  if (!new Set(['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'POST']).has(value.phase_code)) throw new Error('INVALID_ENVELOPE: invalid phase_code');
  if (!EVENT_TYPE.test(value.event_type)) throw new Error('INVALID_ENVELOPE: invalid event_type');
  if (!projectionMap().events.some((entry) => entry.event_type === value.event_type)) throw new Error('INVALID_ENVELOPE: unknown event_type');
  if (!new Set(['parent', 'recon', 'hunter', 'critic', 'verifier', 'replacement_verifier', 'writer', 'system', 'human']).has(value.actor_type)) throw new Error('INVALID_ENVELOPE: invalid actor_type');
  if (value.actor_type === 'writer') throw new Error('INVALID_ENVELOPE: writer actor is reserved for historical events');
  if (!new Set(['S', 'O', 'P', 'D']).has(value.source_class)) throw new Error('INVALID_ENVELOPE: invalid source_class');
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(value.payload_type)) throw new Error('INVALID_ENVELOPE: invalid payload_type');
  if (!value.payload || typeof value.payload !== 'object' || Array.isArray(value.payload)) throw new Error('INVALID_ENVELOPE: payload must be an object');
  if (!Array.isArray(value.source_refs) || value.source_refs.length > 256) throw new Error('INVALID_ENVELOPE: invalid source_refs');
  if (!Number.isFinite(Date.parse(value.occurred_at))) throw new Error('INVALID_ENVELOPE: invalid occurred_at');
  return value;
}

function validateProcess(value) {
  assertSchema(value, 'agent-process-extension.schema.json', 'INVALID_PROCESS');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('process sidecar must be an object');
  const allowed = new Set(['schema_version', 'result_type', 'agent_id', 'explicit_rationale', 'evidence_refs', 'recon_facts', 'hypotheses', 'hypothesis_relations', 'attack_plans', 'observations', 'decision_input', 'critic_review']);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`unknown process field: ${key}`);
  if (value.schema_version !== '1.4.0') throw new Error('unsupported process schema_version');
  if (!PROCESS_TYPES.has(value.result_type)) throw new Error('invalid process result_type');
  if (!AGENT_ID.test(value.agent_id) || RESERVED.test(value.agent_id)) throw new Error('invalid process agent_id');
  if (typeof value.explicit_rationale !== 'string' || !value.explicit_rationale.trim() || value.explicit_rationale.length > 20000) throw new Error('invalid explicit_rationale');
  if (!Array.isArray(value.evidence_refs) || !Array.isArray(value.observations)) throw new Error('process evidence_refs and observations must be arrays');
  if (value.result_type === 'recon' && !Array.isArray(value.recon_facts)) throw new Error('recon requires recon_facts');
  if (value.result_type === 'hunter_plan' && (!Array.isArray(value.hypotheses) || !Array.isArray(value.attack_plans))) throw new Error('hunter_plan requires hypotheses and attack_plans');
  if (value.result_type === 'critic' && (!value.critic_review || typeof value.critic_review !== 'object')) throw new Error('critic requires critic_review');
  if (new Set(['candidate_validation', 'final_review']).has(value.result_type) && (!value.decision_input || typeof value.decision_input !== 'object')) throw new Error('verifier requires decision_input');
  return value;
}

module.exports = { assertSchema, validateEnvelope, validateProcess, projectionMap, ULID };
