# ai-security-v1 流程数据库写入方案

> 状态：实施指导设计；本文件不会触发数据库连接或写入。  
> Skill 基线：`./ai-security-v1/`，清单 SHA-256 `bac04717601a140814c5963b6277c1d3ab8df6225184c0c49a8a4721103effa0`。  
> 数据模型：[ai-security-v1-数据库逻辑模型.md](./ai-security-v1-数据库逻辑模型.md)。  
> Schema 版本：`1.3.0-core-draft`。

> 机器可读前置契约：[`ai-security-v1-telemetry-contract/`](./ai-security-v1-telemetry-contract/README.md)。Skill 修改只能使用该目录中冻结的 event/config/agent schema 与 projection map，不得从本文自然语言猜测字段。

> 架构复核说明：第一版只投影 36 张核心事务表。数据库租约、字段级通用 provenance、远程逐事件 checkpoint、ingest failure、surface/boundary、coverage block、Critic 专表、validator/report 专表和 metric 表均已移出核心迁移。对应信息分别保存在本地 telemetry 状态、事件 JSON、architecture/coverage payload、Agent/tool/artifact 以及后置研究分析中；新增 `audit_hypothesis_coverage` 保证一个假设关联多个覆盖单元时不丢失关系。

## 1. 目标与机制变化

本方案把当前由 Markdown 指导、文件承载的审计流程扩展为可观察、可重放、可量化的流程。当前 Skill 没有编排器、Outbox 或 MySQL 写入器；以下数据库操作均为 `P` 类新增机制，不是现有实现。

| 标记 | 含义 |
| --- | --- |
| `S` | 当前 Skill 明确要求 |
| `O` | 宿主平台可能观察到 |
| `P` | 本方案新增采集/写入机制 |
| `D` | 后续派生指标 |

不采集隐藏思维链。只采集 Agent 显式返回的结构化主张、证据、替代解释、决策理由和实际动作。

## 2. 可信写入架构

```text
Recon / Hunter / Critic / Verifier
        │ 只返回结构化结果，不持有数据库凭据
        ▼
可信 Parent
        │ 1. 结构/schema/归属/独立性检查
        │ 2. 脱敏并生成 event envelope
        ▼
<output-dir>/telemetry-outbox.jsonl
        │ Parent 独占、append-only、目标代码不可见
        ▼
可信 Writer
        │ 事务 + 幂等 + 规范化投影
        ▼
ai_security.audit_* tables
```

### 2.1 权限边界

- Recon、Hunter、Critic、Verifier 和目标进程永不获得数据库连接信息。
- Parent 负责接受或拒绝 Agent 输出；Writer 不解释自然语言，只接受已验证事件。
- Writer 使用参数化 SQL，不拼接 Agent 文本。
- 迁移账号与运行时账号分离；运行时账号只拥有 `audit_*` 的必要 DML 权限。
- telemetry 不能作为审计目标的安全证据；数据库故障不能被误报为目标漏洞。

### 2.2 授权与默认规则

- `full audit` 默认 `telemetry_mode=local`、`telemetry_failure_policy=best_effort`、remote status=`disabled`。
- 连接或同步到 `ai_security` 属于 database mode，必须有用户针对本次运行的单独明示授权，或可审计的组织政策。
- P0 在本地受保护的 telemetry 配置、run 初始化 payload 和不可变事件中记录授权来源、范围、数据类别、目的、保留政策和撤回状态；没有 active `remote_mysql` 授权时 Writer 必须拒绝远程连接。第一版不为授权单独建表。
- guidance 模式不自动创建 run、Outbox 或数据库记录。
- 撤回远程授权后停止新的同步；已同步数据按授权时记录的保留/清理政策处理，不静默删除。

## 3. Outbox 与交付语义

### 3.1 文件与记录格式

Outbox 位于 Parent 共享输出目录，建议命名 `telemetry-outbox.jsonl`。每行是一个完整事件信封；不允许多行 JSON、就地编辑或 Agent 写入。

