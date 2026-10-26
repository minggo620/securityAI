'use strict';

const { canonicalJson } = require('./canonical-json.cjs');
const { projectionMap } = require('./schema-validator.cjs');

const PRE_EVENT = new Set(['audit_run', 'audit_payload', 'audit_phase_execution', 'audit_agent_task', 'audit_run_scope']);
const RESERVED = new Set(['audit_payload', 'audit_event']);

function eventRule(eventType) {
  const rule = projectionMap().events.find((entry) => entry.event_type === eventType);
  if (!rule) throw new Error(`PROJECTION_FAILED: no projection rule for ${eventType}`);
  return rule;
}

function rawContent(event) {
  return event.payload && event.payload.content && typeof event.payload.content === 'object' ? event.payload.content : {};
}

function symbolic(value, context) {
  if (value === '$run_id') return context.run_id;
  if (value === '$event_id') return context.event_id;
  if (value === '$payload_id') return context.payload_id;
  if (value === '$agent_task_id') return context.agent_task_id;
  return value;
}

function normalizeValue(value, context) {
  if (typeof value === 'string') return symbolic(value, context);
  if (Array.isArray(value)) return value.map((item) => normalizeValue(item, context));
  if (value && typeof value === 'object') {
    if (Object.keys(value).length === 1 && typeof value.$hex === 'string') {
      if (!/^[0-9a-f]*$/i.test(value.$hex) || value.$hex.length % 2) throw new Error('PROJECTION_FAILED: invalid binary hex');
      return { $hex: value.$hex.toLowerCase() };
    }
    if (Object.keys(value).length === 1 && Object.hasOwn(value, '$json')) return { $json: normalizeValue(value.$json, context) };
    const output = {};
    for (const [key, entry] of Object.entries(value)) output[key] = normalizeValue(entry, context);
    return output;
  }
  return value;
}

function validateIdentifier(value) {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error(`PROJECTION_FAILED: unsafe identifier ${value}`);
  return value;
}

function operationsFor(event) {
  const content = rawContent(event);
  const provided = Array.isArray(content.projections) ? content.projections : [];
  const rule = eventRule(event.event_type);
  const allowed = new Set(rule.tables);
  const context = {
    run_id: event.run_id,
    event_id: event.event_id,
    payload_id: content._telemetry?.payload_id,
    agent_task_id: event.agent_task_id
  };
  if (!context.payload_id) throw new Error('PROJECTION_FAILED: missing payload_id');
  const operations = provided.map((operation, index) => {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) throw new Error(`PROJECTION_FAILED: operation ${index} must be an object`);
    const table = validateIdentifier(operation.table);
    if (!allowed.has(table) || RESERVED.has(table)) throw new Error(`PROJECTION_FAILED: ${table} is not writable for ${event.event_type}`);
    if (!new Set(['insert', 'update']).has(operation.action)) throw new Error('PROJECTION_FAILED: invalid operation action');
    if (!operation.values || typeof operation.values !== 'object' || Array.isArray(operation.values) || !Object.keys(operation.values).length) throw new Error('PROJECTION_FAILED: values required');
    const values = Object.fromEntries(Object.entries(operation.values).map(([column, value]) => [validateIdentifier(column), normalizeValue(value, context)]));
    const where = operation.where ? Object.fromEntries(Object.entries(operation.where).map(([column, value]) => [validateIdentifier(column), normalizeValue(value, context)])) : null;
    if (operation.action === 'update' && (!where || !Object.keys(where).length)) throw new Error('PROJECTION_FAILED: update requires where');
    return { table, action: operation.action, values, where };
  });
  return { operations, context, rule };
}

function bindValue(value) {
  if (value === null) return 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('PROJECTION_FAILED: non-finite number');
    return String(value);
  }
  if (value && typeof value === 'object' && Object.hasOwn(value, '$hex')) return `UNHEX('${value.$hex}')`;
  const text = value && typeof value === 'object' && Object.hasOwn(value, '$json') ? canonicalJson(value.$json) : String(value);
  return `CONVERT(0x${Buffer.from(text, 'utf8').toString('hex')} USING utf8mb4)`;
}

