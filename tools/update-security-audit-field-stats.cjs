#!/usr/bin/env node
'use strict';
// Rebuild the new appendix and the main HTML snapshot. All edits use apply_patch.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),docFile=path.join(root,'security-audit-skill-执行流程与数据字典.md'),htmlFile=path.join(root,'security-audit-skill-交互流程导图.html');
const run=(file,args=[])=>cp.execFileSync(process.execPath,[path.join(__dirname,file),...args],{encoding:'utf8',maxBuffer:8*1024*1024});
const S=JSON.parse(run('security-audit-field-stats.cjs'));
const escape=s=>String(s).replaceAll('|','\\|').replaceAll('\n',' ');
const table=(head,rows)=>['| '+head.join(' | ')+' |','| '+head.map(()=> '---').join(' | ')+' |',...rows.map(r=>'| '+r.map(escape).join(' | ')+' |')].join('\n');
const tick=s=>'`'+s+'`';
const ref=f=>`[${f.file}:${f.line}](/Users/daitongmin/.codex/skills/security-audit/${f.file}:${f.line})`;
const content=[];const write=s=>content.push(s);
write('<!-- FIELD-STATS:START -->\n## 附录 E. 整个 skill 的字段统计总览\n\n本附录由只读统计脚本依据当前本机原 skill 的 schema、脚本与 Markdown 返回模板生成；统计的是**定义**，不是某次运行实际生成的字段。原 skill 文件未修改。入口：HTML 的“整个 skill 字段统计”。');
write('### E.1 范围与计数口径\n');
write(table(['口径','数量','含义与边界'],[
 ['执行数据结构',S.summary.structures,'metadata、ledger、Hunter、critic、Phase 3、findings、Phase 5，共 7 类。'],
 ['结构限定属性路径出现数',S.summary.qualifiedPaths,'主统计：结构名＋完整路径。同一字段被不同结构携带，分别计次；同一结构的多个裁决分支先取并集。不是 282 个互不重复的字段名，也不是一次运行固定写入 282 项。'],
 ['字段名称跨结构去重',S.summary.globalNames,'只比较属性名；例如 fingerprint、record.fingerprint、candidates[].fingerprint 归为同一名称。名称相同不代表语义或约束相同。'],
 ['去掉结构名前缀的路径去重',S.summary.relativePaths,'辅助指标：相同路径字符串只计一次，但可能掩盖不同结构中的不同职责，不作主统计。'],
 ['顶层字段出现数（分支并集）',S.summary.topLevelOccurrences,'各结构顶层键并集的合计。不是全局唯一顶层键数。'],
 ['两个校验器明确检查的路径集合',S.summary.machineCheckedPaths,'ledger 47＋findings 46；不意味着对其余 wrapper 或原始 Agent 返回有独立专用 schema 校验。'],
 ['未命名的 metadata 必记信息',3,'selected companion files、prior-run paths、shared-file owners；有记录要求，没有固定 JSON 键名，不计入原有字段总数。'],
 ['侦察/架构信息概念行',S.recon.conceptRows,'第 7 节的概念分类，不是原文定义的 16 个 JSON 属性。四个 Recon 无固定 JSON 字段总数，不能把这种未定义写成实际输出 0 个字段。'],
 ['建议新增的属性路径出现数 X',S.proposalSummary.occurrences,'第 16.1–16.3：70；第 7 节建议侦察键：18；第 6 节建议命名：3。与原有 282 分开，不相加。'],
 ['建议新增名称去重 X',S.proposalSummary.uniqueNames,'91 项含 statement 的两种路径；run_id、invariant、status 与原有名称重叠，但新增记录位置/用途不等于原 skill 已实现。']
 ]));
