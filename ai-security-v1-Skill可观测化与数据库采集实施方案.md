# ai-security-v1 Skill 可观测化与数据库采集实施方案

> 文档状态：待实施设计方案  
> 当前操作边界：本文件仅保存实施方案；尚未修改 Skill 契约、脚本、校验器或数据库，也未执行 DDL。  
> 设计基线：`ai-security-v1` 当前版本及三份已完成的数据库与流程设计文档。

> 架构复核修订：第一版数据库由原 49 表概念模型收敛为 35 张核心事务表。移除数据库租约、通用字段 provenance、远程逐事件 checkpoint/ingest failure、surface/boundary、coverage block、Critic、validator、report 和 metric 专表；这些能力分别由本地 telemetry、事件 JSON、architecture/coverage payload、Agent/tool/artifact 和后置研究任务承担。历史 `1.1.0-draft` DDL 已作废，实施时必须重新生成并验证 `1.2.0-core-draft`。

## 1. 目标与不可破坏的执行原则

在现有 P1–P6 审计流程之上增加“过程记录、Outbox、数据库投影和研究指标”能力，同时保证采集系统不会改变漏洞判断、覆盖状态或报告结论。

当前基线已确认：

- 现有两个校验器共 65 项测试全部通过。
- 当前 Skill 是由 Markdown 契约、Agent 返回约定、JSON 产物和 JavaScript 校验器共同驱动，不是一个集中式编排程序。
- 官方 `quick_validate.py` 暂时因本机缺少 PyYAML 无法执行；实施阶段应在隔离验证环境补齐 PyYAML 后重新运行，不能将当前失败误判为 Skill 内容错误。

必须保持以下最高优先级不变量：

1. `architecture.md`、`coverage-ledger.json`、`findings.json` 和最终报告仍是审计事实源。
2. 现有两个校验器仍是覆盖和 Finding 合法性的强制门禁。
3. Telemetry 和 MySQL 只是旁路记录系统，不参与当前运行的漏洞裁决。
4. Recon、Hunter、Critic、Verifier 不得直接连接数据库或写 Outbox。
5. 只有可信 Parent 可以写本地 Outbox，只有可信 Writer 可以同步 MySQL。
6. 数据库断线绝不阻塞 P1–P6。
7. 默认 `best_effort` 模式下，本地 Outbox 失败也不阻塞审计，只标记过程记录不完整。
8. 只有用户显式选择 `required` 严格模式时，本地 Outbox 不可安全写入才停止启动新 Agent。
9. 不采集隐藏思维链，只保存显式结构化的假设、依据、评分、攻击计划、观察和裁决理由。
10. Telemetry 关闭前后，确定性测试项目上的 `coverage-ledger.json`、`findings.json` 和校验结果必须一致。

## 2. 最终运行架构

```text
Recon / Hunter / Critic / Verifier
                │
                │ 返回结构化结果
                ▼
         Trusted Parent
     ┌──────────┼────────────┐
     │          │            │
     ▼          ▼            ▼
审计事实文件   本地 Outbox   Agent scratch
主流程真相源   旁路事件日志   隔离临时数据
     │          │
     │          ▼
现有校验器   Trusted Writer
     │          │
     ▼          ▼
P1–P6继续   ai_security.audit_*
```

### 2.1 运行模式

| 模式 | 本地记录 | 远程同步 | 本地记录失败 |
|---|---:|---:|---|
| `off` | 否 | 否 | 不适用 |
| `local + best_effort` | 是 | 否 | 标记 incomplete，审计继续 |
| `local + required` | 是 | 否 | 停止启动新 Agent，安全结束为 incomplete |
| `remote + best_effort` | 是 | 异步 | 本地失败时审计继续；远程失败保持 pending |
| `remote + required` | 是 | 异步 | 本地失败时停止新 Agent；远程失败仍不阻塞审计 |

完整审计默认：

```json
{
  "mode": "local",
  "failure_policy": "best_effort",
  "remote_sync": false
}
```

远程 MySQL 同步必须单独明确授权，不因启动安全审计自动获得授权。

## 3. Skill 契约修改

### 3.1 主流程契约

修改 `SKILL.md`：

- 保留原 P1–P6 顺序、角色职责、预算机制和完成条件。
- 增加 P0 Telemetry 初始化，但 P0 不改变安全审计范围。
- 增加 `off/local/remote` 和 `best_effort/required` 定义。
- 明确审计状态与采集状态分离：

