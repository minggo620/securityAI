# ai-security-v1 审计过程数据库逻辑模型

> 状态：架构复核修订版；**尚未在远程数据库执行**。  
> 分析对象：`./ai-security-v1/`。  
> Skill 基线清单 SHA-256：`bac04717601a140814c5963b6277c1d3ab8df6225184c0c49a8a4721103effa0`（算法见第 12 节）。  
> 目标环境：MySQL 8.0.26，数据库 `ai_security`，新对象统一使用 `audit_` 前缀；不修改现有 `test` 表。  
> Schema 版本：`1.2.0-core-draft`。

## 0. 架构复核结论与第一版收敛范围

原 `1.1.0-draft` 将运行状态库、事件存储、规范化业务投影、Writer 分布式协调和研究分析仓库一次性建成 49 张表、675 个字段、123 个外键。它可以作为长期概念目录，但不适合作为第一版直接部署：一个业务事件需要同步维护 payload、event、字段 provenance、专用投影和远程 checkpoint，故障组合会反向威胁 P1–P6 的稳定执行。

`1.2.0-core-draft` 采用“核心事实库 + 可重放事件 + 后置研究分析”的边界：

- 第一版核心模型实现 35 张事务表；保留假设版本、验证前评分、攻击计划/执行、候选观察、独立验证、Finding 修订和人工标注。
- 派生指标不进入审计事务；通过带版本的离线查询或研究数据集重算。
- 单 Parent/单 Writer 使用本地排他锁，不建设数据库租约和 fencing 系统。
- Outbox checkpoint 与 dead-letter 仅保存在 Parent 独占的本地 telemetry 目录；MySQL 以 `audit_event` 幂等键证明已提交事件。
- 事件 source refs 作为受验证的 JSON 保存在事件信封/`audit_event`；只对预测、裁决、严重性和人工标签等关键字段保留显式来源，不建设任意 `object_type/object_id` 的通用字段级 provenance 表。
- architecture 保留版本化快照，surface/trust boundary 作为快照内受 schema 约束的数组；实际查询证明有必要后再物化。
- Critic 由 `audit_agent_task + audit_payload + audit_event + audit_coverage_attempt` 表达；不建设 Critic 专用双表。
- validator 是一种 `audit_tool_execution`；报告和核心 JSON/Markdown 是 `audit_artifact`；不重复建设 validator/report 专表。

第一版移出的 15 张表为：

```text
audit_telemetry_consent
audit_run_relation
audit_writer_lease
audit_event_source_ref
audit_source_provenance
audit_outbox_checkpoint
audit_ingest_failure
audit_surface
audit_trust_boundary
audit_coverage_block
audit_critic_review
audit_critic_item
audit_validator_run
audit_report
audit_metric_value
```

这些需求分别由 run 初始化 payload、event source refs、本地 checkpoint/dead-letter、architecture snapshot、coverage JSON、Agent task/tool/artifact 和后置分析任务承担。只有出现可量化的查询、并发或性能需求后，才允许通过 expand migration 物化专表。

第一版 35 张核心表清单：

| 域 | 核心表 |
| --- | --- |
| 运行与事件 | `audit_schema_version`、`audit_run`、`audit_run_scope`、`audit_payload`、`audit_phase_execution`、`audit_event` |
| Agent 与证据 | `audit_agent_task`、`audit_tool_execution`、`audit_artifact`、`audit_evidence` |
| 侦察与覆盖 | `audit_recon_fact`、`audit_architecture_snapshot`、`audit_coverage_unit`、`audit_coverage_attempt`、`audit_check` |
| 假设与攻击 | `audit_hypothesis`、`audit_hypothesis_version`、`audit_hypothesis_relation`、`audit_hypothesis_evidence`、`audit_hypothesis_score`、`audit_attack_plan`、`audit_attack_step`、`audit_attack_execution` |
| 候选与验证 | `audit_candidate_observation`、`audit_candidate`、`audit_candidate_hypothesis`、`audit_candidate_coverage`、`audit_validation`、`audit_validation_observation`、`audit_decision` |
| Finding 与外部标签 | `audit_finding`、`audit_finding_revision`、`audit_finding_evidence`、`audit_finding_coverage`、`audit_human_adjudication` |

修订字段契约：

| 对象 | 必需修订 |
| --- | --- |
| `audit_run` | 增加 `telemetry_mode`、`telemetry_failure_policy`、`telemetry_local_status`、`telemetry_remote_status`；移除含义重叠的布尔开关 |
| `audit_event` | 增加受 schema 约束的 `source_refs_json`；只保留 event/idempotency 双唯一和因果链 |
| `audit_artifact` | `owner_task_id` 可空以支持 Parent 产物；增加 `artifact_kind`、`version_no`、`status`，统一报告、核心 JSON/Markdown 和验证器输入输出 |
| `audit_architecture_snapshot` | payload 内必须含 surfaces、trust boundaries 及每项来源，替代两个专表 |
| `audit_coverage_unit` | 增加 selected/excluded blocks JSON，替代 `audit_coverage_block` |
| `audit_hypothesis` | 删除单一 `related_hypothesis_id/relation_kind` |
| `audit_hypothesis_relation` | `from_hypothesis_id`、`to_hypothesis_id`、`relation_kind`、`event_id`；支持 merge/split 多对多 |
| `audit_candidate_observation` | 增加 `run_id`，`candidate_id` 可空；先保存 observation，合并后再关联 candidate |
| `audit_validation` | 增加 `input_hypothesis_version_id`、`input_finding_revision_id`、`input_sha256`；P3/P5 按 validation kind 校验输入 |
| `audit_human_adjudication` | 增加 `subject_type`、`label_scheme`；hypothesis 使用 match 标签，candidate/finding 使用 validity 标签 |

后置研究指标必须从冻结的事实生成独立、带公式版本的数据集。首次假设准确率和概率校准使用 version 1 的首次验证前 score；最终修订质量使用 final version，二者不得混用。

本次复核同时锁定以下正确性修正：

1. `audit_run` 必须记录 `telemetry_mode=off|local|remote` 和 `telemetry_failure_policy=best_effort|required`。
2. `audit_candidate_observation` 先于 Parent consolidation 创建，`candidate_id` 必须可空，并在合并后补充。
3. P5 validation 必须绑定明确的 `input_finding_revision_id` 和输入哈希，不能只关联 candidate。
4. 假设 merge/split 使用多对多 `audit_hypothesis_relation`，不使用单个 self-reference。
5. 人工标签按 subject type 使用不同 label scheme，禁止把 `wrong_hypothesis` 用作 Finding 标签。
6. 概率校准读取冻结的验证前 score，不得通过 current/latest 视图回填最终信息。
7. 默认 `best_effort` 下本地 Outbox 故障只使 telemetry incomplete；只有显式 `required` 才停止启动新 Agent。

## 1. 目的、边界与信息分类

本模型用于记录一次完整安全审计如何从任务启动，经侦察、覆盖规划、漏洞假设、攻击计划、受限验证、独立反驳和最终复核形成结果。它不是目标业务数据库，也不是漏洞扫描器；数据库中的记录不能替代源码证据和独立验证。

| 标记 | 含义 | 示例 |
| --- | --- | --- |
| `S` | 当前 Skill 已明确规定的结构或动作 | `coverage-ledger.json`、Finding 三种裁决 |
| `O` | 平台可观察、但当前 Skill 没有统一契约 | Agent 启停、工具退出码、实际提示词 |
| `P` | 本方案拟新增的过程采集机制 | 假设版本、验证前概率、Outbox 事件 |
| `D` | 从原始记录计算的派生数据 | 命中率、Brier Score、平均验证成本 |

禁止采集隐藏思维链。所谓“分析思路”仅指 Agent 明确输出的结构化主张、证据、反例、决策理由和实际动作。禁止保存凭据、认证状态、完整环境变量、无关源码和未经脱敏的工具输出。

当前 Skill 明确规定数据库模式与审计模式分离（`SKILL.md:10-18`）。因此，**完整审计只默认允许在审计输出目录内建立本地 Outbox，不默认授权连接或同步到远程 MySQL**。远程同步必须由用户单独明示授权，或由可审计的组织政策授权，并记录授权范围、目的、保留策略和撤回状态。

## 2. 总体模型

本节拓扑保留长期概念关系，包含第 0 节明确延期的物化表；第一版实施范围必须以第 0 节的 35 表清单为准。延期对象在核心版本中由 event/payload/artifact 或本地 telemetry 文件承担。

```text
audit_run
  ├─ audit_telemetry_consent / audit_run_relation
  ├─ audit_writer_lease
  ├─ audit_phase_execution ─ audit_agent_task ─ audit_tool_execution
  ├─ audit_recon_fact ─ audit_surface / audit_trust_boundary
  ├─ audit_coverage_unit ─ audit_coverage_attempt ─ audit_check
  ├─ audit_hypothesis ─ audit_hypothesis_version ─ audit_hypothesis_score
  │                         └─ audit_attack_plan ─ audit_attack_step
  │                                                └─ audit_attack_execution
  ├─ audit_candidate ─ audit_candidate_observation
  │                    ├─ audit_candidate_hypothesis
  │                    └─ audit_candidate_coverage
  │                    └─ audit_validation ─ audit_decision
  ├─ audit_critic_review ─ audit_critic_item
  ├─ audit_finding ─ audit_finding_revision ─ audit_finding_evidence
  ├─ audit_validator_run / audit_report / audit_metric_value
  └─ audit_event ─ audit_event_source_ref / audit_payload
                   ├─ audit_source_provenance
                   ├─ audit_outbox_checkpoint
                   └─ audit_ingest_failure
```

数据库同时保存三层信息：

1. **不可变事实层**：`audit_event`、版本、attempt、revision、原始脱敏 payload。
2. **当前投影层**：run、task、coverage、hypothesis、candidate、finding 的当前状态。
3. **派生分析层**：指标和人工 adjudication；可重新计算，不覆盖原始事实。

## 3. 通用数据约束

### 3.1 标识、时间与版本

- 内部主键使用 `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` ULID。
- `run_id`、`event_id`、`task_id` 等均由可信 Parent/Writer 生成，Agent 不能自定数据库主键。
- `coverage_id`、fingerprint 和 idempotency key 保存完整文本，同时保存 `BINARY(32)` SHA-256 并以哈希建立唯一索引。
- 时间全部使用 UTC `DATETIME(6)`；展示层可转换为 Asia/Shanghai。
- 所有实体具有 `schema_version`、`source_class`、`created_at`；可变投影增加 `updated_at` 和 `row_version`。
- 行级 `source_class` 只表示该记录的主要产生机制，只允许 `S/O/P/D`；它不能替代字段级来源。
- 混合对象的字段级来源由 `audit_source_provenance`保存，唯一身份为 `object_type + object_id + field_path + source_class + source_ref_hash + schema_version`。

### 3.2 删除与保留

- 外键默认 `ON DELETE RESTRICT`，禁止级联删除研究证据。
- 结构化记录默认长期保存，payload 按项目级 `retention_policy` 和 `retain_until` 清理；“长期”不等于无期限，部署前必须确定组织合规上限。
- payload 清理只将正文置空，保留哈希、长度、类型、清理原因和 `purged_at`。
- 人工删除、修复或 reconciliation 必须写入 `audit_event`。

### 3.3 原始 payload

`audit_payload` 在 `content_json` 与 `content_text` 中二选一。单条默认上限 5 MiB；超过上限时保存允许范围内的摘要、原始长度和受控指纹，并设置 `is_truncated=1`。`passed/redacted` 必须保存且仅保存一种正文；`blocked/metadata_only` 两种正文均为空。只对实际存储的脱敏内容计算 `content_sha256`。对 restricted 原文不保存普通 SHA-256，仅在确有去重需求时保存密钥轮换的 HMAC 指纹。

### 3.4 幂等与事务

- 每个事件的 `event_id` 全局唯一；`(run_id, idempotency_hash)` 唯一。
- Writer 在一个事务中插入事件、payload 和规范化投影。
- 重放相同幂等键时返回原事件，不创建新版本。
- 版本表使用 `(parent_id, version_no)` 唯一约束；revision 和 attempt 只追加。
- Outbox 是至少一次传输；数据库依靠幂等约束实现“效果一次”，不宣称分布式 exactly-once。
- `run_id` 是每次真实执行的唯一 ID；可选 `request_idempotency_hash` 仅用于去重同一次初始化请求，不得由 repo/source/profile 等语义属性推导，以免阻止合法重跑。

