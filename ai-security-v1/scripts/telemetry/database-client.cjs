'use strict';

const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { sha256 } = require('./event-builder.cjs');
const { transactionSql } = require('./projection.cjs');

const contractManifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../../references/telemetry/contract-manifest.json'), 'utf8'));
const EXPECTED_TABLES = contractManifest.core_table_count;

function documentedProfile() {
  const file = path.join(__dirname, '../../DATABASE.md');
  try {
    const text = fs.readFileSync(file, 'utf8');
    const field = (name) => text.match(new RegExp('^- ' + name + ': `([^`]+)`', 'm'))?.[1] || null;
    return { host: field('Host'), port: field('Port') || '3306', user: field('User'), database: field('Database'), password: field('Password') };
  } catch {
    return { host: null, port: '3306', user: null, database: null, password: null };
  }
}

function connection() {
  const documented = documentedProfile();
  const value = {
    host: process.env.AI_SECURITY_DB_HOST || documented.host,
    port: process.env.AI_SECURITY_DB_PORT || documented.port || '3306',
    user: process.env.AI_SECURITY_DB_USER || documented.user,
    database: process.env.AI_SECURITY_DB_NAME || documented.database,
    password: process.env.MYSQL_PWD || documented.password
  };
  if (!value.host || !value.user || !value.database || !value.password) throw new Error('AUTH_REQUIRED: database connection configuration is incomplete');
  if (value.database !== 'ai_security') throw new Error('SCHEMA_INCOMPATIBLE: database client may connect only to ai_security');
  if (!/^\d{1,5}$/.test(String(value.port)) || Number(value.port) < 1 || Number(value.port) > 65535) throw new Error('AUTH_REQUIRED: invalid database port');
  return value;
}

function mysqlArgs(options = {}) {
  const value = connection();
  const tlsMode = options.tlsMode || 'PREFERRED';
  if (!new Set(['PREFERRED', 'VERIFY_IDENTITY']).has(tlsMode)) throw new Error('AUTH_REQUIRED: invalid TLS mode');
  return ['--host', value.host, '--port', String(value.port), '--user', value.user, '--database', value.database, '--connect-timeout=10', `--ssl-mode=${tlsMode}`, '--default-character-set=utf8mb4', '--batch', '--raw', '--skip-column-names'];
}

function classifiedError(stderr) {
  const text = String(stderr || '');
  let code = 'PROJECTION_FAILED';
  let retryable = false;
  if (/CONCURRENCY_CONFLICT/.test(text)) code = 'CONCURRENCY_CONFLICT';
  else if (/Access denied|using password:|authentication plugin/i.test(text)) code = 'AUTH_REQUIRED';
  else if (/Can't connect|Lost connection|server has gone away|timed?\s*out|connection.*(?:refused|reset)|Unknown MySQL server host/i.test(text)) { code = 'DB_UNAVAILABLE'; retryable = true; }
  else if (/doesn't exist|Unknown column|SCHEMA_INCOMPATIBLE/i.test(text)) code = 'SCHEMA_INCOMPATIBLE';
  const error = new Error(`${code}: MySQL operation failed`);
  error.code = code;
  error.retryable = retryable;
  return error;
}

function runMysql(sql, options = {}) {
  const profile = connection();
  const result = cp.spawnSync('mysql', mysqlArgs(options), { input: sql, encoding: 'utf8', env: { ...process.env, MYSQL_PWD: profile.password }, maxBuffer: 8 * 1024 * 1024, timeout: options.timeoutMs || 30000, killSignal: 'SIGTERM' });
  if (result.error) { const error = new Error(result.error.code === 'ETIMEDOUT' ? 'DB_UNAVAILABLE: mysql client timed out' : 'DB_UNAVAILABLE: mysql client could not start'); error.code = 'DB_UNAVAILABLE'; error.retryable = true; throw error; }
  if (result.status !== 0) throw classifiedError(result.stderr);
  return result.stdout || '';
}

function quoteStrict(value, pattern, name) {
  if (!pattern.test(value)) throw new Error(`invalid ${name}`);
  return `'${value}'`;
}

function preflight(options = {}) {
  const database = runMysql('SELECT DATABASE(); SELECT VERSION(); SHOW STATUS LIKE \'Ssl_cipher\';', options).trim().split('\n');
  if (database[0] !== 'ai_security') throw new Error('SCHEMA_INCOMPATIBLE: database client is not connected to ai_security');
  if (!(database[1] || '').startsWith(contractManifest.mysql_server_version)) throw new Error(`SCHEMA_INCOMPATIBLE: expected MySQL ${contractManifest.mysql_server_version}`);
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
  const counts = runMysql("SELECT COUNT(*) FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE(); SELECT COUNT(*) FROM INFORMATION_SCHEMA.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE(); SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME LIKE 'audit\\_%' ESCAPE '\\\\' AND TABLE_COLLATION='utf8mb4_general_ci'; SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME LIKE 'audit\\_%' ESCAPE '\\\\' AND CHARACTER_SET_NAME='utf8mb4';", options).trim().split('\n').map(Number);
  const expected = [contractManifest.foreign_key_count, contractManifest.check_constraint_count, contractManifest.general_ci_table_count, contractManifest.utf8mb4_character_column_count];
  if (counts.length !== expected.length || counts.some((value, index) => value !== expected[index])) throw new Error(`SCHEMA_INCOMPATIBLE: remote constraints or collation fingerprint differs (${counts.join('/')})`);
  return { columns, server_version: database[1] || null, ssl_cipher: database.find((line) => line.startsWith('Ssl_cipher\t'))?.split('\t')[1] || null };
}

function existingEnvelope(record, options = {}) {
  const run = quoteStrict(record.envelope.run_id, /^[0-9A-HJKMNP-TV-Z]{26}$/, 'run_id');
  const idempotency = sha256(record.envelope.idempotency_key);
  const output = runMysql(`SELECT LOWER(HEX(envelope_sha256)) FROM audit_event WHERE run_id=${run} AND idempotency_hash=UNHEX('${idempotency}') LIMIT 1;`, options).trim();
  return output || null;
}

function applyEvent(record, cachedPreflight, options = {}) {
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

module.exports = { applyEvent, classifiedError, connection, mysqlArgs, preflight, runMysql };
