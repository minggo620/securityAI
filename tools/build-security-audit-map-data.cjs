#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const base = path.resolve(__dirname, '..');
const skill = '/Users/daitongmin/.codex/skills/security-audit';
const sourcePath = path.join(base, 'security-audit-skill-执行流程与数据字典.md');
const doc = fs.readFileSync(sourcePath, 'utf8');
const tables = []; let current = null, section = '';
const split = l => l.split(/(?<!\\)\|/).slice(1, -1).map(x => x.trim().replaceAll('\\|', '|'));
doc.split(/\r?\n/).forEach((line, i) => {
  if (/^#{1,4} /.test(line)) section = line.replace(/^#+ /, '');
  if (line.startsWith('|')) {
    if (!current) { current = { id: `t${tables.length}`, section, line: i + 1, header: split(line), rows: [] }; tables.push(current); }
    else if (!/^\|\s*:?-+/.test(line)) current.rows.push(split(line));
  } else current = null;
});
const workflow = tables.find(t => t.header[0] === '步骤');
const steps = workflow.rows.map(r => ({ id: r[0].match(/^P\d+\.\d+/)[0], title: r[0].replace(/^P\d+\.\d+ /, ''), stage: Number(r[0].match(/^P(\d+)/)[1]), owner: r[1], input: r[2], action: r[3], output: r[4], condition: r[5], source: r[6] }));
const sources = Object.fromEntries(fs.readdirSync(skill).filter(n => n.endsWith('.md') || n === 'report-schema.json' || /^(validate-findings|validate-coverage-ledger)\.cjs$/.test(n)).map(n => { const text = fs.readFileSync(path.join(skill, n), 'utf8'); return [n, { path: path.join(skill, n), text, sha256: crypto.createHash('sha256').update(text).digest('hex') }]; }));
const schema = JSON.parse(sources['report-schema.json'].text);
const schemaFields = [];
function walk(n, p, verdict) {
  for (const [key, sub] of Object.entries(n.properties || {})) { const q = p ? `${p}.${key}` : key; schemaFields.push({ path: q, verdict, required: (n.required || []).includes(key), type: sub.type || 'branch', enum: sub.enum || (sub.const ? [sub.const] : null), minItems: sub.minItems ?? null, minLength: sub.minLength ?? null, additionalProperties: sub.additionalProperties ?? null }); walk(sub, q, verdict); }
  if (n.items) walk(n.items, p + '[]', verdict);
}
schema.items.oneOf.forEach(branch => walk(branch, '', branch.properties.verdict.const));
const data = { title: 'security-audit 流程驱动思维导图', reviewedDate: '2026-10-14', dictionary: path.basename(sourcePath), dictionarySha256: crypto.createHash('sha256').update(doc).digest('hex'), skillRoot: skill, tables, steps, sources, schemaFields, scope: '本机安装版的规范流程导航；不是一次实际审计日志，不访问 API，不连接 MySQL。' };
const part = process.argv[2];
if (part === 'meta') { const { tables: omittedTables, sources: omittedSources, ...meta } = data; console.log(JSON.stringify(meta)); }
else if (part === 'tables') console.log(JSON.stringify(tables.slice(Number(process.argv[3]), Number(process.argv[4]))));
else if (part === 'source') console.log(JSON.stringify(sources[process.argv[3]]));
else if (part === 'source-names') console.log(JSON.stringify(Object.keys(sources)));
else console.log(JSON.stringify(data));