## 4. 长期概念目录与核心映射

本节保留原 49 表概念目录，便于说明长期字段语义；它不是第一版建表清单。第 0 节列出的 35 张表为 `core`，第 0 节移出的 15 张表为 `deferred`。任何迁移生成器都必须从 core allowlist 生成，不能遍历本节自动建表。

### 4.1 运行、事件与 payload

| 表 | 粒度 | 主要字段 | 关键约束/索引 | 来源 |
| --- | --- | --- | --- | --- |
| `audit_schema_version` | 每个 schema 版本 | `version`、`ddl_sha256`、`applied_at` | PK `version` | P |
| `audit_run` | 一次审计 | repo、脱敏 target locator、source ref、profile、budget、三个状态、Skill 哈希 | 可选 request idempotency 唯一；状态 CHECK | S+P |
| `audit_telemetry_consent` | 一次本地/远程采集授权 | 授权来源、范围、目的、保留策略、撤回状态 | 远程同步必须有 active consent | P |
| `audit_run_relation` | 当前与历史运行关系 | prior run、relation type、比较方法、可比性 | 运行对唯一 | P |
| `audit_writer_lease` | 同一 run 的 Parent/Writer 租约 | owner、epoch、起止、状态 | 每 run 最多一个 active lease | P |
| `audit_run_scope` | 一个范围条目 | scope type/value、是否包含、理由 | `(run_id, ordinal)` 唯一 | S+P |
| `audit_phase_execution` | 阶段的一次执行 | phase code、attempt、状态、起止、输入/输出 payload | `(run_id, phase_code, attempt_no)` 唯一 | S+O |
| `audit_event` | 一个不可变状态事件 | actor、event type、因果/关联 ID、payload | event/idempotency 双唯一 | P |
| `audit_event_source_ref` | 事件的一条来源引用 | 相对路径、行号、内容哈希 | event+ordinal 唯一 | P |
| `audit_payload` | 一个脱敏快照 | JSON/text、哈希、长度、脱敏和保留状态 | 内容互斥 CHECK；保留索引 | O+P |
| `audit_source_provenance` | 对象字段的来源 | object/field path、S/O/P/D、source ref、transform | 字段级唯一身份 | P |
| `audit_outbox_checkpoint` | Writer 对本地 Outbox 的确认点 | file id、offset、record no、event、hash-chain | 仅 COMMIT 后推进 | P |
| `audit_ingest_failure` | 未能投影的事件 | error code、retry、dead-letter、envelope hash | 不保存未脱敏原文 | P |

`audit_run` 必须分开记录：

- `run_status`：`initializing/in_progress/complete/incomplete/failed/cancelled`。
- `telemetry_status`：`healthy/degraded/pending_sync/synced/incomplete/disabled`。
- `outbox_status`：`empty/pending/replaying/blocked/disabled`。

### 4.2 Agent、工具、artifact 与证据

| 表 | 粒度 | 主要字段 | 关键约束 | 来源 |
| --- | --- | --- | --- | --- |
| `audit_agent_task` | 一次 Agent 调用 | role、parent task、model/config、token/费用、prompt/output payload、耗时 | Agent ID 小写安全格式；费用带币种 | S+O+P |
| `audit_tool_execution` | 一次真实工具调用 | tool、版本、命令摘要、输入/输出、CPU/内存/字节/耗时 | 不保存完整环境；关联 task | O+P |
| `audit_artifact` | 一个可信晋升文件 | owner agent、相对路径、哈希、大小、MIME、晋升状态 | owner/path/hash 唯一；禁止 scratch 路径 | S+P |
| `audit_evidence` | 一条可复核证据 | evidence type、文件、行号、描述、artifact/tool/payload | 源码路径必须为仓库相对路径 | S+P |

### 4.3 侦察与架构

| 表 | 粒度 | 主要字段 | 关键约束 | 来源 |
| --- | --- | --- | --- | --- |
| `audit_recon_fact` | 一条侦察事实 | recon kind、fact kind、statement、证据、accepted、unknown reason | 必须关联 Recon task | S+P |
| `audit_architecture_snapshot` | 一次 Parent 综合 | version、正文 payload、哈希、生成阶段 | `(run_id, version_no)` 唯一 | S+P |
| `audit_surface` | 一个入口面 | label、canonical ref、interface kind、trust level | run 内 canonical hash 唯一 | S+P |
| `audit_trust_boundary` | 一个边界 | lower/higher principal、control、resource、source-visible | run 内 canonical hash 唯一 | S+P |

Recon fact 的 `fact_kind` 区分 `source_fact/inference/unknown`；只有 `source_fact` 可以单独作为源码事实。推断必须关联明确依据，未知必须有缺失事实。

### 4.4 覆盖

| 表 | 粒度 | 主要字段 | 关键约束 | 来源 |
| --- | --- | --- | --- | --- |
| `audit_coverage_unit` | 一个 live coverage unit | canonical refs、显示字段、prior status、wave、owner、live status | run+coverage hash 唯一；复用现有状态约束 | S |
| `audit_coverage_block` | 单元选择/排除的攻击块 | block ref、kind、selected、reason | unit+block hash 唯一 | S |
| `audit_coverage_attempt` | Critic reopen 前的归档尝试 | wave、状态、owner、reason、证据快照 payload | unit+wave 唯一；append-only | S+P |
| `audit_check` | 一次 source/local 检查 | owner、method、invariant、result、reviewed paths、artifact | source 不得有 artifact；local 必须有 artifact | S |

`audit_coverage_unit.status` 精确复用：`planned/in_progress/blocked/covered/candidate/not_applicable/out_of_scope/deferred`。attempt 仅允许归档 `blocked/covered/candidate`。

### 4.5 假设、评分与攻击

| 表 | 粒度 | 主要字段 | 关键约束 | 来源 |
| --- | --- | --- | --- | --- |
| `audit_hypothesis` | 一个稳定假设身份 | coverage、creator、current version、状态、合并/拆分关系 | run+local key 唯一 | P |
| `audit_hypothesis_version` | 一次主张版本 | 攻击者、输入、入口、不变量、控制缺陷、路径、边界、资源、结果、未知、替代解释 | hypothesis+version 唯一；append-only | P |
| `audit_hypothesis_relation` | 假设间的一条有向关系 | from/to hypothesis、relation kind、事件 | 支持 merge/split 多对多；append-only | P |
| `audit_hypothesis_evidence` | 假设版本与证据关系 | evidence、relation、weight、reason | 三元唯一 | P |
| `audit_hypothesis_score` | 一次评分 | probability、impact、coverage value、information gain、成本单位、priority、评分协议、evidence cutoff | 0–1 CHECK；版本内序号唯一 | P |
| `audit_attack_plan` | 一个假设版本的攻击计划 | plan version、mode、目标、stop condition、状态 | hypothesis version+plan version 唯一 | P |
| `audit_attack_step` | 一个有序计划步骤 | ordinal、动作、前置条件、输入、预期结果 | plan+ordinal 唯一 | P |
| `audit_attack_execution` | 一次步骤执行/不执行记录 | execution no、mode、状态、实际输入/结果、工具、阻塞原因 | step+execution no 唯一 | O+P |

验证前概率是模型或规则的预测，不是事实。每次假设修订产生新版本和新评分，禁止使用最终结果回填旧概率。

### 4.6 候选、验证、决定与 Critic

| 表 | 粒度 | 主要字段 | 关键约束 | 来源 |
| --- | --- | --- | --- | --- |
| `audit_candidate` | 一个合并后的稳定 root-cause 候选 | fingerprint、consolidated payload、状态 | run+fingerprint hash 唯一 | S+P |
| `audit_candidate_observation` | 一个 Hunter 的独立提案 | hunter、本地 fingerprint、hypothesis version、payload | 保留重复发现 | O+P |
| `audit_candidate_hypothesis` | candidate 与假设的多对多关系 | relation kind、is primary | 至少一个 hypothesis | P |
| `audit_candidate_coverage` | candidate 与 coverage 的多对多关系 | relation kind、evidence role | 保留跨单元结果 | P |
| `audit_validation` | 一次独立验证任务 | phase、verifier、candidate、independence result、方法、状态 | Hunter 与 verifier 不同；序号唯一 | S+P |
| `audit_validation_observation` | 一条反例/控制/复现观察 | kind、expected、observed、supports/refutes、证据 | 必须关联 validation | P |
| `audit_decision` | 一次不可变裁决 | decision、reason、record payload、material change、supersedes | validation+decision no 唯一 | S+P |
| `audit_critic_review` | 一次覆盖复查 | critic kind、wave、profile、状态、clean pass | 必须由独立 research task | S+P |
| `audit_critic_item` | 一项 missing/reassign/gap | item kind、coverage ref、reason、accepted、result unit | review 内唯一 ordinal | S+P |

### 4.7 Finding、报告与研究指标

| 表 | 粒度 | 主要字段 | 关键约束 | 来源 |
| --- | --- | --- | --- | --- |
| `audit_finding` | 一个 fingerprint 的稳定身份 | current revision、current verdict、状态 | run+fingerprint hash 唯一 | S+P |
| `audit_finding_revision` | 一次 schema-shaped 修订 | verdict、record JSON、severity、confidence、状态、supersedes | finding+revision 唯一；append-only | S+P |
| `audit_finding_evidence` | revision 与 evidence 关系 | evidence、relation、ordinal | 三元唯一 | P |
| `audit_finding_coverage` | finding revision 与 coverage 关系 | relation kind、ordinal | 保留结论覆盖血缘 | P |
| `audit_validator_run` | 一次 Node 校验器运行 | validator、输入 artifact/hash、退出码、错误数、输出 payload | 记录 PASS 不代表漏洞真实 | S+O |
| `audit_report` | 一份报告版本 | report kind、相对路径、哈希、版本、状态 | run+kind+version 唯一 | S+P |
| `audit_metric_value` | 一次指标计算 | metric、scope、value、分母、公式版本、as-of event | 派生值可重复计算 | D |
| `audit_human_adjudication` | 一次专家标注 | hypothesis/candidate/finding 三选一、label、依据、专家伪名 | 真实外键；与内部裁决分离 | P+D |

### 4.8 字段级数据契约

DDL 定义类型、空值、默认值和键；本节定义所有表共用的业务语义。表中的每个字段以 `schema_version + table_name + column_name` 作为唯一契约身份，不以字段名单独去重。

| 字段模式 | 中文语义 | 写入者 | 可变性 | 敏感性/注意 |
| --- | --- | --- | --- | --- |
| `*_id` | ULID 实体标识；具体含义由所在表决定 | Parent/Writer | PK 不变 | internal；Agent 不得自定 |
| `run_id` | 所属审计运行 | Parent/Writer | 不变 | internal；是隔离键 |
| `*_no` / `ordinal` | 父对象内追加序号 | Writer | 不变 | 不允许重排历史 |
| `*_hash` / `*_sha256` | 明确规范化后内容的 SHA-256 | Parent/Writer | 不变 | 不得对 restricted 原文保存裸哈希 |
| `*_hmac` | 用受控密钥生成的原文去重指纹 | Redactor | 不变 | restricted；必须有 key version |
| `status` | 该表明确状态机的当前投影 | Writer | 仅合法转换 | 每次变更必须有 event |
| `source_class` | 整行的主要产生机制 | Parent/Writer | 不变 | 字段级来源另存 provenance |
| `schema_version` | 写入时使用的数据契约版本 | Writer | 不变 | 用于重放与迁移 |
| `created_at` / `occurred_at` | 数据库创建时间/业务事件时间（UTC） | DB/Parent | 不变 | 不得混用 |
| `updated_at` / `row_version` | 当前投影的最后修改时间/CAS 版本 | DB/Writer | 可变 | 仅出现在可变投影表 |
| `*_payload_id` | 脱敏 payload 快照引用 | Parent/Writer | 版本内不变 | 正文可清理，引用不删除 |
| `repo_path` / `relative_path` | 仓库或输出目录相对路径 | Parent | 不变 | sensitive；禁止主机绝对路径 |

