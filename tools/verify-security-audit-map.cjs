#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const workspace = path.resolve(__dirname, '..');
const skill = '/Users/daitongmin/.codex/skills/security-audit';
const docPath = path.join(workspace, 'security-audit-skill-执行流程与数据字典.md');
const doc = fs.readFileSync(docPath, 'utf8');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const cells = line => line.split(/(?<!\\)\|/).slice(1, -1).map(s => s.trim());
const checks = [];
function check(name, fn) { try { const value = fn(); checks.push({ name, passed: true, detail: value ?? null }); } catch (e) { checks.push({ name, passed: false, detail: e.message }); } }
function tables(text) {
  const output = []; let current = null, section = '';
  text.split(/\r?\n/).forEach((line, i) => {
    if (/^#{1,4} /.test(line)) section = line.replace(/^#+ /, '');
    if (line.startsWith('|')) {
      if (!current) { current = { section, line: i + 1, header: cells(line), rows: [] }; output.push(current); }
      else if (!/^\|\s*:?-+/.test(line)) current.rows.push(cells(line));
    } else current = null;
  });
  return output;
}
const parsed = tables(doc);
const schema = JSON.parse(fs.readFileSync(path.join(skill, 'report-schema.json'), 'utf8'));
const ledgerSource = fs.readFileSync(path.join(skill, 'validate-coverage-ledger.cjs'), 'utf8');
const findingsValidator = require(path.join(skill, 'validate-findings.cjs'));
const ledgerValidator = require(path.join(skill, 'validate-coverage-ledger.cjs'));
function literals(name) { const m = ledgerSource.match(new RegExp(`const ${name} = (?:new Set\\()?\\[([\\s\\S]*?)\\]`)); assert(m, name); return [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]); }
const fieldPaths = new Set();
function walk(node, prefix = '') {
  for (const [key, child] of Object.entries(node.properties || {})) { const p = prefix ? `${prefix}.${key}` : key; fieldPaths.add(p); walk(child, p); }
  if (node.items) walk(node.items, `${prefix}[]`);
  if (node.oneOf) node.oneOf.forEach(n => walk(n, prefix));
}
walk(schema.items);
check('Markdown 表格列数一致', () => { parsed.forEach(t => t.rows.forEach(r => assert.equal(r.length, t.header.length, `line ${t.line}: ${t.section}`))); return parsed.length; });
check('findings 的全部字段路径覆盖', () => { [...fieldPaths].forEach(p => assert(doc.includes('`' + p + '`'), p)); return fieldPaths.size; });
check('ledger 的全部必需字段覆盖', () => { const keys = literals('REQUIRED_FIELDS'); keys.forEach(p => assert(doc.includes('`' + p + '`'), p)); return keys.length; });
check('coverage/attempt/prior 状态覆盖', () => { const groups = ['STATUSES', 'ATTEMPT_STATUSES', 'PRIOR_STATUSES']; return Object.fromEntries(groups.map(g => { const values = literals(g); values.forEach(v => assert(doc.includes('`' + v + '`'), v)); return [g, values.length]; })); });
check('三种 verdict 必需/禁止字段矩阵', () => {
  const table = parsed.find(t => t.section.startsWith('11.1 ')); assert(table);
  const columns = ['confirmed', 'needs_validation', 'rejected'];
  for (const branch of schema.items.oneOf) {
    const col = columns.indexOf(branch.properties.verdict.const) + 1;
    table.rows.forEach(row => { const key = row[0].replaceAll('`', ''); const state = row[col];
      if (branch.required.includes(key)) assert(state.startsWith('必需'), `${branch.properties.verdict.const}.${key}`);
      else if (!(key in branch.properties)) assert.equal(state, '禁止', `${branch.properties.verdict.const}.${key}`);
    });
    Object.keys(branch.properties).forEach(key => assert(table.rows.some(r => r[0] === '`' + key + '`'), key));
  }
  return { branches: 3, rows: table.rows.length };
});
check('20 个来源文件版本一致', () => {
  let count = 0; for (const [, file, digest] of doc.matchAll(/^\| `([^`]+)` \| `([a-f0-9]{64})` \|$/gm)) { assert.equal(hash(fs.readFileSync(path.join(skill, file))), digest, file); count++; }
  assert.equal(count, 20); return count;
});
check('来源链接文件和行号有效', () => { let count = 0; for (const [, target] of doc.matchAll(/\]\((\/[^\n)]+)\)/g)) { const [, file, line] = target.match(/^(.*?)(?::(\d+))?$/); assert(fs.existsSync(file), file); if (line) assert(Number(line) <= fs.readFileSync(file, 'utf8').split(/\r?\n/).length, target); count++; } return count; });
check('162 类双语索引与原文一致', () => {
  const groups = parsed.filter(t => t.header[0] === '类别原名'); assert.equal(groups.length, 11); let count = 0;
  groups.forEach(t => t.rows.forEach(r => {
    assert.equal(r.length, 5); assert(/[\u4e00-\u9fff]/.test(r[1])); assert(/[\u4e00-\u9fff]/.test(r[3]));
    const [, file, line] = r[4].match(/\]\((.*?):(\d+)\)/); const src = fs.readFileSync(file, 'utf8').split(/\r?\n/); const i = Number(line) - 1;
    assert.equal(src[i].match(/^\*\*(.+?)\*\*/)[1], r[0]); let j = i + 1; while (j < src.length && !src[j].trim()) j++;
    const content = src[j] || '', first = content.match(/^.*?[.!?](?:\s|$)/); let cue = first ? first[0].trim() : content;
    if (cue.length > 220) cue = cue.slice(0, 220) + '…'; assert.equal(cue.replaceAll('|', '\\|'), r[2]); count++;
  })); assert.equal(count, 162); return count;
});
const reference = { file: 'not-present/fixture.c', line: 999999, description: 'Synthetic reference for a format-only test.' };
const record = { verdict: 'confirmed', fingerprint: 'synthetic:format-only', title: 'Synthetic fixture', description: 'Not a real vulnerability.', root_cause: 'Synthetic claim.', intended_behavior: 'Synthetic invariant.', trace: [{ kind: 'sink', ...reference, scope: 'not_a_real_function' }], evidence: [reference], conditions: [], execution: { attacker_perspective: 'Dummy actor', payloads: [''], instructions: ['Synthetic instruction, not executed.'], observed_result: 'Synthetic text, not an actual runtime result.' }, remediation: { strategy: 'Synthetic recommendation.' }, severity: { likelihood: { score: 'low', reason: 'Synthetic.' }, impact: { score: 'low', reason: 'Synthetic.' }, overall_severity: 'low' }, confidence: { score: 'low', reason: 'Synthetic.' } };
check('机械校验不核对文件存在或观察真实性', () => { assert.deepEqual(findingsValidator.validateDocument([record], schema), []); return '不存在的路径/超大行号/虚构观察文字仍可符合格式：不得将 PASS 当漏洞证明。'; });
check('禁止把扩展假设字段塞入 finding', () => { assert(findingsValidator.validateDocument([{ ...record, hypothesis_id: 'x' }], schema).some(e => e.includes('hypothesis_id'))); return true; });
check('needs_validation 必须有适用计划文本', () => { const r = { verdict: 'needs_validation', fingerprint: 'synthetic:blocked', title: 'Synthetic', description: 'Synthetic', claimed_root_cause: 'Synthetic', trace: record.trace, evidence: record.evidence, blockers: ['Synthetic'], validation_plan: {} }; assert(findingsValidator.validateDocument([r], schema).some(e => e.includes('validation_plan'))); return true; });
check('overall 不得超过 impact', () => { const r = structuredClone(record); r.severity.overall_severity = 'critical'; assert(findingsValidator.validateDocument([r], schema).some(e => e.includes('cannot exceed'))); return true; });
const refs = { surface: 'not-present/fixture.c#input', boundary: 'not-present/fixture.c#gate', subsystem: 'fixture', attack_class: 'NOT-PRESENT.md#Nonexistent block' };
const unit = { coverage_id: ledgerValidator.canonicalCoverageId(refs), canonical_refs: refs, surface: 'Synthetic surface', boundary: 'Synthetic boundary', subsystem: 'Synthetic subsystem', attack_class: 'Synthetic class', starting_paths: ['not-present/fixture.c'], ordinary_attack_class_block: 'NOT-PRESENT.md#Nonexistent block', selected_companion_blocks: [], excluded_blocks: [], prior_status: 'none', attempts: [], wave: 1, status: 'candidate', agent_id: 'dummy-hunter', reviewed_paths: ['not-present/fixture.c'], local_checks: [{ agent_id: 'dummy-hunter', reviewed_paths: ['not-present/fixture.c'], invariant: 'Synthetic invariant', method: 'local', result: 'Synthetic result', artifact: 'agents/dummy-hunter/artifacts/not-present.txt' }], result_fingerprints: ['synthetic:orphan'], unresolved: [] };
check('ledger 不核对 block/artifact 存在和跨文件外键', () => { assert.deepEqual(ledgerValidator.validateDocument([unit]), []); assert.deepEqual(findingsValidator.validateDocument([], schema), []); return '单文件校验可以分别通过；联合候选裁决仍需另核对。'; });
check('method 仅 source/local', () => { const u = structuredClone(unit); u.local_checks[0].method = 'taint'; assert(ledgerValidator.validateDocument([u]).some(e => e.includes('method'))); return true; });
const processTable = parsed.find(t => t.header[0] === '步骤');
const summary = { baseline: '2026-10-14 本机安装文件；不是 GitHub 最新版本声明', dictionary_sha256: hash(doc), process_steps: processTable.rows.length, existing_finding_field_paths: fieldPaths.size, required_ledger_fields: literals('REQUIRED_FIELDS').length, attack_classes: 162, checks, passed: checks.every(c => c.passed), caveat: '这些静态核对和合成格式测试不证明任意目标的漏洞、实际执行记录或规范的形式完备性。' };
console.log(JSON.stringify(summary, null, 2));
if (!summary.passed) process.exitCode = 1;
module.exports = { tables };