function operationSql(operation, columns, sequence) {
  const known = columns.get(operation.table);
  if (!known) throw new Error(`PROJECTION_FAILED: table ${operation.table} not present in preflight`);
  const valueEntries = Object.entries(operation.values);
  const whereEntries = Object.entries(operation.where || {});
  for (const [column] of [...valueEntries, ...whereEntries]) if (!known.has(column)) throw new Error(`PROJECTION_FAILED: unknown column ${operation.table}.${column}`);
  if (operation.action === 'update' && known.has('row_version')) {
    if (!Object.hasOwn(operation.where, 'row_version') || !Object.hasOwn(operation.values, 'row_version')) throw new Error(`PROJECTION_FAILED: ${operation.table} update requires row_version CAS`);
  }
  const bindings = [...valueEntries, ...whereEntries].map(([_, value], index) => `SET @p${sequence}_${index} = ${bindValue(value)};`);
  const variables = valueEntries.map((_, index) => `@p${sequence}_${index}`);
  let statement;
  if (operation.action === 'insert') {
    statement = `INSERT INTO ${operation.table} (${valueEntries.map(([column]) => column).join(',')}) VALUES (${valueEntries.map(() => '?').join(',')})`;
  } else {
    const guardStatement = `SELECT COUNT(*) INTO @telemetry_match FROM ${operation.table} WHERE ${whereEntries.map(([column]) => `${column}=?`).join(' AND ')}`;
    const guardHex = Buffer.from(guardStatement, 'utf8').toString('hex');
    const whereVariables = whereEntries.map((_, index) => `@p${sequence}_${valueEntries.length + index}`);
    bindings.push(`SET @guard_${sequence} = CONVERT(0x${guardHex} USING utf8mb4);`, 'PREPARE telemetry_guard FROM @guard_' + sequence + ';', `EXECUTE telemetry_guard USING ${whereVariables.join(',')};`, 'DEALLOCATE PREPARE telemetry_guard;', `SET @guard_action_${sequence} = IF(@telemetry_match = 1, 'DO 0', 'SIGNAL SQLSTATE ''45000'' SET MESSAGE_TEXT=''CONCURRENCY_CONFLICT''');`, `PREPARE telemetry_guard_action FROM @guard_action_${sequence};`, 'EXECUTE telemetry_guard_action;', 'DEALLOCATE PREPARE telemetry_guard_action;');
    statement = `UPDATE ${operation.table} SET ${valueEntries.map(([column]) => `${column}=?`).join(',')} WHERE ${whereEntries.map(([column]) => `${column}=?`).join(' AND ')}`;
    variables.push(...whereEntries.map((_, index) => `@p${sequence}_${valueEntries.length + index}`));
  }
  const encodedStatement = Buffer.from(statement, 'utf8').toString('hex');
  return [...bindings, `SET @stmt_${sequence} = CONVERT(0x${encodedStatement} USING utf8mb4);`, `PREPARE telemetry_stmt FROM @stmt_${sequence};`, `EXECUTE telemetry_stmt USING ${variables.join(',')};`, 'DEALLOCATE PREPARE telemetry_stmt;'].join('\n');
}

function payloadRow(event) {
  const content = rawContent(event);
  const body = event.payload.redaction_status === 'blocked' ? null : content;
  return {
    table: 'audit_payload',
    action: 'insert',
    values: {
      payload_id: content._telemetry?.payload_id,
      run_id: event.run_id,
      payload_type: event.payload_type,
      mime_type: 'application/json',
      content_json: body === null ? null : { $json: body },
      content_text: null,
      content_sha256: event.payload.content_sha256 ? { $hex: event.payload.content_sha256 } : null,
      stored_bytes: event.payload.stored_bytes || 0,
      original_bytes: event.payload.original_bytes || 0,
      original_fingerprint_hmac: null,
      fingerprint_key_version: null,
      is_truncated: Boolean(event.payload.is_truncated),
      redaction_status: event.payload.redaction_status,
      redaction_profile: 'telemetry-default',
      redaction_version: '1.4.0',
      sensitivity: 'internal',
      retention_policy: 'long_term_configurable',
      retain_until: null,
      purged_at: null,
      purge_reason: null,
      schema_version: '1.4.0',
      source_class: event.source_class
    }
  };
}

function eventRow(event, envelopeSha256, idempotencyHash) {
  const content = rawContent(event);
  return {
    table: 'audit_event', action: 'insert', values: {
      event_id: event.event_id,
      run_id: event.run_id,
      phase_execution_id: content._telemetry?.phase_execution_id || null,
      event_type: event.event_type,
      actor_type: event.actor_type,
      actor_id: event.actor_id,
      agent_task_id: event.agent_task_id,
      correlation_id: event.correlation_id,
      causation_id: event.causation_id,
      idempotency_key: event.idempotency_key,
      idempotency_hash: { $hex: idempotencyHash },
      payload_id: content._telemetry?.payload_id,
      source_refs_json: { $json: event.source_refs },
      envelope_sha256: { $hex: envelopeSha256 },
      occurred_at: event.occurred_at.replace('T', ' ').replace('Z', ''),
      schema_version: '1.4.0',
      source_class: event.source_class
    }
  };
}

function transactionSql(record, columns) {
  const event = record.envelope;
  const { operations } = operationsFor(event);
  const normalized = operations.map((operation) => ({ ...operation, values: normalizeValue(operation.values, {}), where: normalizeValue(operation.where, {}) }));
  const run = normalized.filter((operation) => operation.table === 'audit_run');
  const pre = normalized.filter((operation) => PRE_EVENT.has(operation.table) && operation.table !== 'audit_run');
  const post = normalized.filter((operation) => !PRE_EVENT.has(operation.table));
  const sequence = [...run, payloadRow(event), ...pre, eventRow(event, record.envelope_sha256, require('./event-builder.cjs').sha256(event.idempotency_key)), ...post];
  return ['START TRANSACTION;', ...sequence.map((operation, index) => operationSql(operation, columns, index)), 'COMMIT;'].join('\n');
}

module.exports = { bindValue, eventRule, operationSql, operationsFor, transactionSql };