```json
{
  "schema_version": "1.3.0",
  "event_id": "01...ULID",
  "idempotency_key": "run/.../phase/P2/hypothesis/.../v1",
  "run_id": "01...ULID",
  "phase_code": "P2",
  "event_type": "hypothesis.version.created",
  "actor_type": "hunter",
  "actor_id": "hunter-authz-1",
  "agent_task_id": "01...ULID",
  "correlation_id": "01...ULID",
  "causation_id": "01...ULID",
  "occurred_at": "2026-10-26T08:30:15.123456Z",
  "source_class": "P",
  "payload_type": "hypothesis-version",
  "payload": {},
  "source_refs": ["HUNTING.md:30-138"]
}
```

事件不丢弃信封字段：`payload` 先投影到 `audit_payload`，事件保存 `payload_id`；受验证的 `source_refs[]` 作为 `audit_event.source_refs_json` 保存。仅预测、裁决、严重性和人工标签等关键研究字段在所属业务对象中保存明确来源/截止事件，不建设任意对象的字段级通用 provenance。`envelope_sha256` 对规范化 JSON（UTF-8、对象键字节序、无额外空白，数组保留顺序）计算，用于重放等价性校验。

### 3.2 写入顺序

1. Parent 验证业务对象和引用。
2. Parent 脱敏 payload；失败则生成 metadata-only payload。
3. Parent 生成 ULID、幂等键、payload hash。
4. Parent 以独占追加方式写 Outbox，并完成 `fsync`/等价持久化。
5. Writer 开启 MySQL 事务。
6. Writer按 `run_id + idempotency_hash` 查重。
7. 未存在时插入 payload、event 和规范化投影；已存在时校验事件摘要相同。
8. COMMIT 后写本地 ack/checkpoint；失败则 ROLLBACK，不确认 Outbox。
9. 重放从最后已确认记录继续。

交付语义是至少一次传输、幂等数据库效果，不声称分布式 exactly-once。

### 3.3 Outbox 故障

- MySQL 不可用：`telemetry_remote_status=pending_sync`、`outbox_status=pending`，审计继续；local status 仍由 Outbox 完整性决定。
- MySQL 恢复：按事件顺序重放；成功后 `pending_sync→synced`。
- Outbox 不可写/损坏且 `failure_policy=best_effort`：标记 telemetry incomplete，保留故障摘要并继续 P1–P6；不得把采集故障当成目标漏洞或审计失败。
- Outbox 不可写/损坏且 `failure_policy=required`：停止启动新 Agent，等待已启动任务安全返回，保留已有审计文件，以 `run_status=incomplete`、`telemetry_local_status=incomplete` 收尾。
- Outbox 中不得出现凭据、完整环境或未经脱敏内容。

### 3.4 Outbox 文件契约

| 对象 | 必需内容 | 一致性规则 |
| --- | --- | --- |
| header | magic、format version、run ID、file ID、created_at | 文件创建后不可修改 |
| record | record no、byte length、event envelope、record SHA-256、previous chain hash | 单行 UTF-8 JSON；序号严格递增 |
| checkpoint | file ID、record no、end offset、event ID、record hash、chain hash | 仅 MySQL COMMIT 成功后原子替换 |
| dead-letter | envelope hash、稳定 error code、脱敏错误摘要、retry count、时间 | 不得复制未脱敏 envelope |

写入采用进程内单 Writer 加排他锁，每条记录完整追加后 `fsync`。启动恢复时从 checkpoint 后顺序校验 length、record hash 和 hash-chain；文件尾部半行只能截断到上一个已验证边界并记录 `outbox.tail_recovered`，中间损坏则停止新 Agent。轮转只在已确认边界发生，新文件 header 引用上一文件的最终 chain hash。

checkpoint 和 dead-letter 只保存在 Parent 独占的本地 telemetry 目录。MySQL 通过 `audit_event(run_id,idempotency_hash,envelope_sha256)` 判断事件是否已提交；本地 checkpoint 丢失时允许从较早位置重放，相同事件不得新建业务版本。

## 4. Writer 行为接口

这些是第二版实现应提供的稳定行为接口，不限定 CLI、库函数或本地进程协议。

### 4.1 `init-run`

