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
 ['结构＋分支＋完整路径字段项',S.summary.contractBranchPaths,'数据库设计主口径；同名字段在不同 Agent/返回结构/裁决分支中分别计数，不合并。字段身份必须至少包含 contract_type、branch、path 和版本。'],
 ['结构限定属性路径',S.summary.qualifiedPaths,'仅用于按单一结构浏览：同一结构的多个分支取并集，不是数据库字段总数。跨结构完全不合并。'],
 ['裸名称词法种类',S.summary.lexicalNames,'只用于发现命名碰撞，不能称为字段总数，不能作为数据库去重或字段定义主键。'],
 ['发生词法碰撞的名称',S.summary.lexicalCollisions,'这些名称至少出现在两个完整路径；其中既有同语义传递，也有 decision/reason/kind/score 等明确同名异义。必须逐路径解释。'],
 ['去掉结构名前缀的路径去重',S.summary.relativePaths,'辅助指标：相同路径字符串只计一次，但可能掩盖不同结构中的不同职责，不作主统计。'],
 ['顶层字段出现数（分支并集）',S.summary.topLevelOccurrences,'各结构顶层键并集的合计。不是全局唯一顶层键数。'],
 ['两个校验器明确检查的路径集合',S.summary.machineCheckedPaths,'ledger 47＋findings 46；不意味着对其余 wrapper 或原始 Agent 返回有独立专用 schema 校验。'],
 ['未命名的 metadata 必记信息',3,'selected companion files、prior-run paths、shared-file owners；有记录要求，没有固定 JSON 键名，不计入原有字段总数。'],
 ['侦察/架构信息概念行',S.recon.conceptRows,'第 7 节的概念分类，不是原文定义的 16 个 JSON 属性。四个 Recon 无固定 JSON 字段总数，不能把这种未定义写成实际输出 0 个字段。'],
 ['建议新增的属性路径出现数 X',S.proposalSummary.occurrences,'第 16.1–16.3：70；第 7 节建议侦察键：18；第 6 节建议命名：3。与原有 282 分开，不相加。'],
 ['建议新增裸名称种类 X',S.proposalSummary.uniqueNames,'仅作命名碰撞诊断；run_id、invariant、status 与原有名称重叠，但新增记录位置/用途不等于原 skill 已实现，也不能按名称合并。']
 ]));