```text
run_status             = complete | incomplete | failed | cancelled
telemetry_local_status = disabled | healthy | degraded | incomplete
telemetry_remote_status = disabled | pending_sync | syncing | synced | incomplete
```

允许：

```text
run_status = complete
telemetry_remote_status = pending_sync
```

- 增加 `TELEMETRY.md` 路由说明。
- 明确数据库数据不得反向改变本次审计的优先级、覆盖和 Verdict。

### 3.2 Recon

修改 `RECONNAISSANCE.md`，不改变现有四类基础 Recon 的职责，只把返回值结构化：

```json
{
  "result_type": "recon",
  "recon_kind": "entrypoints|security_model|dangerous_operations|dependency_exposure|focused",
  "facts": [
    {
      "fact_id": "...",
      "fact_kind": "source_fact|inference|unknown",
      "statement": "...",
      "source_refs": [],
      "evidence_strength": "strong|moderate|weak",
      "unknown_reason": null
    }
  ]
}
```

规则：

- `source_fact` 必须关联文件、符号或行位置。
- `inference` 必须与源码事实分开。
- `unknown` 不得伪装成事实。
- Parent 验证 Recon 核心结果后，再产生旁路事件。
- Recon 原有信息要求和架构综合逻辑不变。

### 3.3 Hunter 和漏洞假设

修改 `HUNTING.md`，保留现有顶层返回：

```text
units
candidates
hardening
uncovered
```

在此基础上增加可选的 `process` 扩展，避免破坏现有 Parent 处理逻辑。

每个假设至少记录：

- 攻击者主体和能力。
- 可控输入与入口。
- 安全不变量。
- 怀疑失效的控制。
- 预测传播路径。
- 跨越的信任边界。
- 目标资源和预测结果。
- 前置条件、未知事实、替代解释。
- 关联 Recon 事实和源码证据。
- 当前版本以及被修订、合并、拆分、替代的关系。

验证前评分单独记录：

```text
成立概率
概率依据
潜在影响
覆盖价值
信息增益
预计验证成本
最终优先级
评分协议及版本
证据截止事件
```

评分一经进入验证阶段不得根据最终结果回填。

攻击记录分三层：

1. `attack_plan`：准备如何验证。
2. `attack_step`：计划的有序步骤。
3. `observation`：实际执行了什么、观察到什么。

必须区分：

- `source_only`
- `locally_executed`
- `blocked`
- `skipped`

仅做源码分析时不得写成“已发动攻击”。

### 3.4 Critic

保留现有 Critic 功能，增加：

- `result_type`。
- Critic 任务标识。
- 每条 reopen/reassign 原因的源码依据。
- 原 Coverage attempt、新 attempt、wave 和 owner 的关联。
- 缺失覆盖是事实、推断还是预算导致的未覆盖。
- Critic 发现的候选必须重新走独立验证，不能直接成为 Finding。

### 3.5 Verifier 和最终复核

修改 `VALIDATION-AND-REPORTING.md`：

- 保留 Verifier 与 Hunter 独立的硬性要求。
- 增加验证方法、重新读取路径、最强可见防护、反例尝试和实际观察。
- Verifier 的过程记录放在独立扩展中，不塞入现有 Finding verdict 分支。
- 不修改 `report-schema.json` 的三类 Verdict 结构。
- Phase 5 的重大替换必须创建新 revision，并触发新的独立验证。
- 内部 Verifier 裁决与后续人工专家 adjudication 永久分离。
- 研究指标在 P6 完成后计算，不得反向影响同一次运行。

### 3.6 数据库能力边界

修改 `DATABASE.md`：

- 将“人工数据库操作模式”和“审计 Telemetry Writer”明确分开。
- Telemetry 不复用现有广权限数据库凭据。
- Writer 使用独立最小权限账号。
- 数据库配置使用权限为 `0600` 的 MySQL defaults 文件。
- 密码不得进入命令行参数、事件、日志、Outbox 或报告。
- DDL、账号和授权创建只能在单独批准的迁移操作中执行。
- Skill 运行不得自动执行建表或升级数据库。

## 4. 新增实现组件

### 4.1 文档与 Schema

新增：

- `TELEMETRY.md`：完整运行契约、失败策略、事件顺序和安全边界。
- `telemetry-event-schema.json`：统一事件信封。
- `telemetry-config-schema.json`：运行模式和失败策略。
- `agent-result-schema.json`：Recon、Hunter、Critic、Verifier 和 Final Review 分支。
- `telemetry-projection-map.json`：事件到表、字段、来源类别的确定性映射。
- `telemetry-schema.sql`：与数据库模型文档一致的 MySQL 8.0 DDL 草案。