输入：run metadata、scope、Skill manifest、telemetry 配置。  
输出：`run_id`、P0 phase ID、首个 event ID、持久化状态。  
本地动作：初始化 telemetry 配置、Outbox header 和 run 初始化事件。远程投影事务（仅在获授权同步时）：`audit_run + audit_run_scope[] + audit_phase_execution + audit_event (+ payload)`。  
幂等键：`request/<caller-supplied-invocation-id>/init`。

### 4.2 `record-event`

输入：统一事件信封。  
输出：事件 ID、`inserted|duplicate-identical|conflict`、同步状态。  
规则：同一幂等键但 payload hash 不同是冲突，必须停止投影并生成 dead-letter 记录，不能覆盖。

### 4.3 `record-snapshot`

输入：文件种类、相对路径、内容哈希、脱敏 payload、生成阶段。  
用途：run metadata、architecture、ledger、findings 和报告版本。  
规则：数据库投影与文件哈希绑定；相同版本内容不同视为冲突。

### 4.4 `flush-outbox`

输入：run ID、可选最大批次。  
输出：已提交、重复、失败、dead-letter 数和最后 ack event。  
规则：保持同一 run 内因果顺序；不同 run 可并行。

### 4.5 `finalize-run`

输入：最终 run 状态、报告哈希、coverage/finding 摘要、未同步数量。  
输出：审计状态和 telemetry 状态。  
规则：`run_status=complete` 可以与 `telemetry_remote_status=pending_sync` 共存，但报告必须披露；存在无法持久化的本地事件时不得标记 local telemetry healthy，存在未提交远程事件时不得标记 remote synced。

### 4.6 稳定返回与错误契约

所有接口返回同一外层：

```json
{
  "schema_version": "1.3.0",
  "request_id": "01...ULID",
  "status": "inserted|duplicate_identical|pending|rejected|conflict",
  "run_id": "01...ULID",
  "event_id": "01...ULID",
  "checkpoint": {"file_id": "01...", "record_no": 1, "byte_offset_end": 1024},
  "error": null
}
```

`error` 非空时必须使用稳定错误码：`AUTH_REQUIRED`、`SCHEMA_INCOMPATIBLE`、`INVALID_ENVELOPE`、`REDACTION_BLOCKED`、`IDEMPOTENCY_CONFLICT`、`DEPENDENCY_MISSING`、`CONCURRENCY_CONFLICT`、`DB_UNAVAILABLE`、`OUTBOX_CORRUPT`、`OUTBOX_UNWRITABLE`、`PROJECTION_FAILED`、`DEAD_LETTERED`。错误仅包含脱敏摘要、可重试标志和 correlation ID，不返回 SQL、凭据或 payload 原文。

实施时必须为五个行为接口及 event envelope 提供版本化 JSON Schema；Writer 只接受已知 major schema，未知字段按 schema 的 `additionalProperties` 政策处理，不猜测映射。

## 5. P0–P6 记录点总览

| 记录点 | 流程动作 | 主要表 | 事务类型 | 来源 |
| --- | --- | --- | --- | --- |
| `DB-P0-01` | 创建运行与配置 | run、scope、phase、event、payload | 创建 | S+P |
| `DB-P0-02` | 预算/隔离门 | event、payload、run | 状态更新 | S+P |
| `DB-P1-01` | Recon 任务启动 | agent task、event | 创建 | S+O |
| `DB-P1-02` | Recon 返回事实 | payload、fact、evidence、task | 接收 | S+P |
| `DB-P1-03` | 架构综合 | architecture snapshot、payload | 快照 | S+P |
| `DB-P1-04` | 覆盖账本建立 | coverage unit、event | 批量创建 | S |
| `DB-P1-05` | 初始账本校验 | tool execution、artifact、event | 结果 | S+O |
| `DB-P2-01` | Hunter 分配 | task、coverage、payload | 分配 | S+P |
| `DB-P2-02` | 假设创建/修订 | hypothesis/version/evidence/score | 追加 | P |
| `DB-P2-03` | 攻击计划 | plan、step | 追加 | P |
| `DB-P2-04` | 实际分析/验证动作 | execution、tool、evidence | 追加 | O+P |
| `DB-P2-05` | Hunter 返回 | payload、check、candidate、coverage | 接收 | S+P |
| `DB-P2-06` | Critic 复查 | agent task、payload、event | 追加 | S+P |
| `DB-P2-07` | 重派/归档 | attempt、coverage、task | 状态转换 | S+P |
| `DB-P3-01` | 独立验证启动 | validation、task、event | 创建 | S+P |
| `DB-P3-02` | 反驳/复现观察 | observation、evidence、tool | 追加 | S+P |
| `DB-P3-03` | 候选裁决 | decision、candidate、coverage | 定案 | S+P |
| `DB-P4-01` | findings 投影 | finding/revision/evidence | 创建 | S+P |
| `DB-P4-02` | 两个校验器 | tool execution、artifact、event | 结果 | S+O |
| `DB-P5-01` | 最终记录复核 | validation、decision | 追加 | S+P |
| `DB-P5-02` | replacement 循环 | revision、validation、decision | 版本追加 | S+P |
| `DB-P6-01` | 报告生成 | artifact、payload、event | 快照 | S+P |
| `DB-P6-02` | 研究数据冻结 | event、human adjudication；指标后置计算 | 派生边界 | D |
| `DB-P6-03` | 终止与同步状态 | run、phase、event | 结束 | S+P |