领域字段语义以“父对象 + 字段”解释：例如 `audit_hypothesis_score.predicted_probability` 是在 `evidence_as_of_event_id` 时点对该假设成立的预测，而不是最终结果；`audit_candidate_observation.local_fingerprint_hash` 是单个 Hunter 的原始提案，`audit_candidate.fingerprint_hash` 是 Parent 合并后的稳定 root-cause 身份；`audit_human_adjudication.label` 是人工外部标签，不覆盖 `audit_decision.decision`。

## 5. 关键状态机与语义约束

```text
Run: initializing → in_progress → complete | incomplete | failed | cancelled
Telemetry: healthy → degraded → pending_sync → synced | incomplete
Task: queued → running → succeeded | failed | discarded | deferred
Hypothesis: proposed → investigating → candidate → confirmed | rejected | needs_validation
            └→ abandoned | superseded | merged | split
Attack step: planned → running → succeeded | failed | blocked | skipped
Finding revision: draft → independently_decided → final_verified | replaced | removed
```

无法用单表 CHECK 完整表达的跨表规则由 Writer 在事务内强制，并由一致性查询复核：

1. Verifier task 不得等于候选 Hunter task。
2. `source` check 的 artifact 必须为空；`local` check 必须引用同一 agent 的可信 artifact。
3. 未验证 candidate 不得产生 finding。
4. `needs_validation` 不得有 severity。
5. 重大 replacement 必须由新的独立 verifier 接受。
6. current pointer 必须指向所属实体的最高有效版本，而不是简单最大版本。
7. payload 被清理后，哈希和长度不得改变。

## 6. MySQL 8.0 DDL 状态

下方代码块是原 `1.1.0-draft` 的历史候选 DDL，仅用于追溯字段来源，**已经被第 0 节的收敛决策取代，不得复制执行，也不得作为迁移输入**。它仍包含被移出的 15 张表，以及旧的单关系、候选顺序和 P5 血缘问题。

实施前必须从第 0–5 节的数据契约重新生成 `1.2.0-core-draft` DDL，并满足以下门禁：仅含 35 张核心表；包含双模式 telemetry 字段、可空 observation candidate、假设关系表、revision-bound validation 和 subject-specific adjudication；不含上述 15 张延期表。新 DDL在 MySQL 8.0.26 隔离库验证并替换本历史块之前，数据库实施阶段不得开始。