DDL 文件默认只读，不由审计流程执行。

### 4.2 Telemetry 命令接口

增加 Node.js 命令：

```bash
node scripts/audit-telemetry.cjs init-run ...
node scripts/audit-telemetry.cjs record-event ...
node scripts/audit-telemetry.cjs record-snapshot ...
node scripts/audit-telemetry.cjs verify-outbox ...
node scripts/audit-telemetry.cjs flush-outbox ...
node scripts/audit-telemetry.cjs finalize-run ...
```

统一响应：

```json
{
  "schema_version": "1.2.0",
  "request_id": "...",
  "status": "inserted|duplicate_identical|pending|rejected|conflict",
  "run_id": "...",
  "event_id": "...",
  "checkpoint": "...",
  "error": null
}
```

稳定错误类型：

```text
AUTH_REQUIRED
SCHEMA_INCOMPATIBLE
INVALID_ENVELOPE
REDACTION_BLOCKED
IDEMPOTENCY_CONFLICT
DEPENDENCY_MISSING
CONCURRENCY_CONFLICT
DB_UNAVAILABLE
OUTBOX_CORRUPT
OUTBOX_UNWRITABLE
PROJECTION_FAILED
DEAD_LETTERED
```

Parent 必须根据错误类型和 `failure_policy` 作确定性处理，不能自行猜测。

### 4.3 依赖策略

Telemetry 实现只使用 Node.js 内置模块：

- `fs`
- `crypto`
- `path`
- `child_process`

不增加 npm 运行时依赖。

远程写入通过 `mysql` CLI：

- SQL 经标准输入传递。
- 动态文本和 JSON 使用 UTF-8 十六进制编码。
- ID、状态和数字先做严格白名单校验。
- 禁止将 Agent 文本直接拼接为 SQL。
- 使用 TLS 身份校验和独立 defaults 文件。

## 5. Outbox 可靠性设计

目录结构：

```text
<output-dir>/telemetry/
  config.json
  state.json
  outbox-<file-id>.jsonl
  checkpoint.json
  dead-letter.jsonl
```

安全要求：

- 目录权限 `0700`，文件权限 `0600`。
- 拒绝符号链接、FIFO、设备文件、异常硬链接和目录逃逸。
- 仅 Parent 可以追加记录。
- 每条记录包含顺序号、长度、事件信封、前序哈希和当前链哈希。
- 每次追加后执行 `fsync`。
- JSON 使用确定性规范化：对象键排序，数组保持原顺序。
- 拒绝非有限数字、非法 Unicode 和无法确定性序列化的数据。
- 单事件或 payload 最大 5 MiB。
- 仅允许修复末尾未完成写入；中间链损坏必须标记 telemetry incomplete。
- Outbox 只保证“至少一次传输”，数据库通过幂等约束实现不重复效果，不宣称分布式 exactly-once。

幂等规则：

- 同一 `idempotency_key` 且事件哈希相同：返回 `duplicate_identical`。
- 同一键但哈希不同：进入冲突状态，禁止覆盖。
- MySQL COMMIT 成功后才能推进本地 checkpoint。
- 回滚或连接中断时不得确认 Outbox 项。

## 6. 脱敏与 Payload 策略

增加版本化脱敏器。

必须拦截或脱敏：

- password、passwd、secret、token、api_key。
- Authorization、Cookie、认证状态。
- private key、credential、连接字符串。
- 完整环境变量。
- MySQL 密码或 defaults 文件内容。
- 与审计无关的源码。
- 隐藏思维链。

允许保存：

- 结构化假设及显式依据。
- Agent 可观察输入输出的脱敏版本。
- 工具命令的安全表示。
- stdout/stderr 的脱敏摘要。
- 源码位置和必要证据片段。

脱敏状态：

- `passed`
- `redacted`
- `blocked`
- `metadata_only`

脱敏失败时只保存元数据、长度和受控摘要，不保存正文。对凭据类内容不保存可离线猜测的裸 SHA-256。

## 7. P0–P6 写入顺序

### P0

1. 初始化 `run_id`。
2. 固化 Skill 版本和文件哈希。
3. 验证 telemetry 配置。
4. 初始化本地安全目录。
5. 写入 `run.initialized`。
6. 远程模式只检查授权和兼容性，不执行迁移。

