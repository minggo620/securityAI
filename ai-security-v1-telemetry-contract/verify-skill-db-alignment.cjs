'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const dir = __dirname;
const projectDir = path.dirname(dir);
const read = (file) => fs.readFileSync(path.join(dir, file), 'utf8');
const json = (file) => JSON.parse(read(file));
const fail = (message) => { throw new Error(message); };

const ddl = read('001_ai_security_core_schema.sql');
const storage = json('skill-storage-contract.json');
const projection = json('projection-map.json');
const agentSchema = json('agent-process-extension.schema.json');
const reportSchema = JSON.parse(fs.readFileSync(path.join(projectDir, 'ai-security-v1/report-schema.json'), 'utf8'));
const skillText = fs.readFileSync(path.join(projectDir, 'ai-security-v1/SKILL.md'), 'utf8');
const huntingText = fs.readFileSync(path.join(projectDir, 'ai-security-v1/HUNTING.md'), 'utf8');
const validationText = fs.readFileSync(path.join(projectDir, 'ai-security-v1/VALIDATION-AND-REPORTING.md'), 'utf8');
const ledgerValidator = fs.readFileSync(path.join(projectDir, 'ai-security-v1/validate-coverage-ledger.cjs'), 'utf8');
const runtimeContractDir = path.join(projectDir, 'ai-security-v1/references/telemetry');
const runtimeManifest = JSON.parse(fs.readFileSync(path.join(runtimeContractDir, 'contract-manifest.json'), 'utf8'));

for (const file of ['event-envelope.schema.json', 'telemetry-config.schema.json', 'agent-process-extension.schema.json', 'projection-map.json']) {
  if (fs.readFileSync(path.join(runtimeContractDir, file), 'utf8') !== read(file)) fail(`runtime contract copy differs: ${file}`);
}

if (storage.schema_version !== '1.4.0' || storage.database_contract !== '1.3.0-core') fail('storage contract version mismatch');
if (projection.schema_version !== storage.schema_version || projection.database_contract !== storage.database_contract) fail('projection/storage version mismatch');
if (agentSchema.properties.schema_version.const !== storage.schema_version) fail('agent/storage version mismatch');

const tables = new Map();
for (const match of ddl.matchAll(/CREATE TABLE (audit_[a-z_]+) \(\n([\s\S]*?)\n\) ENGINE=/g)) {
  const columns = [];
  for (const line of match[2].split('\n')) {
    const column = line.match(/^  ([a-z][a-z0-9_]*)\s/);
    if (column) columns.push(column[1]);
  }
  tables.set(match[1], columns);
}
if (tables.size !== 36) fail(`expected 36 DDL tables, found ${tables.size}`);
const columnLines = [];
for (const [table, columns] of [...tables.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) for (const column of [...columns].sort()) columnLines.push(`${table}.${column}`);
const columnHash = crypto.createHash('sha256').update(`${columnLines.join('\n')}\n`).digest('hex');
if (runtimeManifest.database_schema_version !== '1.3.0-core' || runtimeManifest.core_table_count !== tables.size || runtimeManifest.database_column_count !== columnLines.length || runtimeManifest.database_columns_sha256 !== columnHash) fail('runtime database schema fingerprint differs from the frozen DDL');

const tableSourceNames = Object.keys(storage.table_sources);
const missingTableSources = [...tables.keys()].filter((table) => !tableSourceNames.includes(table));
const extraTableSources = tableSourceNames.filter((table) => !tables.has(table));
if (missingTableSources.length || extraTableSources.length) fail(`table_sources mismatch; missing=${missingTableSources.join(',')} extra=${extraTableSources.join(',')}`);

const normalizedTargets = new Map();
const snapshotTargets = new Map();
for (const contract of storage.source_contracts) {
  if (!contract.id || !Array.isArray(contract.full_snapshot) || contract.full_snapshot.length === 0) fail(`source contract ${contract.id || '<unknown>'} lacks full_snapshot`);
  for (const target of contract.full_snapshot) {
    if (!snapshotTargets.has(target)) snapshotTargets.set(target, []);
    snapshotTargets.get(target).push(contract.id);
  }
  for (const [sourcePath, targets] of Object.entries(contract.normalized || {})) {
    if (!Array.isArray(targets) || targets.length === 0) fail(`${contract.id}.${sourcePath} has no normalized target`);
    for (const target of targets) {
      if (!normalizedTargets.has(target)) normalizedTargets.set(target, []);
      normalizedTargets.get(target).push(`${contract.id}:${sourcePath}`);
    }
  }
}

function assertTarget(target, kind) {
  const match = target.match(/^(audit_[a-z_]+)\.([a-z][a-z0-9_]*)$/);
  if (!match) fail(`${kind} target is not table.column: ${target}`);
  const columns = tables.get(match[1]);
  if (!columns) fail(`${kind} target references missing table: ${target}`);
  if (!columns.includes(match[2])) fail(`${kind} target references missing column: ${target}`);
}
for (const target of normalizedTargets.keys()) assertTarget(target, 'normalized');
for (const target of snapshotTargets.keys()) assertTarget(target, 'snapshot');

const projectedTables = new Set(projection.events.flatMap((event) => event.tables));
for (const table of tables.keys()) {
  if (table !== 'audit_schema_version' && !projectedTables.has(table)) fail(`table has no projection event: ${table}`);
}

const requiredFieldsMatch = ledgerValidator.match(/const REQUIRED_FIELDS = \[([\s\S]*?)\];/);
if (!requiredFieldsMatch) fail('cannot extract coverage REQUIRED_FIELDS');
const ledgerRequired = [...requiredFieldsMatch[1].matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);
const coverageContract = storage.source_contracts.find((contract) => contract.id === 'coverage_ledger');
if (!coverageContract || JSON.stringify(coverageContract.required_fields) !== JSON.stringify(ledgerRequired)) fail('coverage storage contract differs from validator REQUIRED_FIELDS');

const runContract = storage.source_contracts.find((contract) => contract.id === 'run_metadata');
for (const field of runContract.required_fields) {
  if (!skillText.includes(field)) fail(`run metadata field is not present in Skill: ${field}`);
}
for (const field of ['units', 'candidates', 'hardening', 'uncovered']) {
  if (!huntingText.includes(`"${field}"`)) fail(`hunter result field not found in HUNTING.md: ${field}`);
}
for (const field of ['missing_units', 'reassign_ids', 'resolved_prior_leads', 'stop']) {
  if (!huntingText.includes(`"${field}"`)) fail(`critic result field not found in HUNTING.md: ${field}`);
}
for (const field of ['decision', 'record', 'fingerprint', 'reason']) {
  if (!validationText.includes(`"${field}"`)) fail(`verifier result field not found in VALIDATION-AND-REPORTING.md: ${field}`);
}

const findingsContract = storage.source_contracts.find((contract) => contract.id === 'findings');
if (!findingsContract || !findingsContract.full_snapshot.includes('audit_payload.content_json')) fail('findings must retain the complete validated record JSON');
if (!Array.isArray(reportSchema.items.oneOf) || reportSchema.items.oneOf.length !== 3) fail('report schema must retain exactly three verdict branches');

const technicalColumns = new Set(['schema_version', 'source_class', 'created_at', 'updated_at', 'row_version']);
const relationalColumns = new Set();
for (const match of ddl.matchAll(/FOREIGN KEY \(([^)]+)\)/g)) {
  for (const column of match[1].split(',').map((value) => value.trim())) relationalColumns.add(column);
}
const normalizedColumns = new Set([...normalizedTargets.keys()].map((target) => target.split('.')[1]));
const capabilityRows = [];
for (const [table, columns] of tables) {
  for (const column of columns) {
    const target = `${table}.${column}`;
    let capability;
    if (normalizedTargets.has(target)) capability = `normalized:${normalizedTargets.get(target).join('|')}`;
    else if (snapshotTargets.has(target)) capability = `snapshot:${snapshotTargets.get(target).join('|')}`;
    else if (technicalColumns.has(column)) capability = 'platform_metadata';
    else if (column === 'version' && table === 'audit_schema_version') capability = 'migration_generated';
    else if (/_id$/.test(column) || relationalColumns.has(column)) capability = 'parent_generated_or_relation_resolved';
    else if (/(?:_hash|_sha256|_hmac)$/.test(column)) capability = 'parent_computed_integrity';
    else capability = `event_projection:${storage.table_sources[table].join('|')}`;
    capabilityRows.push({ table, column, capability });
  }
}