```text
-- ai-security-v1 telemetry schema 1.1.0-draft
-- RETIRED HISTORICAL DRAFT. DO NOT EXECUTE.

CREATE TABLE audit_schema_version (
  version VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  ddl_sha256 BINARY(32) NOT NULL,
  description VARCHAR(512) NOT NULL,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL DEFAULT 'P',
  applied_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT chk_asv_source CHECK (source_class IN ('S','O','P','D'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_run (
  run_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  request_idempotency_key TEXT NULL,
  request_idempotency_hash BINARY(32) NULL,
  repo VARCHAR(512) NOT NULL,
  target_locator_redacted TEXT NOT NULL,
  target_locator_policy VARCHAR(32) NOT NULL DEFAULT 'relative_or_pseudonymized',
  source_ref VARCHAR(512) NOT NULL,
  worktree_dirty BOOLEAN NOT NULL DEFAULT FALSE,
  profile VARCHAR(16) NOT NULL,
  budget INT UNSIGNED NULL,
  execution_policy VARCHAR(64) NOT NULL,
  skill_manifest_sha256 BINARY(32) NOT NULL,
  skill_schema_version VARCHAR(32) NOT NULL,
  telemetry_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  remote_sync_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  run_status VARCHAR(24) NOT NULL,
  telemetry_status VARCHAR(24) NOT NULL,
  outbox_status VARCHAR(24) NOT NULL,
  incomplete_reason TEXT NULL,
  telemetry_incomplete_reason TEXT NULL,
  started_at DATETIME(6) NULL,
  ended_at DATETIME(6) NULL,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL DEFAULT 'P',
  row_version BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_run_request_idempotency (request_idempotency_hash),
  KEY ix_run_repo_status (repo, run_status, created_at),
  CONSTRAINT chk_run_profile CHECK (profile IN ('quick','standard','deep')),
  CONSTRAINT chk_run_status CHECK (run_status IN ('initializing','in_progress','complete','incomplete','failed','cancelled')),
  CONSTRAINT chk_run_telemetry CHECK (telemetry_status IN ('healthy','degraded','pending_sync','synced','incomplete','disabled')),
  CONSTRAINT chk_run_outbox CHECK (outbox_status IN ('empty','pending','replaying','blocked','disabled')),
  CONSTRAINT chk_run_source CHECK (source_class IN ('S','O','P','D'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_telemetry_consent (
  consent_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  run_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  consent_scope VARCHAR(24) NOT NULL,
  authority_type VARCHAR(24) NOT NULL,
  authority_reference TEXT NOT NULL,
  purpose_text TEXT NOT NULL,
  data_classes JSON NOT NULL,
  retention_policy VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  granted_at DATETIME(6) NOT NULL,
  revoked_at DATETIME(6) NULL,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL DEFAULT 'P',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY ix_consent_run_status (run_id, status, consent_scope),
  CONSTRAINT fk_consent_run FOREIGN KEY (run_id) REFERENCES audit_run(run_id) ON DELETE RESTRICT,
  CONSTRAINT chk_consent_scope CHECK (consent_scope IN ('local_outbox','remote_mysql')),
  CONSTRAINT chk_consent_authority CHECK (authority_type IN ('explicit_user','organization_policy')),
  CONSTRAINT chk_consent_status CHECK (status IN ('active','revoked','expired')),
  CONSTRAINT chk_consent_source CHECK (source_class='P')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_run_relation (
  run_relation_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  run_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  prior_run_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  relation_kind VARCHAR(24) NOT NULL,
  comparison_method VARCHAR(64) NOT NULL,
  comparable BOOLEAN NOT NULL,
  rationale TEXT NOT NULL,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL DEFAULT 'P',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_run_relation (run_id, prior_run_id, relation_kind),
  CONSTRAINT fk_rr_run FOREIGN KEY (run_id) REFERENCES audit_run(run_id) ON DELETE RESTRICT,
  CONSTRAINT fk_rr_prior FOREIGN KEY (prior_run_id) REFERENCES audit_run(run_id) ON DELETE RESTRICT,
  CONSTRAINT chk_rr_distinct CHECK (run_id<>prior_run_id),
  CONSTRAINT chk_rr_kind CHECK (relation_kind IN ('rerun','baseline','continuation','revalidation','comparison')),
  CONSTRAINT chk_rr_source CHECK (source_class='P')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_writer_lease (
  writer_lease_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  run_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  owner_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  lease_epoch BIGINT UNSIGNED NOT NULL,
  status VARCHAR(16) NOT NULL,
  active_run_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (CASE WHEN status='active' THEN run_id ELSE NULL END) STORED,
  acquired_at DATETIME(6) NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  released_at DATETIME(6) NULL,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL DEFAULT 'P',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_writer_lease_epoch (run_id, lease_epoch),
  UNIQUE KEY uq_writer_lease_active_run (active_run_id),
  KEY ix_writer_lease_expiry (status, expires_at),
  CONSTRAINT fk_writer_lease_run FOREIGN KEY (run_id) REFERENCES audit_run(run_id) ON DELETE RESTRICT,
  CONSTRAINT chk_writer_lease_status CHECK (status IN ('active','released','expired','superseded')),
  CONSTRAINT chk_writer_lease_time CHECK (expires_at>acquired_at),
  CONSTRAINT chk_writer_lease_source CHECK (source_class='P')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_run_scope (
  scope_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  run_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ordinal INT UNSIGNED NOT NULL,
  scope_type VARCHAR(32) NOT NULL,
  scope_value TEXT NOT NULL,
  included BOOLEAN NOT NULL,
  reason TEXT NULL,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_scope_order (run_id, ordinal),
  CONSTRAINT fk_scope_run FOREIGN KEY (run_id) REFERENCES audit_run(run_id) ON DELETE RESTRICT,
  CONSTRAINT chk_scope_source CHECK (source_class IN ('S','O','P','D'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_payload (
  payload_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  run_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payload_type VARCHAR(64) NOT NULL,
  mime_type VARCHAR(128) NOT NULL,
  content_json JSON NULL,
  content_text MEDIUMTEXT NULL,
  content_sha256 BINARY(32) NULL,
  stored_bytes INT UNSIGNED NOT NULL,
  original_bytes BIGINT UNSIGNED NOT NULL,
  original_fingerprint_hmac BINARY(32) NULL,
  fingerprint_key_version VARCHAR(32) NULL,
  is_truncated BOOLEAN NOT NULL DEFAULT FALSE,
  redaction_status VARCHAR(24) NOT NULL,
  redaction_profile VARCHAR(64) NOT NULL,
  redaction_version VARCHAR(32) NOT NULL,
  sensitivity VARCHAR(16) NOT NULL,
  retention_policy VARCHAR(64) NOT NULL,
  retain_until DATETIME(6) NULL,
  purged_at DATETIME(6) NULL,
  purge_reason TEXT NULL,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY ix_payload_retention (retain_until, purged_at),
  KEY ix_payload_hash (content_sha256),
  CONSTRAINT fk_payload_run FOREIGN KEY (run_id) REFERENCES audit_run(run_id) ON DELETE RESTRICT,
  CONSTRAINT chk_payload_body CHECK (
    (redaction_status IN ('passed','redacted') AND ((content_json IS NOT NULL) <> (content_text IS NOT NULL)) AND content_sha256 IS NOT NULL AND stored_bytes>0)
    OR
    (redaction_status IN ('blocked','metadata_only') AND content_json IS NULL AND content_text IS NULL AND content_sha256 IS NULL AND stored_bytes=0)
  ),
  CONSTRAINT chk_payload_fingerprint CHECK ((original_fingerprint_hmac IS NULL AND fingerprint_key_version IS NULL) OR (original_fingerprint_hmac IS NOT NULL AND fingerprint_key_version IS NOT NULL)),
  CONSTRAINT chk_payload_redaction CHECK (redaction_status IN ('passed','redacted','blocked','metadata_only')),
  CONSTRAINT chk_payload_sensitivity CHECK (sensitivity IN ('public','internal','sensitive','restricted')),
  CONSTRAINT chk_payload_source CHECK (source_class IN ('S','O','P','D'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_phase_execution (
  phase_execution_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  run_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  phase_code VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  attempt_no INT UNSIGNED NOT NULL DEFAULT 1,
  status VARCHAR(24) NOT NULL,
  input_payload_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  output_payload_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  failure_reason TEXT NULL,
  started_at DATETIME(6) NULL,
  ended_at DATETIME(6) NULL,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_phase_attempt (run_id, phase_code, attempt_no),
  CONSTRAINT fk_phase_run FOREIGN KEY (run_id) REFERENCES audit_run(run_id) ON DELETE RESTRICT,
  CONSTRAINT fk_phase_input FOREIGN KEY (input_payload_id) REFERENCES audit_payload(payload_id) ON DELETE RESTRICT,
  CONSTRAINT fk_phase_output FOREIGN KEY (output_payload_id) REFERENCES audit_payload(payload_id) ON DELETE RESTRICT,
  CONSTRAINT chk_phase_code CHECK (phase_code IN ('P0','P1','P2','P3','P4','P5','P6')),
  CONSTRAINT chk_phase_status CHECK (status IN ('pending','running','completed','skipped','failed','incomplete')),
  CONSTRAINT chk_phase_source CHECK (source_class IN ('S','O','P','D'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_event (
  event_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  run_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  phase_execution_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  event_type VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_type VARCHAR(32) NOT NULL,
  actor_id VARCHAR(128) NULL,
  agent_task_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  correlation_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  causation_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  idempotency_key TEXT NOT NULL,
  idempotency_hash BINARY(32) NOT NULL,
  payload_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  envelope_sha256 BINARY(32) NOT NULL,
  occurred_at DATETIME(6) NOT NULL,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_event_idempotency (run_id, idempotency_hash),
  KEY ix_event_timeline (run_id, occurred_at, event_id),
  KEY ix_event_type (run_id, event_type, occurred_at),
  CONSTRAINT fk_event_run FOREIGN KEY (run_id) REFERENCES audit_run(run_id) ON DELETE RESTRICT,
  CONSTRAINT fk_event_phase FOREIGN KEY (phase_execution_id) REFERENCES audit_phase_execution(phase_execution_id) ON DELETE RESTRICT,
  CONSTRAINT fk_event_payload FOREIGN KEY (payload_id) REFERENCES audit_payload(payload_id) ON DELETE RESTRICT,
  CONSTRAINT fk_event_cause FOREIGN KEY (causation_id) REFERENCES audit_event(event_id) ON DELETE RESTRICT,
  CONSTRAINT chk_event_source CHECK (source_class IN ('S','O','P','D'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_event_source_ref (
  event_source_ref_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  event_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ordinal INT UNSIGNED NOT NULL,
  relative_path TEXT NOT NULL,
  path_hash BINARY(32) NOT NULL,
  start_line INT UNSIGNED NULL,
  end_line INT UNSIGNED NULL,
  source_content_sha256 BINARY(32) NULL,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL DEFAULT 'P',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_esr_order (event_id, ordinal),
  KEY ix_esr_path (path_hash, start_line),
  CONSTRAINT fk_esr_event FOREIGN KEY (event_id) REFERENCES audit_event(event_id) ON DELETE RESTRICT,
  CONSTRAINT chk_esr_lines CHECK ((start_line IS NULL AND end_line IS NULL) OR (start_line>=1 AND end_line>=start_line)),
  CONSTRAINT chk_esr_source CHECK (source_class='P')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_source_provenance (
  provenance_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  run_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  object_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  object_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  field_path VARCHAR(512) NOT NULL,
  field_path_hash BINARY(32) NOT NULL,
  source_class CHAR(1) NOT NULL,
  source_ref TEXT NOT NULL,
  source_ref_hash BINARY(32) NOT NULL,
  transform_name VARCHAR(128) NULL,
  transform_version VARCHAR(32) NULL,
  schema_version VARCHAR(32) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_provenance_field (object_type, object_id, field_path_hash, source_class, source_ref_hash, schema_version),
  KEY ix_provenance_run_object (run_id, object_type, object_id),
  CONSTRAINT fk_provenance_run FOREIGN KEY (run_id) REFERENCES audit_run(run_id) ON DELETE RESTRICT,
  CONSTRAINT fk_provenance_event FOREIGN KEY (event_id) REFERENCES audit_event(event_id) ON DELETE RESTRICT,
  CONSTRAINT chk_provenance_source CHECK (source_class IN ('S','O','P','D'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_outbox_checkpoint (
  checkpoint_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  run_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  outbox_file_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  record_no BIGINT UNSIGNED NOT NULL,
  byte_offset_end BIGINT UNSIGNED NOT NULL,
  event_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  record_sha256 BINARY(32) NOT NULL,
  chain_sha256 BINARY(32) NOT NULL,
  committed_at DATETIME(6) NOT NULL,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL DEFAULT 'P',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_checkpoint_position (outbox_file_id, record_no),
  UNIQUE KEY uq_checkpoint_event (run_id, event_id),
  CONSTRAINT fk_checkpoint_run FOREIGN KEY (run_id) REFERENCES audit_run(run_id) ON DELETE RESTRICT,
  CONSTRAINT fk_checkpoint_event FOREIGN KEY (event_id) REFERENCES audit_event(event_id) ON DELETE RESTRICT,
  CONSTRAINT chk_checkpoint_source CHECK (source_class='P')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_ingest_failure (
  ingest_failure_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  run_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  envelope_sha256 BINARY(32) NOT NULL,
  error_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  error_summary TEXT NOT NULL,
  retry_count INT UNSIGNED NOT NULL DEFAULT 0,
  next_retry_at DATETIME(6) NULL,
  status VARCHAR(24) NOT NULL,
  dead_letter_ref TEXT NULL,
  first_failed_at DATETIME(6) NOT NULL,
  last_failed_at DATETIME(6) NOT NULL,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL DEFAULT 'P',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY ix_ingest_retry (status, next_retry_at),
  CONSTRAINT fk_ingest_run FOREIGN KEY (run_id) REFERENCES audit_run(run_id) ON DELETE RESTRICT,
  CONSTRAINT chk_ingest_status CHECK (status IN ('retryable','waiting_dependency','dead_letter','resolved')),
  CONSTRAINT chk_ingest_source CHECK (source_class='P')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

以下仍是同一份已退役的历史 DDL 续段，仅供字段追溯，不得执行。

```text
CREATE TABLE audit_agent_task (
  task_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  run_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  phase_execution_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  parent_task_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  agent_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  role VARCHAR(32) NOT NULL,
  subagent_type VARCHAR(16) NULL,
  task_kind VARCHAR(64) NOT NULL,
  scope_summary TEXT NOT NULL,
  model_provider VARCHAR(64) NULL,
  model_name VARCHAR(128) NULL,
  model_version VARCHAR(128) NULL,
  reasoning_effort VARCHAR(32) NULL,
  model_config_json JSON NULL,
  input_tokens BIGINT UNSIGNED NULL,
  output_tokens BIGINT UNSIGNED NULL,
  cached_input_tokens BIGINT UNSIGNED NULL,
  cost_amount DECIMAL(20,8) NULL,
  cost_currency CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NULL,
  prompt_payload_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  output_payload_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  status VARCHAR(24) NOT NULL,
  started_at DATETIME(6) NULL,
  ended_at DATETIME(6) NULL,
  queue_duration_ms BIGINT UNSIGNED NULL,
  execution_duration_ms BIGINT UNSIGNED NULL,
  retry_count INT UNSIGNED NOT NULL DEFAULT 0,
  failure_reason TEXT NULL,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL,
  row_version BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_task_agent (run_id, agent_id),
  KEY ix_task_phase_status (phase_execution_id, status),
  CONSTRAINT fk_task_run FOREIGN KEY (run_id) REFERENCES audit_run(run_id) ON DELETE RESTRICT,
  CONSTRAINT fk_task_phase FOREIGN KEY (phase_execution_id) REFERENCES audit_phase_execution(phase_execution_id) ON DELETE RESTRICT,
  CONSTRAINT fk_task_parent FOREIGN KEY (parent_task_id) REFERENCES audit_agent_task(task_id) ON DELETE RESTRICT,
  CONSTRAINT fk_task_prompt FOREIGN KEY (prompt_payload_id) REFERENCES audit_payload(payload_id) ON DELETE RESTRICT,
  CONSTRAINT fk_task_output FOREIGN KEY (output_payload_id) REFERENCES audit_payload(payload_id) ON DELETE RESTRICT,
  CONSTRAINT chk_task_role CHECK (role IN ('parent','recon','hunter','critic','verifier','replacement_verifier')),
  CONSTRAINT chk_task_status CHECK (status IN ('queued','running','succeeded','failed','discarded','deferred')),
  CONSTRAINT chk_task_cost CHECK ((cost_amount IS NULL AND cost_currency IS NULL) OR (cost_amount IS NOT NULL AND cost_amount>=0 AND cost_currency IS NOT NULL)),
  CONSTRAINT chk_task_source CHECK (source_class IN ('S','O','P','D'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE audit_event
  ADD CONSTRAINT fk_event_task FOREIGN KEY (agent_task_id) REFERENCES audit_agent_task(task_id) ON DELETE RESTRICT;

CREATE TABLE audit_tool_execution (
  tool_execution_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  run_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  task_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  tool_name VARCHAR(128) NOT NULL,
  tool_version VARCHAR(128) NULL,
  invocation_kind VARCHAR(32) NOT NULL,
  command_summary TEXT NULL,
  input_payload_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  output_payload_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  sandbox_policy JSON NULL,
  exit_code INT NULL,
  status VARCHAR(24) NOT NULL,
  started_at DATETIME(6) NULL,
  ended_at DATETIME(6) NULL,
  wall_duration_ms BIGINT UNSIGNED NULL,
  cpu_time_ms BIGINT UNSIGNED NULL,
  peak_memory_bytes BIGINT UNSIGNED NULL,
  stdout_bytes BIGINT UNSIGNED NULL,
  stderr_bytes BIGINT UNSIGNED NULL,
  timed_out BOOLEAN NOT NULL DEFAULT FALSE,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY ix_tool_task (task_id, started_at),
  CONSTRAINT fk_tool_run FOREIGN KEY (run_id) REFERENCES audit_run(run_id) ON DELETE RESTRICT,
  CONSTRAINT fk_tool_task FOREIGN KEY (task_id) REFERENCES audit_agent_task(task_id) ON DELETE RESTRICT,
  CONSTRAINT fk_tool_input FOREIGN KEY (input_payload_id) REFERENCES audit_payload(payload_id) ON DELETE RESTRICT,
  CONSTRAINT fk_tool_output FOREIGN KEY (output_payload_id) REFERENCES audit_payload(payload_id) ON DELETE RESTRICT,
  CONSTRAINT chk_tool_status CHECK (status IN ('planned','running','succeeded','failed','blocked','skipped')),
  CONSTRAINT chk_tool_source CHECK (source_class IN ('S','O','P','D'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_artifact (
  artifact_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  run_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  owner_task_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  relative_path TEXT NOT NULL,
  path_hash BINARY(32) NOT NULL,
  content_sha256 BINARY(32) NOT NULL,
  byte_size BIGINT UNSIGNED NOT NULL,
  mime_type VARCHAR(128) NOT NULL,
  promotion_status VARCHAR(24) NOT NULL,
  promotion_reason TEXT NULL,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_artifact_owner_path (owner_task_id, path_hash),
  CONSTRAINT fk_artifact_run FOREIGN KEY (run_id) REFERENCES audit_run(run_id) ON DELETE RESTRICT,
  CONSTRAINT fk_artifact_owner FOREIGN KEY (owner_task_id) REFERENCES audit_agent_task(task_id) ON DELETE RESTRICT,
  CONSTRAINT chk_artifact_status CHECK (promotion_status IN ('declared','promoted','rejected','discarded')),
  CONSTRAINT chk_artifact_source CHECK (source_class IN ('S','O','P','D'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_evidence (
  evidence_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  run_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  producer_task_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  evidence_type VARCHAR(32) NOT NULL,
  repo_path TEXT NULL,
  start_line INT UNSIGNED NULL,
  end_line INT UNSIGNED NULL,
  scope_name VARCHAR(512) NULL,
  description TEXT NOT NULL,
  artifact_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  tool_execution_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  payload_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  evidence_sha256 BINARY(32) NOT NULL,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY ix_evidence_path (run_id, start_line),
  CONSTRAINT fk_evidence_run FOREIGN KEY (run_id) REFERENCES audit_run(run_id) ON DELETE RESTRICT,
  CONSTRAINT fk_evidence_task FOREIGN KEY (producer_task_id) REFERENCES audit_agent_task(task_id) ON DELETE RESTRICT,
  CONSTRAINT fk_evidence_artifact FOREIGN KEY (artifact_id) REFERENCES audit_artifact(artifact_id) ON DELETE RESTRICT,
  CONSTRAINT fk_evidence_tool FOREIGN KEY (tool_execution_id) REFERENCES audit_tool_execution(tool_execution_id) ON DELETE RESTRICT,
  CONSTRAINT fk_evidence_payload FOREIGN KEY (payload_id) REFERENCES audit_payload(payload_id) ON DELETE RESTRICT,
  CONSTRAINT chk_evidence_lines CHECK ((start_line IS NULL AND end_line IS NULL) OR (start_line >= 1 AND end_line >= start_line)),
  CONSTRAINT chk_evidence_locator CHECK (repo_path IS NOT NULL OR artifact_id IS NOT NULL OR tool_execution_id IS NOT NULL OR payload_id IS NOT NULL),
  CONSTRAINT chk_evidence_source CHECK (source_class IN ('S','O','P','D'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_recon_fact (
  recon_fact_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  run_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  task_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recon_kind VARCHAR(32) NOT NULL,
  fact_kind VARCHAR(24) NOT NULL,
  statement TEXT NOT NULL,
  evidence_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  evidence_strength VARCHAR(16) NOT NULL,
  unknown_reason TEXT NULL,
  accepted_by_parent BOOLEAN NOT NULL DEFAULT FALSE,
  included_in_architecture BOOLEAN NOT NULL DEFAULT FALSE,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY ix_recon_kind (run_id, recon_kind, fact_kind),
  CONSTRAINT fk_recon_run FOREIGN KEY (run_id) REFERENCES audit_run(run_id) ON DELETE RESTRICT,
  CONSTRAINT fk_recon_task FOREIGN KEY (task_id) REFERENCES audit_agent_task(task_id) ON DELETE RESTRICT,
  CONSTRAINT fk_recon_evidence FOREIGN KEY (evidence_id) REFERENCES audit_evidence(evidence_id) ON DELETE RESTRICT,
  CONSTRAINT chk_recon_kind CHECK (recon_kind IN ('product_stack','principals_controls','surfaces_sinks','execution_visibility','focused')),
  CONSTRAINT chk_recon_fact_kind CHECK (fact_kind IN ('source_fact','inference','unknown')),
  CONSTRAINT chk_recon_strength CHECK (evidence_strength IN ('direct','corroborated','indirect','none')),
  CONSTRAINT chk_recon_source CHECK (source_class IN ('S','O','P','D'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_architecture_snapshot (
  architecture_snapshot_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  run_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  version_no INT UNSIGNED NOT NULL,
  payload_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  content_sha256 BINARY(32) NOT NULL,
  generated_by_task_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_architecture_version (run_id, version_no),
  CONSTRAINT fk_arch_run FOREIGN KEY (run_id) REFERENCES audit_run(run_id) ON DELETE RESTRICT,
  CONSTRAINT fk_arch_payload FOREIGN KEY (payload_id) REFERENCES audit_payload(payload_id) ON DELETE RESTRICT,
  CONSTRAINT fk_arch_task FOREIGN KEY (generated_by_task_id) REFERENCES audit_agent_task(task_id) ON DELETE RESTRICT,
  CONSTRAINT chk_arch_source CHECK (source_class IN ('S','O','P','D'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_surface (
  surface_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  run_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  label VARCHAR(512) NOT NULL,
  canonical_ref TEXT NOT NULL,
  canonical_ref_hash BINARY(32) NOT NULL,
  interface_kind VARCHAR(64) NOT NULL,
  trust_level VARCHAR(32) NOT NULL,
  source_fact_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_surface_ref (run_id, canonical_ref_hash),
  CONSTRAINT fk_surface_run FOREIGN KEY (run_id) REFERENCES audit_run(run_id) ON DELETE RESTRICT,
  CONSTRAINT fk_surface_fact FOREIGN KEY (source_fact_id) REFERENCES audit_recon_fact(recon_fact_id) ON DELETE RESTRICT,
  CONSTRAINT chk_surface_source CHECK (source_class IN ('S','O','P','D'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_trust_boundary (
  boundary_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  run_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  label VARCHAR(512) NOT NULL,
  canonical_ref TEXT NOT NULL,
  canonical_ref_hash BINARY(32) NOT NULL,
  lower_trust_principal TEXT NOT NULL,
  higher_trust_principal TEXT NOT NULL,
  protected_resource TEXT NOT NULL,
  strongest_control TEXT NOT NULL,
  source_visible BOOLEAN NOT NULL,
  source_fact_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_boundary_ref (run_id, canonical_ref_hash),
  CONSTRAINT fk_boundary_run FOREIGN KEY (run_id) REFERENCES audit_run(run_id) ON DELETE RESTRICT,
  CONSTRAINT fk_boundary_fact FOREIGN KEY (source_fact_id) REFERENCES audit_recon_fact(recon_fact_id) ON DELETE RESTRICT,
  CONSTRAINT chk_boundary_source CHECK (source_class IN ('S','O','P','D'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_coverage_unit (
  coverage_unit_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  run_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  coverage_id TEXT NOT NULL,
  coverage_id_hash BINARY(32) NOT NULL,
  canonical_refs JSON NOT NULL,
  surface_label TEXT NOT NULL,
  boundary_label TEXT NOT NULL,
  subsystem_label TEXT NOT NULL,
  attack_class_label TEXT NOT NULL,
  lifecycle_label TEXT NULL,
  starting_paths JSON NOT NULL,
  prior_status VARCHAR(48) NOT NULL,
  wave INT UNSIGNED NOT NULL,
  status VARCHAR(24) NOT NULL,
  owner_task_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  reviewed_paths JSON NOT NULL,
  result_fingerprints JSON NOT NULL,
  unresolved JSON NOT NULL,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL,
  row_version BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_coverage_id (run_id, coverage_id_hash),
  KEY ix_coverage_status (run_id, status, wave),
  CONSTRAINT fk_coverage_run FOREIGN KEY (run_id) REFERENCES audit_run(run_id) ON DELETE RESTRICT,
  CONSTRAINT fk_coverage_owner FOREIGN KEY (owner_task_id) REFERENCES audit_agent_task(task_id) ON DELETE RESTRICT,
  CONSTRAINT chk_coverage_status CHECK (status IN ('planned','in_progress','blocked','covered','candidate','not_applicable','out_of_scope','deferred')),
  CONSTRAINT chk_coverage_source CHECK (source_class IN ('S','O','P','D'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_coverage_block (
  coverage_block_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  coverage_unit_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  block_ref TEXT NOT NULL,
  block_ref_hash BINARY(32) NOT NULL,
  block_kind VARCHAR(32) NOT NULL,
  selected BOOLEAN NOT NULL,
  reason TEXT NULL,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_coverage_block (coverage_unit_id, block_ref_hash),
  CONSTRAINT fk_block_unit FOREIGN KEY (coverage_unit_id) REFERENCES audit_coverage_unit(coverage_unit_id) ON DELETE RESTRICT,
  CONSTRAINT chk_block_kind CHECK (block_kind IN ('ordinary','companion_core','companion_class','companion_moves','companion_validation')),
  CONSTRAINT chk_block_source CHECK (source_class IN ('S','O','P','D'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_coverage_attempt (
  coverage_attempt_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  coverage_unit_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  wave INT UNSIGNED NOT NULL,
  status VARCHAR(24) NOT NULL,
  owner_task_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  snapshot_payload_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reassignment_reason TEXT NOT NULL,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_attempt_wave (coverage_unit_id, wave),
  CONSTRAINT fk_attempt_unit FOREIGN KEY (coverage_unit_id) REFERENCES audit_coverage_unit(coverage_unit_id) ON DELETE RESTRICT,
  CONSTRAINT fk_attempt_owner FOREIGN KEY (owner_task_id) REFERENCES audit_agent_task(task_id) ON DELETE RESTRICT,
  CONSTRAINT fk_attempt_payload FOREIGN KEY (snapshot_payload_id) REFERENCES audit_payload(payload_id) ON DELETE RESTRICT,
  CONSTRAINT chk_attempt_status CHECK (status IN ('blocked','covered','candidate')),
  CONSTRAINT chk_attempt_source CHECK (source_class IN ('S','O','P','D'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_check (
  check_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  coverage_unit_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  coverage_attempt_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  owner_task_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  invariant_text TEXT NOT NULL,
  method VARCHAR(16) NOT NULL,
  result_text TEXT NOT NULL,
  reviewed_paths JSON NOT NULL,
  artifact_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY ix_check_unit (coverage_unit_id, created_at),
  CONSTRAINT fk_check_unit FOREIGN KEY (coverage_unit_id) REFERENCES audit_coverage_unit(coverage_unit_id) ON DELETE RESTRICT,
  CONSTRAINT fk_check_attempt FOREIGN KEY (coverage_attempt_id) REFERENCES audit_coverage_attempt(coverage_attempt_id) ON DELETE RESTRICT,
  CONSTRAINT fk_check_owner FOREIGN KEY (owner_task_id) REFERENCES audit_agent_task(task_id) ON DELETE RESTRICT,
  CONSTRAINT fk_check_artifact FOREIGN KEY (artifact_id) REFERENCES audit_artifact(artifact_id) ON DELETE RESTRICT,
  CONSTRAINT chk_check_method CHECK (method IN ('source','local')),
  CONSTRAINT chk_check_artifact CHECK ((method='source' AND artifact_id IS NULL) OR (method='local' AND artifact_id IS NOT NULL)),
  CONSTRAINT chk_check_source CHECK (source_class IN ('S','O','P','D'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

```text
CREATE TABLE audit_hypothesis (
  hypothesis_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  run_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  coverage_unit_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  creator_task_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  local_hypothesis_key VARCHAR(256) NOT NULL,
  current_version_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  status VARCHAR(24) NOT NULL,
  related_hypothesis_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  relation_kind VARCHAR(16) NULL,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL DEFAULT 'P',
  row_version BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_hypothesis_local (run_id, creator_task_id, local_hypothesis_key),
  KEY ix_hypothesis_status (run_id, status),
  CONSTRAINT fk_hypothesis_run FOREIGN KEY (run_id) REFERENCES audit_run(run_id) ON DELETE RESTRICT,
  CONSTRAINT fk_hypothesis_coverage FOREIGN KEY (coverage_unit_id) REFERENCES audit_coverage_unit(coverage_unit_id) ON DELETE RESTRICT,
  CONSTRAINT fk_hypothesis_creator FOREIGN KEY (creator_task_id) REFERENCES audit_agent_task(task_id) ON DELETE RESTRICT,
  CONSTRAINT fk_hypothesis_related FOREIGN KEY (related_hypothesis_id) REFERENCES audit_hypothesis(hypothesis_id) ON DELETE RESTRICT,
  CONSTRAINT chk_hypothesis_status CHECK (status IN ('proposed','investigating','candidate','confirmed','rejected','needs_validation','abandoned','superseded','merged','split')),
  CONSTRAINT chk_hypothesis_relation CHECK (relation_kind IS NULL OR relation_kind IN ('supersedes','merged_into','split_from','alternative_to')),
  CONSTRAINT chk_hypothesis_source CHECK (source_class IN ('S','O','P','D'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_hypothesis_version (
  hypothesis_version_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  hypothesis_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  version_no INT UNSIGNED NOT NULL,
  author_task_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  attacker_principal TEXT NOT NULL,
  attacker_capabilities JSON NOT NULL,
  controlled_input TEXT NOT NULL,
  entrypoint TEXT NOT NULL,
  expected_invariant TEXT NOT NULL,
  suspected_control_failure TEXT NOT NULL,
  predicted_trace JSON NOT NULL,
  target_boundary TEXT NOT NULL,
  affected_resource TEXT NOT NULL,
  predicted_result TEXT NOT NULL,
  preconditions_json JSON NOT NULL,
  unknown_facts_json JSON NOT NULL,
  alternative_explanations_json JSON NOT NULL,
  revision_reason TEXT NOT NULL,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL DEFAULT 'P',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_hypothesis_version (hypothesis_id, version_no),
  UNIQUE KEY uq_hypothesis_version_owner (hypothesis_id, hypothesis_version_id),
  CONSTRAINT fk_hv_hypothesis FOREIGN KEY (hypothesis_id) REFERENCES audit_hypothesis(hypothesis_id) ON DELETE RESTRICT,
  CONSTRAINT fk_hv_author FOREIGN KEY (author_task_id) REFERENCES audit_agent_task(task_id) ON DELETE RESTRICT,
  CONSTRAINT chk_hv_source CHECK (source_class IN ('S','O','P','D'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE audit_hypothesis
  ADD CONSTRAINT fk_hypothesis_current_version FOREIGN KEY (hypothesis_id, current_version_id) REFERENCES audit_hypothesis_version(hypothesis_id, hypothesis_version_id) ON DELETE RESTRICT;

CREATE TABLE audit_hypothesis_evidence (
  hypothesis_evidence_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  hypothesis_version_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  evidence_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  relation_kind VARCHAR(16) NOT NULL,
  weight DECIMAL(6,5) NULL,
  rationale TEXT NOT NULL,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL DEFAULT 'P',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_hypothesis_evidence (hypothesis_version_id, evidence_id, relation_kind),
  CONSTRAINT fk_he_version FOREIGN KEY (hypothesis_version_id) REFERENCES audit_hypothesis_version(hypothesis_version_id) ON DELETE RESTRICT,
  CONSTRAINT fk_he_evidence FOREIGN KEY (evidence_id) REFERENCES audit_evidence(evidence_id) ON DELETE RESTRICT,
  CONSTRAINT chk_he_relation CHECK (relation_kind IN ('supports','refutes','context','unknown')),
  CONSTRAINT chk_he_weight CHECK (weight IS NULL OR (weight BETWEEN 0 AND 1)),
  CONSTRAINT chk_he_source CHECK (source_class IN ('S','O','P','D'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_hypothesis_score (
  hypothesis_score_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  hypothesis_version_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  score_no INT UNSIGNED NOT NULL,
  scorer_task_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  predicted_probability DECIMAL(6,5) NOT NULL,
  probability_rationale TEXT NOT NULL,
  potential_impact DECIMAL(6,5) NOT NULL,
  coverage_value DECIMAL(6,5) NOT NULL,
  information_gain DECIMAL(6,5) NOT NULL,
  estimated_validation_cost DECIMAL(12,4) NOT NULL,
  validation_cost_unit VARCHAR(24) NOT NULL,
  estimated_duration_ms BIGINT UNSIGNED NULL,
  estimated_agent_calls DECIMAL(12,4) NULL,
  estimated_token_count BIGINT UNSIGNED NULL,
  priority_score DECIMAL(12,6) NOT NULL,
  formula_name VARCHAR(64) NOT NULL,
  formula_version VARCHAR(32) NOT NULL,
  scoring_protocol VARCHAR(128) NOT NULL,
  scoring_protocol_version VARCHAR(32) NOT NULL,
  model_config_sha256 BINARY(32) NULL,
  prompt_template_sha256 BINARY(32) NULL,
  evidence_as_of_event_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  scored_at DATETIME(6) NOT NULL,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL DEFAULT 'P',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_hypothesis_score (hypothesis_version_id, score_no),
  CONSTRAINT fk_hs_version FOREIGN KEY (hypothesis_version_id) REFERENCES audit_hypothesis_version(hypothesis_version_id) ON DELETE RESTRICT,
  CONSTRAINT fk_hs_scorer FOREIGN KEY (scorer_task_id) REFERENCES audit_agent_task(task_id) ON DELETE RESTRICT,
  CONSTRAINT fk_hs_evidence_cutoff FOREIGN KEY (evidence_as_of_event_id) REFERENCES audit_event(event_id) ON DELETE RESTRICT,
  CONSTRAINT chk_hs_probability CHECK (predicted_probability BETWEEN 0 AND 1),
  CONSTRAINT chk_hs_impact CHECK (potential_impact BETWEEN 0 AND 1),
  CONSTRAINT chk_hs_coverage CHECK (coverage_value BETWEEN 0 AND 1),
  CONSTRAINT chk_hs_info CHECK (information_gain BETWEEN 0 AND 1),
  CONSTRAINT chk_hs_cost CHECK (estimated_validation_cost >= 0),
  CONSTRAINT chk_hs_cost_unit CHECK (validation_cost_unit IN ('normalized','milliseconds','agent_calls','tokens','currency')),
  CONSTRAINT chk_hs_components CHECK ((estimated_duration_ms IS NULL OR estimated_duration_ms>=0) AND (estimated_agent_calls IS NULL OR estimated_agent_calls>=0)),
  CONSTRAINT chk_hs_source CHECK (source_class IN ('S','O','P','D'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_attack_plan (
  attack_plan_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  hypothesis_version_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  plan_version_no INT UNSIGNED NOT NULL,
  author_task_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  plan_mode VARCHAR(24) NOT NULL,
  objective TEXT NOT NULL,
  stop_condition TEXT NOT NULL,
  expected_boundary_result TEXT NOT NULL,
  status VARCHAR(24) NOT NULL,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL DEFAULT 'P',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_attack_plan_version (hypothesis_version_id, plan_version_no),
  CONSTRAINT fk_plan_hv FOREIGN KEY (hypothesis_version_id) REFERENCES audit_hypothesis_version(hypothesis_version_id) ON DELETE RESTRICT,
  CONSTRAINT fk_plan_author FOREIGN KEY (author_task_id) REFERENCES audit_agent_task(task_id) ON DELETE RESTRICT,
  CONSTRAINT chk_plan_mode CHECK (plan_mode IN ('source_only','bounded_local','owner_observed','mixed')),
  CONSTRAINT chk_plan_status CHECK (status IN ('draft','approved','running','completed','blocked','abandoned')),
  CONSTRAINT chk_plan_source CHECK (source_class IN ('S','O','P','D'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_attack_step (
  attack_step_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  attack_plan_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ordinal INT UNSIGNED NOT NULL,
  action_kind VARCHAR(32) NOT NULL,
  action_text TEXT NOT NULL,
  precondition_text TEXT NOT NULL,
  input_description TEXT NOT NULL,
  expected_result TEXT NOT NULL,
  planned_tool VARCHAR(128) NULL,
  status VARCHAR(24) NOT NULL,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL DEFAULT 'P',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_attack_step_order (attack_plan_id, ordinal),
  CONSTRAINT fk_step_plan FOREIGN KEY (attack_plan_id) REFERENCES audit_attack_plan(attack_plan_id) ON DELETE RESTRICT,
  CONSTRAINT chk_step_status CHECK (status IN ('planned','running','succeeded','failed','blocked','skipped')),
  CONSTRAINT chk_step_source CHECK (source_class IN ('S','O','P','D'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_attack_execution (
  attack_execution_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  attack_step_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  execution_no INT UNSIGNED NOT NULL,
  executor_task_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  execution_mode VARCHAR(24) NOT NULL,
  status VARCHAR(24) NOT NULL,
  actual_input_payload_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  observed_result TEXT NULL,
  tool_execution_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  evidence_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  blocker_reason TEXT NULL,
  started_at DATETIME(6) NULL,
  ended_at DATETIME(6) NULL,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_attack_execution (attack_step_id, execution_no),
  CONSTRAINT fk_execution_step FOREIGN KEY (attack_step_id) REFERENCES audit_attack_step(attack_step_id) ON DELETE RESTRICT,
  CONSTRAINT fk_execution_task FOREIGN KEY (executor_task_id) REFERENCES audit_agent_task(task_id) ON DELETE RESTRICT,
  CONSTRAINT fk_execution_input FOREIGN KEY (actual_input_payload_id) REFERENCES audit_payload(payload_id) ON DELETE RESTRICT,
  CONSTRAINT fk_execution_tool FOREIGN KEY (tool_execution_id) REFERENCES audit_tool_execution(tool_execution_id) ON DELETE RESTRICT,
  CONSTRAINT fk_execution_evidence FOREIGN KEY (evidence_id) REFERENCES audit_evidence(evidence_id) ON DELETE RESTRICT,
  CONSTRAINT chk_execution_mode CHECK (execution_mode IN ('source_only','local','not_executed')),
  CONSTRAINT chk_execution_status CHECK (status IN ('running','succeeded','failed','blocked','skipped')),
  CONSTRAINT chk_execution_source CHECK (source_class IN ('S','O','P','D'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_candidate (
  candidate_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  run_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  fingerprint TEXT NOT NULL,
  fingerprint_hash BINARY(32) NOT NULL,
  consolidated_payload_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(24) NOT NULL,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL,
  row_version BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_candidate_fingerprint (run_id, fingerprint_hash),
  CONSTRAINT fk_candidate_run FOREIGN KEY (run_id) REFERENCES audit_run(run_id) ON DELETE RESTRICT,
  CONSTRAINT fk_candidate_payload FOREIGN KEY (consolidated_payload_id) REFERENCES audit_payload(payload_id) ON DELETE RESTRICT,
  CONSTRAINT chk_candidate_status CHECK (status IN ('proposed','queued_for_validation','validating','decided','unvalidated','discarded')),
  CONSTRAINT chk_candidate_source CHECK (source_class IN ('S','O','P','D'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_candidate_observation (
  candidate_observation_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  candidate_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  hunter_task_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  hypothesis_version_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  local_fingerprint TEXT NOT NULL,
  local_fingerprint_hash BINARY(32) NOT NULL,
  proposed_verdict VARCHAR(24) NOT NULL,
  payload_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  observed_at DATETIME(6) NOT NULL,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_candidate_observation (candidate_id, hunter_task_id, hypothesis_version_id),
  KEY ix_candidate_observation_local (hunter_task_id, local_fingerprint_hash),
  CONSTRAINT fk_co_candidate FOREIGN KEY (candidate_id) REFERENCES audit_candidate(candidate_id) ON DELETE RESTRICT,
  CONSTRAINT fk_co_hunter FOREIGN KEY (hunter_task_id) REFERENCES audit_agent_task(task_id) ON DELETE RESTRICT,
  CONSTRAINT fk_co_hv FOREIGN KEY (hypothesis_version_id) REFERENCES audit_hypothesis_version(hypothesis_version_id) ON DELETE RESTRICT,
  CONSTRAINT fk_co_payload FOREIGN KEY (payload_id) REFERENCES audit_payload(payload_id) ON DELETE RESTRICT,
  CONSTRAINT chk_co_verdict CHECK (proposed_verdict IN ('confirmed','needs_validation')),
  CONSTRAINT chk_co_source CHECK (source_class IN ('O','P'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_candidate_hypothesis (
  candidate_hypothesis_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  candidate_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  hypothesis_version_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  relation_kind VARCHAR(24) NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL DEFAULT 'P',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_candidate_hypothesis (candidate_id, hypothesis_version_id),
  CONSTRAINT fk_ch_candidate FOREIGN KEY (candidate_id) REFERENCES audit_candidate(candidate_id) ON DELETE RESTRICT,
  CONSTRAINT fk_ch_hv FOREIGN KEY (hypothesis_version_id) REFERENCES audit_hypothesis_version(hypothesis_version_id) ON DELETE RESTRICT,
  CONSTRAINT chk_ch_relation CHECK (relation_kind IN ('origin','supports','alternative','merged')),
  CONSTRAINT chk_ch_source CHECK (source_class='P')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_candidate_coverage (
  candidate_coverage_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  candidate_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  coverage_unit_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  relation_kind VARCHAR(24) NOT NULL,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL DEFAULT 'P',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_candidate_coverage (candidate_id, coverage_unit_id, relation_kind),
  CONSTRAINT fk_cc_candidate FOREIGN KEY (candidate_id) REFERENCES audit_candidate(candidate_id) ON DELETE RESTRICT,
  CONSTRAINT fk_cc_coverage FOREIGN KEY (coverage_unit_id) REFERENCES audit_coverage_unit(coverage_unit_id) ON DELETE RESTRICT,
  CONSTRAINT chk_cc_relation CHECK (relation_kind IN ('origin','affected','supporting','duplicate')),
  CONSTRAINT chk_cc_source CHECK (source_class='P')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_validation (
  validation_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  candidate_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  validation_no INT UNSIGNED NOT NULL,
  phase_code VARCHAR(8) NOT NULL,
  verifier_task_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  validation_kind VARCHAR(32) NOT NULL,
  independence_status VARCHAR(24) NOT NULL,
  method_summary TEXT NOT NULL,
  strongest_control TEXT NULL,
  status VARCHAR(24) NOT NULL,
  started_at DATETIME(6) NULL,
  ended_at DATETIME(6) NULL,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_validation_no (candidate_id, validation_no),
  CONSTRAINT fk_validation_candidate FOREIGN KEY (candidate_id) REFERENCES audit_candidate(candidate_id) ON DELETE RESTRICT,
  CONSTRAINT fk_validation_verifier FOREIGN KEY (verifier_task_id) REFERENCES audit_agent_task(task_id) ON DELETE RESTRICT,
  CONSTRAINT chk_validation_phase CHECK (phase_code IN ('P3','P5')),
  CONSTRAINT chk_validation_independence CHECK (independence_status IN ('passed','failed','unavailable')),
  CONSTRAINT chk_validation_status CHECK (status IN ('queued','running','succeeded','failed','discarded','deferred')),
  CONSTRAINT chk_validation_source CHECK (source_class IN ('S','O','P','D'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_validation_observation (
  validation_observation_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  validation_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ordinal INT UNSIGNED NOT NULL,
  observation_kind VARCHAR(32) NOT NULL,
  expected_text TEXT NULL,
  observed_text TEXT NOT NULL,
  relation_to_claim VARCHAR(16) NOT NULL,
  evidence_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_validation_observation (validation_id, ordinal),
  CONSTRAINT fk_vo_validation FOREIGN KEY (validation_id) REFERENCES audit_validation(validation_id) ON DELETE RESTRICT,
  CONSTRAINT fk_vo_evidence FOREIGN KEY (evidence_id) REFERENCES audit_evidence(evidence_id) ON DELETE RESTRICT,
  CONSTRAINT chk_vo_relation CHECK (relation_to_claim IN ('supports','refutes','neutral','unresolved')),
  CONSTRAINT chk_vo_source CHECK (source_class IN ('S','O','P','D'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_decision (
  decision_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  validation_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  decision_no INT UNSIGNED NOT NULL,
  decision VARCHAR(24) NOT NULL,
  reason TEXT NOT NULL,
  record_payload_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  material_change BOOLEAN NOT NULL DEFAULT FALSE,
  supersedes_decision_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  decided_at DATETIME(6) NOT NULL,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_decision_no (validation_id, decision_no),
  CONSTRAINT fk_decision_validation FOREIGN KEY (validation_id) REFERENCES audit_validation(validation_id) ON DELETE RESTRICT,
  CONSTRAINT fk_decision_payload FOREIGN KEY (record_payload_id) REFERENCES audit_payload(payload_id) ON DELETE RESTRICT,
  CONSTRAINT fk_decision_supersedes FOREIGN KEY (supersedes_decision_id) REFERENCES audit_decision(decision_id) ON DELETE RESTRICT,
  CONSTRAINT chk_decision_value CHECK (decision IN ('confirmed','needs_validation','rejected','verified','replace')),
  CONSTRAINT chk_decision_source CHECK (source_class IN ('S','O','P','D'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

```text
CREATE TABLE audit_critic_review (
  critic_review_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  run_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  critic_task_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  critic_kind VARCHAR(24) NOT NULL,
  wave INT UNSIGNED NOT NULL,
  profile VARCHAR(16) NOT NULL,
  status VARCHAR(24) NOT NULL,
  clean_pass BOOLEAN NOT NULL DEFAULT FALSE,
  input_payload_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  output_payload_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_critic_task (critic_task_id),
  KEY ix_critic_wave (run_id, wave, critic_kind),
  CONSTRAINT fk_critic_run FOREIGN KEY (run_id) REFERENCES audit_run(run_id) ON DELETE RESTRICT,
  CONSTRAINT fk_critic_task FOREIGN KEY (critic_task_id) REFERENCES audit_agent_task(task_id) ON DELETE RESTRICT,
  CONSTRAINT fk_critic_input FOREIGN KEY (input_payload_id) REFERENCES audit_payload(payload_id) ON DELETE RESTRICT,
  CONSTRAINT fk_critic_output FOREIGN KEY (output_payload_id) REFERENCES audit_payload(payload_id) ON DELETE RESTRICT,
  CONSTRAINT chk_critic_kind CHECK (critic_kind IN ('post_wave','final_clean','quick_final')),
  CONSTRAINT chk_critic_status CHECK (status IN ('running','succeeded','failed','discarded','deferred')),
  CONSTRAINT chk_critic_source CHECK (source_class IN ('S','O','P','D'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_critic_item (
  critic_item_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  critic_review_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ordinal INT UNSIGNED NOT NULL,
  item_kind VARCHAR(24) NOT NULL,
  referenced_coverage_unit_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  proposed_coverage_ref TEXT NULL,
  source_backed_reason TEXT NOT NULL,
  accepted BOOLEAN NOT NULL,
  resulting_coverage_unit_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  disposition VARCHAR(24) NOT NULL,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_critic_item_order (critic_review_id, ordinal),
  CONSTRAINT fk_ci_review FOREIGN KEY (critic_review_id) REFERENCES audit_critic_review(critic_review_id) ON DELETE RESTRICT,
  CONSTRAINT fk_ci_referenced FOREIGN KEY (referenced_coverage_unit_id) REFERENCES audit_coverage_unit(coverage_unit_id) ON DELETE RESTRICT,
  CONSTRAINT fk_ci_result FOREIGN KEY (resulting_coverage_unit_id) REFERENCES audit_coverage_unit(coverage_unit_id) ON DELETE RESTRICT,
  CONSTRAINT chk_ci_kind CHECK (item_kind IN ('missing_unit','reassign','weak_check','unsupported_closure','out_of_scope_gap')),
  CONSTRAINT chk_ci_disposition CHECK (disposition IN ('queued','reassigned','deferred','out_of_scope','rejected')),
  CONSTRAINT chk_ci_source CHECK (source_class IN ('S','O','P','D'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_finding (
  finding_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  run_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  candidate_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  fingerprint TEXT NOT NULL,
  fingerprint_hash BINARY(32) NOT NULL,
  current_revision_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  current_verdict VARCHAR(24) NOT NULL,
  status VARCHAR(24) NOT NULL,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL,
  row_version BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_finding_fingerprint (run_id, fingerprint_hash),
  CONSTRAINT fk_finding_run FOREIGN KEY (run_id) REFERENCES audit_run(run_id) ON DELETE RESTRICT,
  CONSTRAINT fk_finding_candidate FOREIGN KEY (candidate_id) REFERENCES audit_candidate(candidate_id) ON DELETE RESTRICT,
  CONSTRAINT chk_finding_verdict CHECK (current_verdict IN ('confirmed','needs_validation','rejected')),
  CONSTRAINT chk_finding_status CHECK (status IN ('draft','independently_decided','final_verified','replaced','removed')),
  CONSTRAINT chk_finding_source CHECK (source_class IN ('S','O','P','D'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_finding_revision (
  finding_revision_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  finding_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  decision_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  revision_no INT UNSIGNED NOT NULL,
  verdict VARCHAR(24) NOT NULL,
  title TEXT NOT NULL,
  record_payload_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  severity_overall VARCHAR(16) NULL,
  confidence_score VARCHAR(16) NULL,
  confidence_reason TEXT NULL,
  severity_likelihood VARCHAR(16) NULL,
  severity_impact VARCHAR(16) NULL,
  status VARCHAR(24) NOT NULL,
  supersedes_revision_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  change_reason TEXT NOT NULL,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_finding_revision (finding_id, revision_no),
  UNIQUE KEY uq_finding_revision_owner (finding_id, finding_revision_id),
  CONSTRAINT fk_fr_finding FOREIGN KEY (finding_id) REFERENCES audit_finding(finding_id) ON DELETE RESTRICT,
  CONSTRAINT fk_fr_decision FOREIGN KEY (decision_id) REFERENCES audit_decision(decision_id) ON DELETE RESTRICT,
  CONSTRAINT fk_fr_payload FOREIGN KEY (record_payload_id) REFERENCES audit_payload(payload_id) ON DELETE RESTRICT,
  CONSTRAINT fk_fr_supersedes FOREIGN KEY (supersedes_revision_id) REFERENCES audit_finding_revision(finding_revision_id) ON DELETE RESTRICT,
  CONSTRAINT chk_fr_verdict CHECK (verdict IN ('confirmed','needs_validation','rejected')),
  CONSTRAINT chk_fr_severity CHECK ((verdict='confirmed' AND severity_overall IN ('informational','low','medium','high','critical')) OR (verdict<>'confirmed' AND severity_overall IS NULL)),
  CONSTRAINT chk_fr_confidence CHECK (confidence_score IS NULL OR confidence_score IN ('low','medium','high')),
  CONSTRAINT chk_fr_status CHECK (status IN ('draft','independently_decided','final_verified','replaced','removed')),
  CONSTRAINT chk_fr_source CHECK (source_class IN ('S','O','P','D'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE audit_finding
  ADD CONSTRAINT fk_finding_current_revision FOREIGN KEY (finding_id, current_revision_id) REFERENCES audit_finding_revision(finding_id, finding_revision_id) ON DELETE RESTRICT;

CREATE TABLE audit_finding_evidence (
  finding_evidence_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  finding_revision_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  evidence_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  relation_kind VARCHAR(24) NOT NULL,
  ordinal INT UNSIGNED NOT NULL,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_finding_evidence (finding_revision_id, evidence_id, relation_kind),
  UNIQUE KEY uq_finding_evidence_order (finding_revision_id, ordinal),
  CONSTRAINT fk_fe_revision FOREIGN KEY (finding_revision_id) REFERENCES audit_finding_revision(finding_revision_id) ON DELETE RESTRICT,
  CONSTRAINT fk_fe_evidence FOREIGN KEY (evidence_id) REFERENCES audit_evidence(evidence_id) ON DELETE RESTRICT,
  CONSTRAINT chk_fe_relation CHECK (relation_kind IN ('trace','root_cause','execution','blocker','refutation','context')),
  CONSTRAINT chk_fe_source CHECK (source_class IN ('S','O','P','D'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_finding_coverage (
  finding_coverage_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  finding_revision_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  coverage_unit_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  relation_kind VARCHAR(24) NOT NULL,
  ordinal INT UNSIGNED NOT NULL,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL DEFAULT 'P',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_finding_coverage (finding_revision_id, coverage_unit_id, relation_kind),
  UNIQUE KEY uq_finding_coverage_order (finding_revision_id, ordinal),
  CONSTRAINT fk_fc_revision FOREIGN KEY (finding_revision_id) REFERENCES audit_finding_revision(finding_revision_id) ON DELETE RESTRICT,
  CONSTRAINT fk_fc_coverage FOREIGN KEY (coverage_unit_id) REFERENCES audit_coverage_unit(coverage_unit_id) ON DELETE RESTRICT,
  CONSTRAINT chk_fc_relation CHECK (relation_kind IN ('origin','affected','supporting')),
  CONSTRAINT chk_fc_source CHECK (source_class='P')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_validator_run (
  validator_run_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  run_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  validator_name VARCHAR(128) NOT NULL,
  validator_version_sha256 BINARY(32) NOT NULL,
  input_kind VARCHAR(32) NOT NULL,
  input_sha256 BINARY(32) NOT NULL,
  tool_execution_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  status VARCHAR(16) NOT NULL,
  exit_code INT NOT NULL,
  error_count INT UNSIGNED NOT NULL,
  output_payload_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  executed_at DATETIME(6) NOT NULL,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY ix_validator_timeline (run_id, executed_at),
  CONSTRAINT fk_validator_run FOREIGN KEY (run_id) REFERENCES audit_run(run_id) ON DELETE RESTRICT,
  CONSTRAINT fk_validator_tool FOREIGN KEY (tool_execution_id) REFERENCES audit_tool_execution(tool_execution_id) ON DELETE RESTRICT,
  CONSTRAINT fk_validator_output FOREIGN KEY (output_payload_id) REFERENCES audit_payload(payload_id) ON DELETE RESTRICT,
  CONSTRAINT chk_validator_status CHECK (status IN ('pass','fail','blocked')),
  CONSTRAINT chk_validator_source CHECK (source_class IN ('S','O','P','D'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_report (
  report_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  run_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  report_kind VARCHAR(32) NOT NULL,
  version_no INT UNSIGNED NOT NULL,
  relative_path TEXT NOT NULL,
  content_sha256 BINARY(32) NOT NULL,
  payload_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  status VARCHAR(16) NOT NULL,
  generated_at DATETIME(6) NOT NULL,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_report_version (run_id, report_kind, version_no),
  CONSTRAINT fk_report_run FOREIGN KEY (run_id) REFERENCES audit_run(run_id) ON DELETE RESTRICT,
  CONSTRAINT fk_report_payload FOREIGN KEY (payload_id) REFERENCES audit_payload(payload_id) ON DELETE RESTRICT,
  CONSTRAINT chk_report_kind CHECK (report_kind IN ('REPORT','FINDINGS_DETAIL','NEEDS_VALIDATION','RUN_METADATA','ARCHITECTURE','COVERAGE_LEDGER','FINDINGS_JSON')),
  CONSTRAINT chk_report_status CHECK (status IN ('draft','final','partial','superseded')),
  CONSTRAINT chk_report_source CHECK (source_class IN ('S','O','P','D'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_metric_value (
  metric_value_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  run_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  metric_name VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  scope_type VARCHAR(32) NOT NULL,
  scope_id VARCHAR(256) NULL,
  numeric_value DECIMAL(30,10) NULL,
  text_value TEXT NULL,
  numerator DECIMAL(30,10) NULL,
  denominator DECIMAL(30,10) NULL,
  formula_name VARCHAR(128) NOT NULL,
  formula_version VARCHAR(32) NOT NULL,
  ground_truth_basis VARCHAR(32) NOT NULL,
  as_of_event_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  computed_at DATETIME(6) NOT NULL,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL DEFAULT 'D',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY ix_metric_lookup (run_id, metric_name, computed_at),
  CONSTRAINT fk_metric_run FOREIGN KEY (run_id) REFERENCES audit_run(run_id) ON DELETE RESTRICT,
  CONSTRAINT fk_metric_event FOREIGN KEY (as_of_event_id) REFERENCES audit_event(event_id) ON DELETE RESTRICT,
  CONSTRAINT chk_metric_value CHECK ((numeric_value IS NULL) <> (text_value IS NULL)),
  CONSTRAINT chk_metric_basis CHECK (ground_truth_basis IN ('internal_verifier','human_adjudication','none')),
  CONSTRAINT chk_metric_source CHECK (source_class='D')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_human_adjudication (
  adjudication_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  run_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  hypothesis_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  candidate_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  finding_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  adjudicator_pseudonym VARCHAR(128) NOT NULL,
  label VARCHAR(32) NOT NULL,
  rationale TEXT NOT NULL,
  evidence_payload_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  eligible_for_metrics BOOLEAN NOT NULL DEFAULT FALSE,
  adjudicated_at DATETIME(6) NOT NULL,
  schema_version VARCHAR(32) NOT NULL,
  source_class CHAR(1) NOT NULL DEFAULT 'P',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY ix_adjudication_hypothesis (hypothesis_id, adjudicated_at),
  KEY ix_adjudication_candidate (candidate_id, adjudicated_at),
  KEY ix_adjudication_finding (finding_id, adjudicated_at),
  CONSTRAINT fk_adjudication_run FOREIGN KEY (run_id) REFERENCES audit_run(run_id) ON DELETE RESTRICT,
  CONSTRAINT fk_adjudication_hypothesis FOREIGN KEY (hypothesis_id) REFERENCES audit_hypothesis(hypothesis_id) ON DELETE RESTRICT,
  CONSTRAINT fk_adjudication_candidate FOREIGN KEY (candidate_id) REFERENCES audit_candidate(candidate_id) ON DELETE RESTRICT,
  CONSTRAINT fk_adjudication_finding FOREIGN KEY (finding_id) REFERENCES audit_finding(finding_id) ON DELETE RESTRICT,
  CONSTRAINT fk_adjudication_payload FOREIGN KEY (evidence_payload_id) REFERENCES audit_payload(payload_id) ON DELETE RESTRICT,
  CONSTRAINT chk_adjudication_subject CHECK ((hypothesis_id IS NOT NULL) + (candidate_id IS NOT NULL) + (finding_id IS NOT NULL) = 1),
  CONSTRAINT chk_adjudication_label CHECK (label IN ('exact_match','partial_match','wrong_hypothesis','unresolved')),
  CONSTRAINT chk_adjudication_source CHECK (source_class IN ('P','D'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO audit_schema_version
  (version, ddl_sha256, description, schema_version, applied_at, source_class)
VALUES
  ('1.1.0-draft', UNHEX(REPEAT('00', 32)),
   'Design draft; replace zero hash with reviewed DDL SHA-256 before execution',
   '1.1.0-draft', NULL, 'P');

CREATE OR REPLACE VIEW audit_v_run_progress AS
SELECT r.run_id, r.repo, r.profile, r.run_status, r.telemetry_status,
       COALESCE(p.phase_attempts,0) AS phase_attempts,
       COALESCE(t.agent_tasks,0) AS agent_tasks,
       COALESCE(cu.coverage_units,0) AS coverage_units,
       COALESCE(c.candidates,0) AS candidates,
       COALESCE(f.final_records,0) AS final_records
FROM audit_run r
LEFT JOIN (SELECT run_id,COUNT(*) phase_attempts FROM audit_phase_execution GROUP BY run_id) p ON p.run_id=r.run_id
LEFT JOIN (SELECT run_id,COUNT(*) agent_tasks FROM audit_agent_task GROUP BY run_id) t ON t.run_id=r.run_id
LEFT JOIN (SELECT run_id,COUNT(*) coverage_units FROM audit_coverage_unit GROUP BY run_id) cu ON cu.run_id=r.run_id
LEFT JOIN (SELECT run_id,COUNT(*) candidates FROM audit_candidate GROUP BY run_id) c ON c.run_id=r.run_id
LEFT JOIN (SELECT run_id,COUNT(*) final_records FROM audit_finding GROUP BY run_id) f ON f.run_id=r.run_id;

CREATE OR REPLACE VIEW audit_v_hypothesis_outcome AS
SELECT h.run_id, h.hypothesis_id, h.status, hv.version_no,
       hs.predicted_probability, hs.priority_score,
       c.candidate_id, f.current_verdict,
       ha.label AS human_label, ha.eligible_for_metrics
FROM audit_hypothesis h
JOIN audit_hypothesis_version hv
  ON hv.hypothesis_version_id=h.current_version_id
LEFT JOIN audit_hypothesis_score hs ON hs.hypothesis_score_id=(
  SELECT hs2.hypothesis_score_id FROM audit_hypothesis_score hs2
  WHERE hs2.hypothesis_version_id=hv.hypothesis_version_id
  ORDER BY hs2.score_no DESC LIMIT 1
)
LEFT JOIN audit_candidate_hypothesis ch ON ch.hypothesis_version_id=hv.hypothesis_version_id AND ch.is_primary=TRUE
LEFT JOIN audit_candidate c ON c.candidate_id=ch.candidate_id
LEFT JOIN audit_finding f ON f.candidate_id=c.candidate_id
LEFT JOIN audit_human_adjudication ha ON ha.adjudication_id=(
  SELECT ha2.adjudication_id FROM audit_human_adjudication ha2
  WHERE ha2.hypothesis_id=h.hypothesis_id AND ha2.eligible_for_metrics=TRUE
  ORDER BY ha2.adjudicated_at DESC,ha2.adjudication_id DESC LIMIT 1
);
```

## 7. 当前 Skill 文件与数据库映射

| Skill 产物/契约 | 数据库投影 | 保留原文 |
| --- | --- | --- |
| `run-metadata.json` | `audit_run`、`audit_run_scope` | `audit_payload` |
| `architecture.md` | `audit_architecture_snapshot`、surface、boundary | `audit_payload` |
| `coverage-ledger.json` | coverage unit、block、attempt、check | `audit_payload` |
| Hunter JSON | task、hypothesis、attack、candidate、check | `audit_payload` |
| Critic JSON | critic review/item、coverage 更新 | `audit_payload` |
| Phase 3 JSON | validation、observation、decision | `audit_payload` |
| `findings.json` | finding、revision、evidence | `audit_payload` |
| Phase 5 JSON | validation、decision、revision | `audit_payload` |
| validator stdout/stderr | `audit_validator_run`、tool execution | 脱敏后 payload |
| 三份报告 | `audit_report` | 可选脱敏 payload + 文件哈希 |

## 8. 高频查询与索引意图

1. **运行时间线**：`audit_event(run_id, occurred_at, event_id)`。
2. **阶段和 Agent 成本**：task 的 phase/status/start/end。
3. **覆盖缺口**：coverage 的 run/status/wave。
4. **假设命中率**：hypothesis → current version → score → candidate → finding。
5. **证据追踪**：finding revision → finding evidence → evidence → artifact/tool。
6. **Outbox reconciliation**：run + event idempotency hash。
7. **保留清理**：payload 的 retain_until/purged_at。
8. **跨项目泛化**：repo、attack class、hypothesis score 和 adjudication label。

## 9. 研究指标口径

| 指标 | 分子/数据 | 分母/限制 | ground-truth basis |
| --- | --- | --- | --- |
| 假设确认率 | 最终 confirmed 假设数 | 有内部独立裁决的假设 | internal verifier |
| 首次精确匹配率 | version 1 被标注 exact_match | 有人工标注的首次假设 | human adjudication |
| Brier Score | `(p-y)^2` | 仅二元且已人工定案样本 | human adjudication |
| ECE | 概率桶预测均值与真实率差 | 记录分桶规则和最小样本数 | human adjudication |
| Critic 有效发现率 | Critic 新增且后续形成有效 candidate 的 item | accepted critic items | internal/human 分开 |
| 单位成本漏洞产出 | confirmed 或人工确认数 | Agent 调用/时间/费用 | 明确 basis |

`needs_validation` 不作为错误；`unresolved` 不进入二元概率校准分母。内部 Verifier 指标必须明确标为相对内部裁决，不得称为真实漏洞准确率。

## 10. 安全与治理

- 数据库 Writer 使用最小权限专用账号；迁移账号与运行时写入账号分离。
- 当前配置账号的现有权限高于运行时 Writer 所需权限，不得直接作为正式 Writer 账号。
- 连接凭据只来自运行时 secret/env/受保护 option file，不写入 Skill、SQL、Outbox、文档或日志。
- 运行时账号不得 `GRANT`、不得访问其他数据库、不得执行任意 DDL。
- 事件、版本、attempt、revision 表对 Writer 只授予 `INSERT/SELECT`；可变投影的 `UPDATE` 必须是 `row_version` 比较交换（CAS），并与状态事件同事务。
- Outbox 必须位于 Parent 独占目录，使用独占创建、权限收紧和原子追加；Agent 与目标代码不可见。
- 源码证据优先保存相对路径、行号和哈希；仅在研究必需时保存最小脱敏片段。
- 所有人工修订、payload 清理和 reconciliation 都生成事件。
- 报表查询默认按 run/repo 隔离，导出前再次脱敏。
- 远程同步要求 TLS 验证、项目/租户级查询隔离、定时保留清理任务、撤回后停止同步和可审计导出。
- `target_locator_redacted` 只允许仓库相对标识或伪名，禁止上传主机绝对路径。

## 11. 尚不能由 DDL 单独保证的事项

下列条件必须由 Writer 和一致性测试保证：ULID 格式与单调性、哈希确实对应已脱敏存储内容、Agent 独立性、artifact 路径所有权、current pointer 必须属于同一父实体、candidate 必须关联至少一个 hypothesis/coverage、重大 replacement 的新 verifier、Outbox ack 顺序、本地文件锁和半行恢复、payload 脱敏质量以及 JSON 文件与数据库投影的一致性。

## 12. Skill 基线清单与可复现算法

基线哈希不包含绝对路径。算法为：对 `ai-security-v1/` 下所有受控文件按 UTF-8 相对路径字节序排序，为每个文件生成 `<sha256><two spaces><relative-path>\n`，再对这份 manifest 的原始字节计算 SHA-256。本版结果为 `bac04717601a140814c5963b6277c1d3ab8df6225184c0c49a8a4721103effa0`。HTML 内嵌逐文件摘要，便于离线核对。

## 13. 实施前必须完成的验证

1. 先生成新的 `1.2.0-core-draft` DDL；不得从第 6 节复制历史 `1.1.0-draft`。
2. 新 DDL 必须恰好包含第 0 节定义的 35 张核心表，并证明被移出的 15 张表没有进入迁移。
3. 在与目标一致的 MySQL 8.0.26 隔离库中实际执行新 DDL，不只做文本静态检查。
4. 执行 FK/CHECK/视图回归、乱序重放、重复投递、半行 Outbox、CAS 冲突与脱敏失败测试。
5. 以最小权限账号运行权限验收；任何 `DDL/GRANT/DELETE` 对运行时 Writer 都必须失败。
6. 完成容量基线：每 run 事件数、payload 字节、月增长、索引放大、保留清理窗口和分区阈值。

本模型是逻辑实施基线；第 6 节历史 DDL 不是执行基线。当前 Skill 尚未产生这些表或字段，DDL 也未在 `ai_security` 中执行。