### P1

- Agent 启动前记录 `agent.task.started`。
- Recon 返回后先验证核心结构。
- Parent 接受事实后写 `recon.fact.recorded`。
- 架构综合完成后写 `architecture.snapshot.created`。
- Coverage Ledger 原子写入并通过现有校验器后写 `coverage.seeded`。

### P2

- 记录 Hunter 分配、假设创建和版本修订。
- 分开记录评分、攻击计划、实际观察。
- Candidate 先记录 observation，再由 Parent consolidation。
- Critic reopen 产生新 attempt，不覆盖旧 attempt。
- Ledger 校验成功后才记录阶段完成事件。

### P3

- 验证开始时固化输入的 candidate 和 hypothesis 版本。
- 记录 Verifier 的独立性、观察和反驳尝试。
- Decision、Candidate 状态和 Coverage check 在一个逻辑事务中投影。
- 畸形核心返回仍按原流程丢弃并重启新 Verifier。

### P4

执行顺序固定为：

```text
内存中构造 findings
→ 原子写 findings.json
→ validate-findings
→ validate-coverage-ledger
→ 记录文件哈希与 validator 结果
```

Telemetry 失败不得回滚已经合法写入的审计文件。

### P5

- 每次复核产生 append-only revision。
- 重大替换关联新的独立 Verifier。
- 删除争议记录时保留旧 revision 和 removed 事件。
- 两个校验器重新通过后才能进入 P6。

### P6

- 记录报告元数据和哈希。
- 计算覆盖、假设、成本和校准指标。
- 分别结束 `run_status`、`telemetry_local_status` 和 `telemetry_remote_status`。
- Remote Writer 异步 flush。
- 若仍有待同步记录，报告披露 `pending_sync`，但审计可正常完成。

## 8. 兼容与降级规则

Agent 返回分为“核心审计结果”和“Telemetry 扩展”：

- 核心结果畸形：保持现有规则，丢弃并重新分配。
- 核心有效但扩展缺失或畸形：
  - `best_effort`：接受核心结果，扩展标记 discarded/incomplete。
  - `required`：预算允许时重新运行；否则按现有 incomplete 规则结束。

本地 Outbox 写入失败：

- `best_effort`：记录到 Parent 内存状态和最终报告，继续启动 Agent。
- `required`：不再启动新 Agent；等待已启动 Agent 安全返回，保存现有合法产物，进入 P6 incomplete 收尾。

远程 MySQL 失败：

- 所有模式均继续审计。
- 保持 Outbox 未确认。
- 设置 `remote_status=pending_sync`。
- 后续重放不得生成重复假设、攻击步骤或 Finding revision。

## 9. 数据库投影与重试

每个事件按因果顺序投影：

```text
payload
→ audit_event
→ source/provenance
→ 规范化业务表
→ COMMIT
→ checkpoint
```

重试策略：

| 错误 | 处理 |
|---|---|
| `DB_UNAVAILABLE` | 保持 pending，不进入死信 |
| `DEPENDENCY_MISSING` | 最多重试 5 次，随后死信 |
| `PROJECTION_FAILED` | 最多重试 3 次 |
| Schema/Envelope 非法 | 立即拒绝或死信 |
| 幂等键冲突 | 立即停止该事件，不覆盖 |
| 重复且内容一致 | 返回既有结果 |

第一版使用单 Parent/单 Writer、本地排他锁和原子 checkpoint，不建设数据库 lease/fencing。可变投影继续使用 `row_version` CAS；只有出现多 Writer 高可用需求后才扩展租约。

## 10. 实施顺序与质量门禁

### 阶段 A：冻结现有行为

- 保存现有 65 项测试结果。
- 为零漏洞、confirmed、rejected、needs_validation 等建立确定性黄金样例。
- 固化现有 `coverage-ledger.json` 和 `findings.json` 哈希。

通过条件：不修改任何 Agent 契约时，现有审计行为可重复。

### 阶段 B：本地基础设施

- 实现事件 Schema、规范化 JSON、ULID、脱敏和 Outbox。
- Telemetry 默认保持关闭。
- 不修改 P1–P6 Prompt。

通过条件：基础设施单元测试全部通过，现有 65 项测试仍通过。

### 阶段 C：旁路接入

- 在 Parent 检查点接入事件。
- 启用 `local + best_effort` shadow 模式。
- 仅记录现有输出，不要求 Agent 提供新增字段。