write('**计数规则：**数据库主身份使用 `contract_type + branch + full_path + schema_version`。这应实现为复合列/复合唯一约束；文档中的 `fieldKey` 只是可读身份，不建议把带分隔符的字符串直接当数据库唯一真相。容器键（例如 `checks`）与对象成员键（例如 `checks[].method`）分别计数；数组索引和数组实例数量不计数。状态值、攻击类别、事件类型值、方法码值、Markdown 标题、schema 的 `properties/required/type` 等关键字，以及校验器内部 `LIMITS` 配置键都不属于审计数据字段。SKILL.md 的 YAML 安装元信息 `name/description` 两键单独视为配置，未混入执行字段总数。\n\n**严禁按裸名称去重：**`decision` 在 Phase 3 表示漏洞裁决、在 Phase 5 表示记录复核动作；`kind` 在 trace 与 condition 中使用不同枚举；`reason`、`score`、`description`、`agent_id` 等也必须按完整上下文区分。85 仅是词法名称种类，58 是发生重复的名称数，二者都不是数据库字段数量。\n\n**没有固定字段全集的部分：**Recon 返回、architecture.md、三份人类报告、工具 stdout/stderr 均没有统一 JSON 字段契约。它们的信息要求不能机械转成原有属性数量。ledger 还允许额外 bookkeeping，47 只表示明确规定的字段路径，而不是所有可能合法属性的上限。\n\n**必填/条件/可选：**本附录同时提供“结构路径并集视图”和“具体分支绑定”。必填指该字段的父对象/数组元素存在时必须有该键，不表示每次运行必须生成数组元素；条件包括特定裁决/返回分支、配对 lifecycle、validation_plan 至少一项。可选父对象的子成员仍可在父对象存在时必填，例如 remediation.code_changes 可选、每个改动项的 file_name/fixed_code 必填。并集视图的可选数为 0 不表示具体分支没有可选字段，需看 E.3/E.5。字段值可以是 null 或空数组时，键仍可能必填。');
write('### E.2 各结构的字段数量（分支并集）\n');
write(table(['结构','分支字段项','结构路径并集','顶层键并集','父对象内必填（合并视图）','条件/分支限定','定义来源'],S.structures.map(s=>[s.title,s.branches.reduce((n,b)=>n+b.count,0),s.count,s.top,s.required,s.conditional,s.level])));
write(S.structures.map(s=>'- '+tick(s.title)+'：'+s.notes).join('\n'));
write('### E.3 具体分支内的必填、条件与可选\n');
write(table(['结构','分支','顶层键','全部路径','父对象内必填','条件','可选'],S.structures.flatMap(s=>s.branches.map(b=>[s.title,b.name,b.top,b.count,b.required,b.conditional,b.optional]))));
write('本表逐分支计数；共有路径在不同分支中分别保留，因此各分支相加得到 416 个契约绑定项。`validation_plan.local/deployment` 没有分别被 schema required，但 validator 要求至少一个适用且非空，因此归为条件。`remediation.code_changes` 是 confirmed 分支唯一可选路径；嵌套的 file_name/fixed_code 在每个改动对象存在时必填。');
write('### E.4 裸名称碰撞索引（禁止据此合并）\n');
write('下表只用于发现同名风险。路径出现次数不等于同一语义次数；数据库不得以裸 `field_name` 为唯一键。完整路径与分支语义以 E.5 为准。\n');
write(table(['裸字段名','完整路径出现次数','涉及结构'],S.duplicates.map(d=>[tick(d.name),d.occurrences,d.structures.join('；')])));
write('#### E.4.1 高风险同名字段的语义分离规则\n');
write(table(['裸名称','必须分开的上下文','语义差异','数据库处理'],[
 ['decision','Phase 3 verifier / Phase 5 verifier','候选最终裁决 vs 最终记录复核动作','使用 decision_domain＋decision_value；分别约束枚举。'],
 ['reason','排除块、coverage gap、rejected、likelihood、impact、confidence、Phase 5 replace','适用性排除、覆盖依据、反驳理由、评分依据、替换原因完全不同','按 reason_type 和 owner_object 外键分表/分域。'],
 ['kind','trace[].kind / conditions[].kind','路径节点角色 vs 漏洞成立前提类型','使用 trace_node_kind 与 condition_kind 两个枚举域。'],
 ['score','severity.likelihood、severity.impact、confidence','可能性、影响、证据确定性；枚举集合和解释不同','分列/分表并保存 scoring_scale_version。'],
 ['description','record、trace、evidence、condition','整体主张、路径操作、证据事实、成立条件','依附各自实体，不建立通用 description 事实表。'],
 ['agent_id','coverage unit、attempt、check','当前分配 owner、历史 owner、证据作者','使用 assignment_owner_id、attempt_owner_id、check_author_id 外键角色。'],
 ['reviewed_paths','unit、attempt、check、Hunter 返回','路径并集、历史快照、单次作者所有路径、原始返回','规范化为 check_path；聚合路径由查询/受控快照产生。'],
 ['surface/boundary/subsystem/attack_class','display label、canonical_refs、Hunter uncovered、critic missing_units','人类标签、稳定身份、待接受建议','proposal 与 accepted unit 分表；canonical_ref 不用显示文本替代。'],
 ['status','live unit / attempts[]','当前状态 vs 历史尝试终态','当前快照与 append-only attempt/event 分离。'],
 ['selected_companion_blocks/excluded_blocks','critic missing unit / ledger','critic 建议 vs Parent 接受后的正式任务映射','保留 suggestion、decision、accepted mapping 三层。'],
 ['fingerprint/verdict','Hunter candidate、Phase 3 record、findings、Phase 5','同一根因身份/裁决在不同证据成熟度下传递','保留版本与来源事件；不得用后态覆盖前态。']
 ]));
write('### E.5 七类结构的逐分支字段绑定清单\n\n这里不做跨分支合并：每行都是 `contract_type + branch + full_path + schema_version` 可识别的一项。来源链接定位到该字段在具体 schema 分支或 JSON 模板中的实际定义位置；完整类型与用途仍见正文第 6、8、10、11、12 节。');
S.structures.forEach((s,i)=>{
 const bindings=s.branches.flatMap(b=>b.fields.map(f=>({...f,branch:b.name})));
 write(`#### E.5.${i+1} ${s.title}\n\n${s.level}；${bindings.length} 个逐分支字段绑定；同一结构跨分支合并后为 ${s.count} 条路径。${s.notes}\n`);
 write(table(['字段身份键','契约分支','完整字段路径','分支内要求','语义角色','精确定义位置'],bindings.map(f=>[tick(f.fieldKey),f.branch,tick(f.path),f.status,f.semanticRole,ref(f.source)])));
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