## 6. 逐阶段写入方案

### 6.1 P0：模式、范围、预算、隔离与元数据

依据：`SKILL.md:45-87`、`SKILL.md:108-135`。

#### `DB-P0-01` 初始化

前置条件：用户请求满足 full audit；已解析 target、repo、source ref、profile、scope、budget 和输出目录。

事务写入：

1. `audit_run`：状态 `initializing`；记录 `telemetry_mode`、`telemetry_failure_policy`、local/remote status；默认 `local + best_effort`、remote disabled。
2. 初始化 payload/event：分开记录本地 Outbox 和可选 remote MySQL 的授权来源、数据类别、目的与保留政策；没有远程授权不创建远程连接。
3. `audit_run_scope[]`：包含和排除范围均记录。
4. prior run 关系写入受 schema 约束的初始化 payload；实际跨运行查询需求出现后再物化关系表。
5. `audit_phase_execution(P0, attempt=1, running)`。
6. `audit_payload(run-metadata-initial)`：脱敏快照。
7. `audit_event(run.initialized)`，其中包含受验证的 source refs JSON。

幂等键：`request/{caller-supplied-invocation-id}/P0/init`。只有调用方显式复用同一 invocation ID 才视为重试；repo/source/profile 一样的合法重跑必须产生新 run ID。同幂等键不同 envelope hash 是冲突。

#### `DB-P0-02` 预算和执行能力门

记录预算估计、四次基础 Recon、critic 和 verifier 保留量，以及沙箱、artifact 晋升和 Outbox 能力。

- 通过：run `initializing→in_progress`，P0 completed。
- 预算不足：run `incomplete`，不创建 Recon task。
- 已有远程授权但 MySQL 不通：telemetry `degraded/pending_sync`，run 继续。无远程授权时保持 local-only，不将其标记为故障。
- Outbox 不可安全写：按 `failure_policy` 执行；`best_effort` 继续审计并披露 telemetry incomplete，`required` 才停止后续 Agent。

### 6.2 P1：侦察、架构综合和覆盖账本

依据：`RECONNAISSANCE.md:3-57`、`:59-88`、`:90-156`。

#### `DB-P1-01` Recon 任务启动

每个 1a–1d 和 focused Recon 单独创建 `audit_agent_task`。四个基础任务是并行任务，不按编号串行化。

事务：task queued/running + prompt payload + `agent.task.started` event。Prompt payload 必须保存选定范围和禁止动作，不能保存数据库凭据。

#### `DB-P1-02` Recon 返回

Parent 先验证：任务归属、仓库相对路径、正行号、事实/推断/未知区分。

单个 Recon 返回事务：

1. 保存脱敏原始 output payload。
2. 每条事实写 `audit_recon_fact`。
3. 每个引用写 `audit_evidence`。
4. 更新 task 为 succeeded；畸形输出改为 discarded，不能生成 accepted fact。
5. 写 `recon.result.accepted|discarded` event。

#### `DB-P1-03` 架构综合

Parent 创建 `audit_architecture_snapshot(version_no)`，其 schema-shaped payload 内保存 surface 和 trust boundary 数组及来源 fact。推断不得伪装为 source fact；第一版不单独物化 surface/boundary 表。