通过条件：Telemetry off 与 local best-effort 的核心审计产物字节一致。

### 阶段 D：Agent 契约扩展

- 逐步启用 Recon 事实结构、Hunter 假设和攻击记录、Critic 理由、Verifier observations。
- 核心字段和扩展字段分别校验。
- best-effort 下扩展失败不得损害核心结果。

通过条件：扩展完整性达到要求，且没有新增审计流程中断。

### 阶段 E：数据库 Writer

- 从修订后的逻辑契约生成新的 `1.2.0-core-draft` DDL；禁止复用历史 49 表 DDL。
- 在一次性 MySQL 8.0.26 测试实例应用 DDL。
- 验证恰好 35 张核心表、外键、CHECK、索引和视图，并证明 15 张延期表未进入迁移。
- 测试重放、回滚、去重、血缘和权限。

通过条件：运行账号无法执行 DDL、DELETE、GRANT 或访问其他数据库。

### 阶段 F：远程试运行

- 必须获得单独授权。
- 创建专用最小权限账号和安全 defaults 文件。
- 小规模 canary 同步。
- 对比 JSON 事实源与数据库投影。

回滚方式：关闭 remote sync，保留本地 Outbox；审计主流程不需要回滚。

## 11. 验证矩阵

必须覆盖：

1. 零漏洞完整运行。
2. Hunter 假设经本地验证后 confirmed。
3. 假设被独立 Verifier rejected。
4. 缺少部署事实进入 needs_validation。
5. Critic reopen 并重派 Coverage Unit。
6. Phase 5 重大替换触发新独立验证。
7. quick、scoped 和 incomplete 运行。
8. Telemetry 关闭。
9. 本地 best-effort 正常和故障。
10. 本地 required 正常和故障。
11. MySQL 断线后 Outbox 重放。
12. 相同事件重复提交。
13. 相同幂等键但内容不同。
14. 脱敏失败。
15. Payload 超过 5 MiB。
16. Outbox 尾部半写入恢复。
17. Outbox 中间哈希链损坏。
18. 并发 Parent、本地排他锁和失效 Writer instance。
19. 审计完成但 telemetry pending_sync。
20. 内部裁决与人工 adjudication 不一致。
21. SQL 注入字符只能作为数据存储。
22. 符号链接、FIFO、硬链接和路径穿越被拒绝。
23. 数据库投影失败不改变 Finding 或 Coverage。
24. Telemetry off 与 best-effort 的核心产物等价。

性能门槛：

- 本地事件追加 p95 小于 100 ms，或低于总审计时间的 1%。
- 远程同步不进入 Agent 调用关键路径。
- 5 MiB 边界、长时间运行和 Outbox 轮转均需容量测试。

## 12. 最终验收标准

只有同时满足以下条件，才可认为 Skill 修改完成：

- 原有 65 项测试全部通过。
- 官方 `quick_validate.py` 在隔离且具备 PyYAML 的环境通过。
- 新增 Telemetry、Outbox、脱敏、Agent Schema 和 Writer 测试全部通过。
- 两个原有校验器的外部行为没有变化。
- `report-schema.json` 的 Verdict 契约没有被 Telemetry 污染。
- Telemetry 关闭时可以完整执行原 P1–P6。
- 默认 best-effort 下任何采集故障均不阻止审计完成。
- required 模式只在本地可信记录不可用时停止启动新 Agent。
- 远程数据库故障在任何模式下都不阻塞审计。
- Agent 无数据库凭据、无 Outbox 写权限。
- Outbox、日志、数据库和报告中不存在凭据或隐藏思维链。
- 数据库记录可以重建过程血缘，但不能反向成为审计事实源。
- 三份设计文档、Skill 契约、JSON Schema、DDL 和 HTML 使用相同版本、状态名和事件名。

## 13. 已锁定默认决策

- Telemetry Schema 初始版本为 `1.2.0`；历史 `1.1.0-draft` 不得执行。
- 完整审计默认 `local + best_effort`。
- 远程同步默认关闭。
- required 模式只能显式启用。
- 不新增 npm 运行时依赖。
- 不自动执行 DDL。
- 不复用 `DATABASE.md` 中的广权限连接。
- 不修改现有 Finding Verdict Schema。
- 不记录隐藏思维链。
- 三份设计文档需要先将原有“Outbox 失败必停”统一修订为本方案的双模式语义，再作为实现基线。