write('**计数规则：**容器键（例如 `checks`）与对象成员键（例如 `checks[].method`）分别计数；数组索引和数组实例数量不计数。状态值、攻击类别、事件类型值、方法码值、Markdown 标题、schema 的 `properties/required/type` 等关键字，以及校验器内部 `LIMITS` 配置键都不属于审计数据字段。SKILL.md 的 YAML 安装元信息 `name/description` 两键单独视为配置，未混入执行字段总数。\n\n**没有固定字段全集的部分：**Recon 返回、architecture.md、三份人类报告、工具 stdout/stderr 均没有统一 JSON 字段契约。它们的信息要求不能机械转成原有属性数量。ledger 还允许额外 bookkeeping，47 只表示明确规定的字段路径，而不是所有可能合法属性的上限。\n\n**必填/条件/可选：**本附录分为“跨分支合并分类”和“具体分支内分类”。必填指该字段的父对象/数组元素存在时必须有该键，不表示每次运行必须生成数组元素；条件包括特定裁决/返回分支、配对 lifecycle、validation_plan 至少一项。可选父对象的子成员仍可在父对象存在时必填，例如 remediation.code_changes 可选、每个改动项的 file_name/fixed_code 必填。合并表的可选数为 0 不表示具体分支没有可选字段，需看 E.3。字段值可以是 null 或空数组时，键仍可能必填。');
write('### E.2 各结构的字段数量（分支并集）\n');
write(table(['结构','顶层键','全部路径','父对象内必填（共用）','条件/分支限定','共用可选','名称去重','定义来源'],S.structures.map(s=>[s.title,s.top,s.count,s.required,s.conditional,s.optional,s.names,s.level])));
write(S.structures.map(s=>'- '+tick(s.title)+'：'+s.notes).join('\n'));
write('### E.3 具体分支内的必填、条件与可选\n');
write(table(['结构','分支','顶层键','全部路径','父对象内必填','条件','可选'],S.structures.flatMap(s=>s.branches.map(b=>[s.title,b.name,b.top,b.count,b.required,b.conditional,b.optional]))));
write('这里不把多个分支的数量相加成为结构总数；共有路径会重复。`validation_plan.local/deployment` 没有分别被 schema required，但 validator 要求至少一个适用且非空，因此归为条件。`remediation.code_changes` 是 confirmed 分支唯一可选路径；嵌套的 file_name/fixed_code 在每个改动对象存在时必填。');
write('### E.4 同名字段的重复位置\n');
write(table(['字段名','路径出现次数','出现结构'],S.duplicates.map(d=>[tick(d.name),d.occurrences,d.structures.join('；')])));
write('完整的 '+S.summary.globalNames+' 个去重名称：\n\n'+S.globalNames.map(tick).join('、')+'。');
write('### E.5 七类结构的逐字段清单\n\n每个表仅统计一类结构。来源链接指向定义文件；完整语义、类型与用途仍见正文第 6、8、10、11、12 节。已展开候选和 record 内全部 schema 字段，不使用“其他字段”占位来计数。');
S.structures.forEach((s,i)=>{
 write(`#### E.5.${i+1} ${s.title}\n\n${s.level}；共 ${s.count} 个属性路径，${s.top} 个顶层键。${s.notes}\n`);
 write(table(['字段路径','合并分类','具体分支内要求','定义依据'],s.fields.map(f=>[tick(f.path),f.status,f.branches.map(b=>b.branch+':'+b.status).join('；'),ref(f.source)])));
});
write('### E.6 建议新增 X 的统计（不属于原有字段）\n');
write(table(['建议结构','路径数','属性路径清单'],[...S.proposed.map(p=>[p.section,p.count,p.paths.map(tick).join('、')]),['第 7 节建议侦察键',S.recon.suggestedKeys.length,S.recon.suggestedKeys.map(tick).join('、')],['第 6 节非固定名称的命名建议',3,['selected_companion_files','prior_run_paths','shared_file_owners'].map(tick).join('、')]]));
write('本表仅对已有建议列表计数，没有实施这些扩展；也未声称这是所有可能扩展的全集。第 16.4 节是事件类型目录，不是额外字段表；`estimated_support` 是未来可选研究举例，未纳入上述正式建议表的 91 项。平台可观测 O 信息没有平台固定契约，不能给出跨平台统一字段总数。');
write('### E.7 可复核方式\n\n执行 `node tools/security-audit-field-stats.cjs summary` 重新核对数量；不加 summary 则输出完整结构与路径 JSON。schema 和 JSON 模板自动遍历；metadata 固定键、ledger 生命周期配对/历史尝试/检查对象组合按原文及脚本规则显式映射，并非宣称任意自然语言定义均可自动解析。统计以附录 A 的本机文件指纹为基线；原 skill 更新后需要重新生成本附录和 HTML 内嵌快照。两份文档使用同一统计对象。\n\n<!-- FIELD-STATS:END -->');
const appendix=content.join('\n\n')+'\n';
function patch(file,before,after){if(before===after)return;const payload='*** Begin Patch\n*** Update File: '+file+'\n@@\n'+before.split('\n').map(l=>'-'+l).join('\n')+'\n'+after.split('\n').map(l=>'+'+l).join('\n')+'\n*** End Patch\n';const r=cp.spawnSync('apply_patch',[],{input:payload,encoding:'utf8',maxBuffer:1024*1024});assert.equal(r.status,0,r.stderr);console.log(r.stdout.trim());}
const doc=fs.readFileSync(docFile,'utf8'),match=doc.match(/<!-- FIELD-STATS:START -->[\s\S]*?<!-- FIELD-STATS:END -->\n?/);
if(match)patch(docFile,match[0].trimEnd(),appendix.trimEnd());else{const last=doc.trimEnd().split('\n').at(-1);patch(docFile,last,last+'\n\n'+appendix.trimEnd())}
const html=fs.readFileSync(htmlFile,'utf8'),snapshot=JSON.parse(run('build-security-audit-map-data.cjs'));snapshot.fieldStats=S;
const old=html.match(/<script type="application\/json" id="map-data">[\s\S]*?<\/script>/)[0],replacement='<script type="application/json" id="map-data">'+JSON.stringify(snapshot).replaceAll('<','\\u003c')+'</script>';
patch(htmlFile,old,replacement);console.log(JSON.stringify(S.summary));