#### `DB-P1-04` 覆盖账本

按 surface × boundary × subsystem × attack class（deep 可加 lifecycle）生成 coverage unit；完整 canonical ref 保存在 JSON，完整 ID 与 SHA-256 同时保存。

同一事务创建 unit，选中/排除攻击块作为受 schema 约束的 unit JSON，并创建 `coverage.seeded` event。批量失败必须整体回滚，不能生成半个账本。

#### `DB-P1-05` 校验

以 `audit_tool_execution(tool_kind=validator)` 记录 `validate-coverage-ledger.cjs` 的版本哈希、输入哈希、命令摘要、退出码、错误数和脱敏输出；输入/输出文件作为 `audit_artifact`。PASS 只代表结构符合校验器，不代表覆盖充分。

### 6.3 P2：Hunter、假设、攻击与 Critic

依据：`HUNTING.md:3-28`、`:30-159`、`:168-251`。

#### `DB-P2-01` Hunter 分配

一个事务完成：

- coverage `planned→in_progress`，设置 owner task。
- 创建 Hunter task。
- 保存完整脱敏 prompt，包括 architecture、分配单元、选中块正文、排除理由、先前排除、隔离约束和返回契约。
- 写 `hunter.assigned` event。

若 prompt 没有完整选中块、owner 重复或预算预留失败，不创建 running task。

#### `DB-P2-02` 假设创建和修订

每个结构化假设至少含：攻击者、能力、输入、入口、不变量、怀疑控制缺陷、预测 trace、边界、资源、结果、前置条件、未知事实和替代解释。

一次假设创建事务：

1. `audit_hypothesis`。
2. `audit_hypothesis_version(version=1)`。
3. evidence links；merge/split/supersede 使用 `audit_hypothesis_relation` 的有向多对多记录。
4. 验证前 score。
5. `hypothesis.created` event。

每次 score 还必须记录评分协议/版本、模型配置哈希、prompt 模板哈希、可见证据截止事件、成本单位和时间/调用/Token 分量。修订时追加 version 和 score，在同事务中用 CAS 更新 `current_version_id`；不得修改旧版本。放弃、合并、拆分和 supersede 都要有显式事件和关联假设。

#### `DB-P2-03` 攻击计划

保存计划目标、模式、停止条件、预期边界结果和有序步骤。计划不等于执行；只有 `audit_attack_execution` 能证明某一步实际发生。

#### `DB-P2-04` 实际动作

每一步记录：

- `source_only`：读取/追踪源码，不伪称执行 payload。
- `local`：满足沙箱后执行最小测试，关联 tool、artifact 和 evidence。
- `not_executed`：blocked/skipped，保存具体原因。

工具调用单独记录版本、命令摘要、安全限制、退出码、起止时间、wall/CPU/峰值内存、stdout/stderr 字节数、超时标志和输出 payload。Agent task 记录 provider/model/version、可观察配置、input/output/cache token、重试、排队/执行耗时和带币种的费用。禁止保存完整环境变量。

#### `DB-P2-05` Hunter 返回和候选门

Parent 校验 assigned IDs、ownership、reviewed paths、check、artifact 和 fingerprint。

- `covered`：写 check，无 candidate。
- `blocked`：写部分 check 和 unresolved，无 candidate。
- `candidate`：先写 `audit_candidate_observation(candidate_id=NULL)`，其身份由 run、Hunter、hypothesis version 和本地 fingerprint 确定；Parent 再按稳定 root-cause fingerprint 合并到 `audit_candidate`，补充 observation 的 candidate 映射，并通过 `audit_candidate_hypothesis` 和 `audit_candidate_coverage` 保留多对多血缘。多个 Agent 独立提出同一问题时，observation 不去重。
- 畸形/无支持：保存 discarded payload，coverage 返回 planned 等待新 owner；Parent 不修补成有效 JSON。

#### `DB-P2-06` Critic

每次 post-wave、final-clean 或 quick-final 使用 `audit_agent_task`、脱敏 output payload 和事件记录。Critic 输出 schema 必须保存 missing/reassign/gap 类型、source-backed reason、Parent 是否接受及 disposition；接受后的实际变化由 coverage attempt 和事件表示，不再重复投影专用 critic 表。

