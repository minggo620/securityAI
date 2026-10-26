'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MODES = new Set(['off', 'local', 'remote']);
const POLICIES = new Set(['best_effort', 'required']);
const RISKS = new Set(['tls_identity_not_verified', 'broad_database_account']);
const DATA_CLASSES = new Set(['run_metadata', 'agent_metadata', 'structured_claims', 'evidence_metadata', 'redacted_payload', 'artifacts', 'human_labels']);

function defaultConfig() {
  return {
    schema_version: '1.4.0',
    mode: 'local',
    failure_policy: 'best_effort',
    outbox_relative_path: 'telemetry/outbox.jsonl',
    payload_max_bytes: 5242880,
    remote_sync: { enabled: false, tls_mode: 'PREFERRED', tls_identity_verified: false },
    consent: {
      local_outbox: true,
      remote_mysql: false,
      authority_type: 'explicit_user',
      authority_reference: 'local telemetry default; remote not authorized',
      purpose: 'record the observable audit process for analysis and replay',
      data_classes: ['run_metadata', 'agent_metadata', 'structured_claims', 'evidence_metadata', 'redacted_payload', 'artifacts'],
      retention_policy: 'long_term_configurable'
    },
    accepted_risks: ['tls_identity_not_verified', 'broad_database_account']
  };
}

function assertPlainObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`);
}

function validateConfig(config) {
  assertPlainObject(config, 'config');
  const allowed = new Set(['schema_version', 'mode', 'failure_policy', 'outbox_relative_path', 'payload_max_bytes', 'remote_sync', 'consent', 'accepted_risks']);
  for (const key of Object.keys(config)) if (!allowed.has(key)) throw new Error(`unknown config field: ${key}`);
  if (config.schema_version !== '1.4.0') throw new Error('unsupported telemetry schema_version');
  if (!MODES.has(config.mode)) throw new Error('invalid telemetry mode');
  if (!POLICIES.has(config.failure_policy)) throw new Error('invalid failure policy');
  if (!/^telemetry\/[a-z0-9][a-z0-9._-]{0,127}\.jsonl$/.test(config.outbox_relative_path)) throw new Error('unsafe outbox_relative_path');
  if (!Number.isInteger(config.payload_max_bytes) || config.payload_max_bytes < 1 || config.payload_max_bytes > 5242880) throw new Error('invalid payload_max_bytes');
  assertPlainObject(config.remote_sync, 'remote_sync');
  if (typeof config.remote_sync.enabled !== 'boolean') throw new Error('remote_sync.enabled must be boolean');
  if (!new Set(['PREFERRED', 'VERIFY_IDENTITY']).has(config.remote_sync.tls_mode)) throw new Error('invalid tls_mode');
  if (typeof config.remote_sync.tls_identity_verified !== 'boolean') throw new Error('tls_identity_verified must be boolean');
  assertPlainObject(config.consent, 'consent');
  if (typeof config.consent.local_outbox !== 'boolean' || typeof config.consent.remote_mysql !== 'boolean') throw new Error('invalid consent booleans');
  if (!new Set(['explicit_user', 'organization_policy']).has(config.consent.authority_type)) throw new Error('invalid authority_type');
  for (const field of ['authority_reference', 'purpose', 'retention_policy']) if (typeof config.consent[field] !== 'string' || !config.consent[field].trim()) throw new Error(`invalid consent.${field}`);
  if (!Array.isArray(config.consent.data_classes) || !config.consent.data_classes.length) throw new Error('consent.data_classes must be nonempty');
  for (const item of config.consent.data_classes) if (!DATA_CLASSES.has(item)) throw new Error(`invalid data class: ${item}`);
  if (!Array.isArray(config.accepted_risks)) throw new Error('accepted_risks must be an array');
  for (const risk of config.accepted_risks) if (!RISKS.has(risk)) throw new Error(`invalid accepted risk: ${risk}`);
  if (config.mode === 'off' && config.remote_sync.enabled) throw new Error('off mode cannot enable remote sync');
  if (config.mode === 'remote') {
    if (!config.remote_sync.enabled || !config.consent.remote_mysql) throw new Error('AUTH_REQUIRED: remote mode requires active remote consent');
  }
  if (config.remote_sync.tls_mode === 'VERIFY_IDENTITY' && !config.remote_sync.tls_identity_verified) throw new Error('VERIFY_IDENTITY cannot be claimed without identity verification');
  require('./schema-validator.cjs').assertSchema(config, 'telemetry-config.schema.json', 'INVALID_CONFIG');
  return config;
}

function loadConfig(file) {
  if (!file) return validateConfig(defaultConfig());
  const resolved = path.resolve(file);
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('config must be a regular non-symlink file');
  return validateConfig(JSON.parse(fs.readFileSync(resolved, 'utf8')));
}

module.exports = { defaultConfig, loadConfig, validateConfig };
