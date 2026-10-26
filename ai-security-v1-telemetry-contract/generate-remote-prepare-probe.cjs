'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ddlPath = path.join(__dirname, '001_ai_security_core_schema.sql');
const ddl = fs.readFileSync(ddlPath, 'utf8');

function splitSql(source) {
  const statements = [];
  let current = '';
  let quote = null;
  let escaped = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (!quote && ch === '-' && next === '-' && (i === 0 || /\s/.test(source[i - 1]))) {
      while (i < source.length && source[i] !== '\n') i += 1;
      current += '\n';
      continue;
    }

    current += ch;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote && ch === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        if ((quote === "'" || quote === '"') && source[i + 1] === quote) {
          current += source[i + 1];
          i += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === ';') {
      const statement = current.slice(0, -1).trim();
      if (statement) statements.push(statement);
      current = '';
    }
  }

  if (current.trim()) throw new Error('DDL has an unterminated statement');
  if (quote) throw new Error('DDL has an unterminated quoted value');
  return statements;
}

// CREATE VIEW resolves referenced tables during PREPARE, and the schema-version
// seed resolves its target table. They cannot be tested without creating schema
// objects, so the read-only target probe deliberately covers only table/alter
// syntax. Views, seed data, FKs and CHECK behavior remain isolated-execution gates.
const candidates = splitSql(ddl).filter((statement) =>
  /^(CREATE TABLE|ALTER TABLE)\b/i.test(statement)
);

if (candidates.length !== 40) {
  throw new Error(`expected 40 metadata-independent statements, found ${candidates.length}`);
}

for (const [index, statement] of candidates.entries()) {
  const literal = statement.replace(/\\/g, '\\\\').replace(/'/g, "''");
  process.stdout.write(`-- probe ${index + 1}/${candidates.length}\n`);
  process.stdout.write(`SET @audit_probe_sql = '${literal}';\n`);
  process.stdout.write('PREPARE audit_probe_stmt FROM @audit_probe_sql;\n');
  process.stdout.write('DEALLOCATE PREPARE audit_probe_stmt;\n');
}

process.stdout.write(`SELECT 'REMOTE_PREPARE_PROBE_PASS' AS result, ${candidates.length} AS statements_parsed;\n`);