#### `DB-P2-07` reopen 和重派

接受重派时，在一个事务内：

1. 将旧 live 证据序列化到 `audit_coverage_attempt`。
2. wave 加一。
3. live owner 置空、证据清空、状态回到 planned；quick/预算不足则 deferred。
4. 写 `coverage.reopened` event。

禁止复制旧 owner 的 check/artifact 到新 live attempt。

### 6.4 P3：独立候选验证

依据：`VALIDATION-AND-REPORTING.md:3-93`。

#### `DB-P3-01` 启动验证

验证前检查 verifier 与 hunter、先前 verifier、replacement proposer 的身份差异。失败时 `independence_status=failed`，不得开始验证。

事务：new verifier task + validation queued/running + prompt payload + event。P3 固化 candidate/hypothesis version 输入；P5 还必须固化 `input_finding_revision_id` 和输入 SHA-256。

#### `DB-P3-02` 反驳和复现

按 ordinal 保存：源码引用核查、最强防护、反例、接口形状、前置条件、最小本地复现、阻塞事实。每个 observation 标记 supports/refutes/neutral/unresolved。

#### `DB-P3-03` 裁决

同一事务写入 decision、record payload、candidate 状态、coverage check/fingerprint 和 event。

- `confirmed`：完整路径和最小观察结果成立。
- `needs_validation`：具体外部事实仍是决定性阻塞。
- `rejected`：源码、控制、行为、影响或前置条件反驳。

不允许把 speculative idea 放入 needs_validation，也不允许给 needs_validation severity。

### 6.5 P4：最终结构化记录与校验

依据：`VALIDATION-AND-REPORTING.md:95-118`。

#### `DB-P4-01` findings 投影

只有存在有效独立 decision 的 candidate 可以创建 finding。一个 fingerprint 对应一个稳定 finding；每次修改生成新 revision，并通过 `audit_finding_coverage` 保留所有相关 coverage unit。新 revision、decision、event 和 `current_revision_id` 的 CAS 更新必须在同一事务。

保存 schema-shaped record 原文 payload，规范化当前 verdict、severity、confidence 和 evidence link。未验证 candidate 只留在 ledger/candidate，不进入 finding。

#### `DB-P4-02` 校验器

对 findings 和 coverage 各记录一次 `tool_execution(tool_kind=validator)`，并将输入/输出作为 artifact。输入文件哈希必须与文件快照一致。任一失败时不得进入 P5；修正后生成新的 tool execution，旧失败记录保留。

### 6.6 P5：最终复核和 replacement

依据：`VALIDATION-AND-REPORTING.md:120-149`。

quick profile 将普通 P5 检查合并至 P3，但仍记录 `validation_kind=quick_combined`。standard/deep 为每个 confirmed 和 needs_validation 创建新 research verifier。

- `verified`：记录 decision，不产生内容 revision。
- 非重大 replace：追加 revision，记录差异理由，用 CAS 更新 current revision，重跑校验器。
- 重大 replace：先保存 proposed decision，不设为 current；创建新的独立 verifier。
- 无预算或无独立 verifier：争议 finding 标 removed，candidate 保留 unresolved，run incomplete。

每次 applied replacement 都重跑两个校验器并产生事件。

### 6.7 P6：报告、指标和终止

依据：`VALIDATION-AND-REPORTING.md:151-186`。

#### `DB-P6-01` 报告

以 `audit_artifact` 保存 REPORT、FINDINGS_DETAIL、NEEDS_VALIDATION 及 run metadata、architecture、ledger、findings 的 kind、相对路径、版本和 SHA-256。数据库中的 prose 不得改变 verdict、severity 或 impact。

#### `DB-P6-02` 指标

P6 只冻结指标所需的原始事实和 as-of event。指标由后置、版本化研究任务重算并输出独立数据集，不在审计事务中写 `audit_metric_value`。内部 verifier 与 human adjudication 分开计算；needs_validation/unresolved 不进入二元正确率分母。

#### `DB-P6-03` 终止

