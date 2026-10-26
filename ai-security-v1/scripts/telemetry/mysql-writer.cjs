'use strict';

const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { sha256 } = require('./event-builder.cjs');
const { transactionSql } = require('./projection.cjs');

const contractManifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../../references/telemetry/contract-manifest.json'), 'utf8'));
const EXPECTED_TABLES = contractManifest.core_table_count;

function connection() {
  const value = {
    host: process.env.AI_SECURITY_DB_HOST,
    port: process.env.AI_SECURITY_DB_PORT || '3306',
    user: process.env.AI_SECURITY_DB_USER,
    database: process.env.AI_SECURITY_DB_NAME
  };
  if (!value.host || !value.user || !value.database) throw new Error('AUTH_REQUIRED: trusted Writer connection environment is incomplete');
  if (value.database !== 'ai_security') throw new Error('SCHEMA_INCOMPATIBLE: Writer may connect only to ai_security');
  if (!/^\d{1,5}$/.test(String(value.port)) || Number(value.port) < 1 || Number(value.port) > 65535) throw new Error('AUTH_REQUIRED: invalid database port');
  return value;
}

function mysqlArgs(options = {}) {
  const value = connection();
  const tlsMode = options.tlsMode || 'PREFERRED';
  if (!new Set(['PREFERRED', 'VERIFY_IDENTITY']).has(tlsMode)) throw new Error('AUTH_REQUIRED: invalid TLS mode');
  return ['--host', value.host, '--port', String(value.port), '--user', value.user, '--database', value.database, `--ssl-mode=${tlsMode}`, '--default-character-set=utf8mb4', '--batch', '--raw', '--skip-column-names'];
}

function runMysql(sql, options = {}) {
  if (!process.env.MYSQL_PWD) throw new Error('AUTH_REQUIRED: MYSQL_PWD is not available to the trusted Writer');
  const result = cp.spawnSync('mysql', mysqlArgs(options), { input: sql, encoding: 'utf8', env: process.env, maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw new Error('DB_UNAVAILABLE: mysql client could not start');
  if (result.status !== 0) {
    const code = /CONCURRENCY_CONFLICT/.test(result.stderr || '') ? 'CONCURRENCY_CONFLICT' : 'PROJECTION_FAILED';
    const error = new Error(`${code}: MySQL transaction failed`);
    error.code = code;
    throw error;
  }
  return result.stdout || '';
}

function quoteStrict(value, pattern, name) {
  if (!pattern.test(value)) throw new Error(`invalid ${name}`);
  return `'${value}'`;
}

function preflight(options = {}) {
  const database = runMysql('SELECT DATABASE(); SELECT VERSION(); SHOW STATUS LIKE \'Ssl_cipher\';', options).trim().split('\n');
  if (database[0] !== 'ai_security') throw new Error('SCHEMA_INCOMPATIBLE: Writer is not connected to ai_security');
  const rows = runMysql("SELECT TABLE_NAME,COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME LIKE 'audit\\_%' ESCAPE '\\\\' ORDER BY TABLE_NAME,ORDINAL_POSITION;", options).trim().split('\n').filter(Boolean);
  const columns = new Map();
  for (const row of rows) {
    const [table, column] = row.split('\t');
    if (!columns.has(table)) columns.set(table, new Set());
    columns.get(table).add(column);
  }
  if (columns.size !== EXPECTED_TABLES) throw new Error(`SCHEMA_INCOMPATIBLE: expected ${EXPECTED_TABLES} audit tables, found ${columns.size}`);
  const columnLines = [];
  for (const [table, names] of [...columns.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) for (const column of [...names].sort()) columnLines.push(`${table}.${column}`);
  const columnHash = crypto.createHash('sha256').update(`${columnLines.join('\n')}\n`).digest('hex');
  if (columnLines.length !== contractManifest.database_column_count || columnHash !== contractManifest.database_columns_sha256) throw new Error('SCHEMA_INCOMPATIBLE: remote columns differ from the pinned database contract');
  return { columns, server_version: database[1] || null, ssl_cipher: database.find((line) => line.startsWith('Ssl_cipher\t'))?.split('\t')[1] || null };
}

function existingEnvelope(record, options = {}) {
  const run = quoteStrict(record.envelope.run_id, /^[0-9A-HJKMNP-TV-Z]{26}$/, 'run_id');
  const idempotency = sha256(record.envelope.idempotency_key);
  const output = runMysql(`SELECT LOWER(HEX(envelope_sha256)) FROM audit_event WHERE run_id=${run} AND idempotency_hash=UNHEX('${idempotency}') LIMIT 1;`, options).trim();
  return output || null;
}

function projectRecord(record, cachedPreflight, options = {}) {
  const existing = existingEnvelope(record, options);
  if (existing) {
    if (existing === record.envelope_sha256) return { status: 'already_applied', event_id: record.envelope.event_id };
    const error = new Error('IDEMPOTENCY_CONFLICT: same key has a different envelope');
    error.code = 'IDEMPOTENCY_CONFLICT';
    throw error;
  }
  const state = cachedPreflight || preflight(options);
  try {
    runMysql(transactionSql(record, state.columns), options);
  } catch (error) {
    const afterRace = existingEnvelope(record, options);
    if (afterRace === record.envelope_sha256) return { status: 'already_applied', event_id: record.envelope.event_id };
    throw error;
  }
  return { status: 'projected', event_id: record.envelope.event_id, ssl_cipher: state.ssl_cipher };
}

module.exports = { connection, mysqlArgs, preflight, projectRecord };
