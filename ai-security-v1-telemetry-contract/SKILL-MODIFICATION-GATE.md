# ai-security-v1 Skill 修改与运行门禁

## 版本边界

- 数据库结构：`1.3.0-core`，远程 `ai_security` 已部署36张核心表；本轮不执行DDL。
- Telemetry协议：`1.4.0`，覆盖event envelope、配置、Agent `_process`、projection map和database-client接口。
- 两个版本独立演进。协议变化不自动要求数据库结构迁移，但所有投影字段必须通过对齐检查。

## 已满足的结构门禁

1. 36张核心表已在远程MySQL 8.0.26创建并完成核心约束冒烟测试。
2. 表和utf8mb4文本列使用`utf8mb4_general_ci`；ASCII标识保持`ascii_bin`。
3. event/config/Agent schema与projection map使用协议`1.4.0`。
4. `verify-contract.cjs`和`verify-skill-db-alignment.cjs`必须通过。
5. 原有两个Skill校验器的65项测试必须继续通过。
6. Skill内嵌的四份运行时schema/projection必须与外部契约逐字节一致。
7. database-client预检必须匹配MySQL 8.0.26、36表、527列及固定列指纹、102个外键、104个CHECK、36张`utf8mb4_general_ci`表和227个utf8mb4字符列；只匹配表数不够。

## 用户接受、但不是安全通过的偏差

以下项目被用户明确接受为第一版非阻断风险：

- TLS连接不验证服务端身份，配置为`PREFERRED`并记录`tls_identity_not_verified`。
- 当前账号权限高于最小权限运行账号，记录`broad_database_account`；应用database-client仍严格禁止DELETE、DDL、权限语句、存储程序、动态表名和其他数据库。
- 两个只读视图不创建。
- `audit_schema_version` seed不补写。

这些状态不得标为PASS或安全合规，只能标为`accepted_risk`或`not_required_v1`。

## Skill稳定接口

### P0

- full audit默认`remote + best_effort`；项目已配置的`ai_security`组织策略提供遥测授权。
- 先建立并验证本地Outbox，再启动Agent。
- run metadata分开保存审计、local telemetry、remote telemetry和Outbox状态。

### Agent输出

- 原有核心结果保持权威；过程数据放在可选顶层`_process`。
- `_process`按`agent-process-extension.schema.json`验证，不记录隐藏思维链。
- 有效Agent结果必须经过`agent-adapter.cjs`自动生成规范化事件和实体ID；不得只把`_process`保存在原始payload后停止。
- best-effort下，畸形sidecar不破坏有效核心结果；required模式按预算重试或incomplete。
- Hunter使用`hunter_plan`和`hunter_result`两个检查点，验证前评分必须先于针对性验证冻结。

### Parent事件

- 只生成projection map允许的事件和表操作。
- 每类事件必须包含`required_tables`声明的业务投影，阶段必须匹配，带先决关系的事件必须用`causation_id`引用同一run内已落Outbox的允许事件。
- Agent不得生成ULID、数据库主键、幂等键、投影、SQL或直接写Outbox。
- Authoritative文件先由Parent安全写入并执行原有校验，再记录文件哈希事件。
- 数据库是旁路副本，不能成为当前审计的证据或裁决输入。

### Candidate与验证

```text
Hunter observation
→ candidate.observed（candidate_id为空）
→ Parent fingerprint/root-cause consolidation
→ candidate.consolidated
→ observation关联稳定candidate
```

- P3固化candidate、hypothesis version和输入SHA-256。
- P5固化candidate、finding revision和输入SHA-256。
- 独立性失败不得产生有效decision。
- 重大replacement创建新revision并触发新独立验证。

## 不变量测试

修改后必须证明：

1. telemetry off、local best-effort、remote best-effort不改变`coverage-ledger.json`、`findings.json`或两个校验器语义；完整审计默认使用remote。
2. MySQL、database-client或同步失败不改变当前审计Verdict。
3. best-effort Outbox故障继续P1–P6；required才停止启动新Agent。
4. Agent和目标代码看不到数据库凭据、Outbox、其他Agent目录或retained artifacts。
5. 相同事件重放不产生第二个hypothesis version、attack execution或finding revision。
6. P5 validation可定位唯一finding revision。
7. 验证前评分在攻击执行前冻结，且不会被最终结果回填。
8. 基线优先级由运行时重算；错误公式、非归一化成本或超过`1e-6`的结果偏差必须拒绝。
9. `validation.started`的Verifier必须与完整禁止任务集合机械比较，证明与投影行一致。
10. 远程合成验收必须覆盖projection map的32/32类事件，不接受抽样事件集替代完整矩阵。

## 仍会阻止运行的条件

- 36张核心表、527列或固定列指纹与数据库契约不一致。
- JSON协议major版本不兼容。
- 本地Outbox路径不安全、不可写或中间记录损坏，且failure policy为`required`。
- remote模式缺少项目级`remote_mysql`组织策略。
- 幂等键相同但稳定请求哈希不同。
- database-client试图访问allowlist外表、列、数据库或SQL类别。