- 所有审计门禁通过：run complete。
- 有未验证 candidate 或缺 critic：run incomplete。Outbox 不可用时，`best_effort` 只令 telemetry incomplete；`required` 才令 run incomplete。
- MySQL 尚未同步但 Outbox 完整：run 可以 complete，telemetry pending_sync。
- 全部重放成功：telemetry synced、outbox empty。

## 7. 状态转换与事件要求

| 对象 | 允许的主要转换 | 必须事件 |
| --- | --- | --- |
| Run | initializing→in_progress→终态 | `run.initialized/started/finalized` |
| Telemetry | healthy→degraded→pending_sync→synced/incomplete | `telemetry.*` |
| Agent task | queued→running→终态 | `agent.task.*` |
| Coverage | planned→in_progress→blocked/covered/candidate | `coverage.*` |
| Hypothesis | proposed→investigating→candidate→裁决 | `hypothesis.*` |
| Attack step | planned→running→终态 | `attack.step.*` |
| Candidate | proposed→validating→decided | `candidate.*` |
| Finding revision | draft→independently_decided→final_verified/replaced/removed | `finding.revision.*` |

任何当前状态 UPDATE 都必须与对应 event 在同一事务提交。

## 8. 幂等键规范

| 对象 | 幂等键模板 |
| --- | --- |
| Run | `request/{caller-supplied-invocation-id}/init` |
| Phase | `run/{run}/phase/{phase}/attempt/{n}/{transition}` |
| Task | `run/{run}/task/{agent-id}/{transition}` |
| Recon fact | `run/{run}/task/{task}/fact/{local-index}` |
| Coverage | `run/{run}/coverage/{coverage-hash}/{transition}/wave/{n}` |
| Hypothesis version | `run/{run}/hypothesis/{hypothesis}/version/{n}` |
| Attack step | `run/{run}/plan/{plan}/step/{ordinal}` |
| Candidate | `run/{run}/candidate/{fingerprint-hash}` |
| Validation | `run/{run}/candidate/{candidate}/validation/{n}` |
| Finding revision | `run/{run}/finding/{fingerprint-hash}/revision/{n}` |
| Report | `run/{run}/report/{kind}/version/{n}` |

幂等键先做 Unicode NFC、禁止控制/默认不可见字符、禁止首尾空白，再计算 UTF-8 SHA-256。

## 9. 脱敏和内容边界

写入前按字段 denylist、凭据模式、路径策略和 payload 类型执行脱敏。至少禁止：密码、API key、cookie、Authorization、私钥、云凭据、数据库连接串、完整环境变量和用户无关文件。

| 情况 | 正文 | 哈希/长度 | 状态 |
| --- | --- | --- | --- |
| 无敏感内容 | 保存 | 保存 | passed |
| 可确定脱敏 | 保存脱敏版 | 存储内容 SHA-256；可选原文 HMAC | redacted |
| 不能安全脱敏 | 不保存 | 原始长度；默认不保存普通原文哈希 | blocked |
| 只需元数据 | 不保存 | 原始长度；按需保存轮换密钥 HMAC | metadata_only |
| 超过 5 MiB | 保存允许范围内摘要 | 摘要 SHA-256、原始长度、可选 HMAC | is_truncated=1 |

## 10. 冲突、补偿与 reconciliation

1. 同幂等键、同 payload hash：视为安全重放。
2. 同幂等键、不同 hash：进入 dead-letter；不得覆盖。
3. 外键对象缺失：拒绝投影，等待因果前置事件；超过重试策略后 dead-letter。
4. MySQL 事务失败：ROLLBACK，Outbox 不 ack。
5. JSON 文件与数据库投影不一致：比较文件哈希、事件和版本，生成 `reconciliation.detected`；以可信文件和事件重建新 revision，不修改历史。
6. payload 清理：生成 `payload.purged`，保留 hash/length。
7. current pointer 错误：通过有效版本规则重建并生成 reconciliation event。

### 10.1 并发、租约与栅栏

第一版同一 run 只允许一个 Parent 和一个本地 Writer，由 Parent 独占目录、排他锁、Writer PID/instance ID 和原子 checkpoint 保证，不建设数据库 lease/fencing。对 `audit_run`、task、coverage、hypothesis、candidate 和 finding 的更新仍使用 `WHERE row_version=?`；影响行数为 0 时返回 `CONCURRENCY_CONFLICT`，重读事件后决定重试，不盲目覆盖。只有出现多 Writer 高可用需求后才扩展数据库租约。

