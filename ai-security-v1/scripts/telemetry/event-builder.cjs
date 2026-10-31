'use strict';

const crypto = require('node:crypto');
const { ulid } = require('./ulid.cjs');
const { canonicalJson } = require('./canonical-json.cjs');
const { redactPayload } = require('./redactor.cjs');
const { validateEnvelope } = require('./schema-validator.cjs');

function normalizeIdempotencyKey(value) {
  if (typeof value !== 'string') throw new Error('idempotency key must be a string');
  const normalized = value.normalize('NFC');
  if (normalized !== normalized.trim() || !normalized || normalized.length > 1024 || /[\u0000-\u001f\u007f\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/u.test(normalized)) throw new Error('invalid idempotency key');
  return normalized;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function buildEvent(input, config) {
  const idempotencyKey = normalizeIdempotencyKey(input.idempotency_key);
  const requestMaterial = structuredClone(input);
  delete requestMaterial.event_id;
  delete requestMaterial.occurred_at;
  delete requestMaterial.request_sha256;
  if (requestMaterial.payload?._telemetry) {
    delete requestMaterial.payload._telemetry.payload_id;
    delete requestMaterial.payload._telemetry.request_sha256;
  }
  const requestSha256 = input.request_sha256 || sha256(canonicalJson(requestMaterial));
  if (!/^[0-9a-f]{64}$/.test(requestSha256)) throw new Error('INVALID_ENVELOPE: invalid request_sha256');
  const rawPayload = input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload) ? structuredClone(input.payload) : {};
  rawPayload._telemetry = {
    ...(rawPayload._telemetry || {}),
    payload_id: rawPayload._telemetry?.payload_id || ulid(),
    phase_execution_id: rawPayload._telemetry?.phase_execution_id || null,
    request_sha256: requestSha256
  };
  const redaction = redactPayload(rawPayload, { maxBytes: config.payload_max_bytes });
  const payload = redaction.content === null ? {
    redaction_status: 'blocked',
    content: { _telemetry: rawPayload._telemetry },
    original_bytes: redaction.original_bytes,
    stored_bytes: 0,
    is_truncated: false,
    error_code: redaction.error_code
  } : {
    redaction_status: redaction.redaction_status,
    content: redaction.content,
    content_sha256: redaction.content_sha256,
    original_bytes: redaction.original_bytes,
    stored_bytes: redaction.stored_bytes,
    is_truncated: redaction.is_truncated
  };
  const event = {
    schema_version: '1.5.0',
    event_id: input.event_id || ulid(),
    idempotency_key: idempotencyKey,
    run_id: input.run_id,
    phase_code: input.phase_code,
    event_type: input.event_type,
    actor_type: input.actor_type || 'parent',
    actor_id: input.actor_id ?? null,
    agent_task_id: input.agent_task_id ?? null,
    correlation_id: input.correlation_id ?? null,
    causation_id: input.causation_id ?? null,
    occurred_at: input.occurred_at || new Date().toISOString(),
    source_class: input.source_class || 'P',
    payload_type: input.payload_type || 'event',
    payload,
    source_refs: input.source_refs || []
  };
  validateEnvelope(event);
  const envelopeJson = canonicalJson(event);
  return {
    event,
    envelope_json: envelopeJson,
    envelope_sha256: sha256(envelopeJson),
    idempotency_hash: sha256(idempotencyKey),
    redaction_status: redaction.redaction_status
  };
}

module.exports = { buildEvent, normalizeIdempotencyKey, sha256 };