const report = [];
report.push('# Skill—数据库字段对齐校验报告');
report.push('');
report.push(`- Contract：\`${storage.schema_version}\` / \`${storage.database_contract}\``);
report.push(`- 数据库表：${tables.size}`);
report.push(`- 数据库字段：${capabilityRows.length}`);
report.push(`- Skill/平台来源契约：${storage.source_contracts.length}`);
report.push(`- 投影事件：${projection.events.length}`);
report.push('- 结论：所有来源契约均有完整脱敏快照能力；所有显式规范化目标均存在；所有数据库表均有生产来源和投影事件。');
report.push('');
report.push('> `event_projection` 表示该列由对应事件的 Parent/Writer 投影产生；它不是让 Agent 直接写数据库。完整原始结构始终先落 `audit_payload`，因此未规范化的 Skill 字段不会丢失。');
report.push('');
report.push('## 来源契约覆盖');
report.push('');
report.push('| 来源契约 | 必需字段/结构 | 完整快照 | 规范化映射组 |');
report.push('| --- | ---: | --- | ---: |');
for (const contract of storage.source_contracts) {
  report.push(`| \`${contract.id}\` | ${(contract.required_fields || []).length || 'schema'} | ${contract.full_snapshot.map((value) => `\`${value}\``).join('<br>')} | ${Object.keys(contract.normalized || {}).length} |`);
}
report.push('');
report.push('## 数据库逐字段能力');
report.push('');
report.push('| 表 | 字段 | 生产能力 |');
report.push('| --- | --- | --- |');
for (const row of capabilityRows) report.push(`| \`${row.table}\` | \`${row.column}\` | ${row.capability} |`);
report.push('');

const reportPath = path.join(dir, 'SKILL-DB-ALIGNMENT-REPORT.md');
if (process.argv.includes('--write-report')) fs.writeFileSync(reportPath, `${report.join('\n')}\n`, 'utf8');

console.log(JSON.stringify({
  status: 'pass',
  contract_version: storage.schema_version,
  tables: tables.size,
  columns: capabilityRows.length,
  source_contracts: storage.source_contracts.length,
  normalized_targets: normalizedTargets.size,
  snapshot_targets: snapshotTargets.size,
  projection_events: projection.events.length,
  report: process.argv.includes('--write-report') ? reportPath : null
}, null, 2));