### 10.2 Schema 演进

采用 expand/contract：先添加可空列/新表并部署双读 Writer，再回填和校验，然后切换写入，最后在旧 Writer 已退出后收紧约束。Writer 启动时校验数据库 schema major/minor 能力；不兼容则在 P0 停止，不猜测列映射。每个 migration 保存 DDL 哈希、前置/后置校验和停用策略；本方案不承诺破坏性 down migration。

### 10.3 Writer 运行可观测性

必须暴露但不混入审计结论的运行指标：Outbox pending 数/字节、最老未同步年龄、每类错误重试数、dead-letter 数/年龄、批处理大小、MySQL 延迟/回滚率、checkpoint 落后量、脱敏 blocked 率和 schema conflict 数。监控数据不得包含 payload、路径或凭据。

### 10.4 容量与保留基线

上线前用 quick/standard/deep 合成运行测量每 run 的事件、假设版本、工具输出和 payload 字节分布，据此确定月增长、索引放大、清理批次和分区阈值。远程仅保存仓库相对路径或伪名标识，禁止主机绝对路径。每次 purge 先生成待清理清单，再分批置空正文并保留清理事件。

## 11. 研究分析口径

### 11.1 假设正确性

- `exact_match`：根因、路径、边界、资源和结果均匹配。
- `partial_match`：确有安全问题，但根因、路径或影响被实质修正。
- `wrong_hypothesis`：被源码、控制、行为或前置条件反驳。
- `unresolved`：仍缺决定性事实。

内部 Verifier 结果只支持“相对内部裁决”指标；只有 eligible human adjudication 可作为外部 ground truth。

### 11.2 概率校准

- 使用创建/修订当时的 immutable `predicted_probability`。
- 最终结果不能回填历史概率。
- Brier/ECE 只使用人工定案的二元样本；unresolved 排除并报告排除数。
- ECE 必须保存分桶规则、样本数和公式版本。

### 11.3 效率与泛化

按 repo、技术栈、attack class、boundary、agent role、验证方法和 profile 分层统计。报告样本量、缺失率和选择偏差；不能把 quick/scoped 的未覆盖部分当作负样本。

## 12. 十二个验收场景

| 场景 | 关键期望记录 |
| --- | --- |
| 零漏洞完整运行 | covered units、clean critic、零 finding、complete |
| 本地验证 confirmed | hypothesis→plan→local execution→decision→finding |
| verifier rejected | 反驳 observation、rejected revision、无 severity |
| needs_validation | 决定性 blocker、精确 validation plan、无 severity |
| Critic reopen | old attempt 归档、新 wave/new owner、无证据复制 |
| P5 重大替换 | proposed replacement、新独立 verifier、新 revision |
| quick/scoped/incomplete | deferred/out_of_scope 与 partial disclosure |
| MySQL 断线 | degraded、pending Outbox、恢复后 synced |
| 重复事件 | duplicate-identical，不产生重复版本 |
| 脱敏/超限 | blocked 或 truncated，保留 hash/length |
| run complete + pending_sync | 两个状态并存且报告披露 |
| 人工与内部结论不一致 | 两套标签并存，指标 basis 明确 |

## 13. 第二版实施顺序

1. 在独立测试库验证 DDL 和权限模型。
2. 定义 event JSON Schema、状态机和错误码。
3. 实现脱敏器、ULID/hash/idempotency 工具。
4. 实现安全 Outbox 和 ack/checkpoint。
5. 实现 Writer 五个接口和事务投影。
6. 为 Recon/Hunter/Critic/Verifier 增加结构化过程契约。
7. 在 P0–P6 加入 Parent 记录点。
8. 实现一致性校验器：文件↔事件↔投影。
9. 运行十二个合成场景和故障注入。
10. 经单独授权后迁移远程 `ai_security`。

本方案不会把数据库接入描述为当前 Skill 的已有能力；在第二版真正实现、测试和部署前，所有 `P` 字段都只是设计契约。
