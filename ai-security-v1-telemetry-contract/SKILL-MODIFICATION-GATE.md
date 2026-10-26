# 修改 ai-security-v1 Skill 前置契约

## 修改 Skill 前必须冻结

以下对象使用同一版本 `1.3.0`：

1. 36 表核心 DDL。
2. event envelope schema。
3. telemetry config schema。
4. Agent process extension schema。
5. projection map。
6. 项目远程 MySQL 8.0.26 只读解析与正式 DDL 验收结果。
7. Writer 权限与 TLS 配置。

任意一项变化都必须提升契约版本并重新运行 `verify-contract.cjs`。Skill 不得猜测数据库列或事件映射。

## Skill 修改时的稳定接口

### P0

- 将 `telemetry_mode`、`telemetry_failure_policy`、local/remote status 写入 run metadata。
- 默认 `local + best_effort`；remote 必须单独授权。
- 先安全建立本地 Outbox，后启动 Agent。

### Agent 输出

- 原有核心结果保持兼容。
- 新过程数据放在 `process` 扩展，按 `agent-process-extension.schema.json` 校验。
- 不记录隐藏思维链，只接受显式 rationale、事实、假设、计划和观察。
- best-effort 下扩展畸形不破坏有效核心结果；required 模式按预算重试或 incomplete。

### Parent 事件

- 只生成 `projection-map.json` allowlist 中的事件类型。
- Agent 不得生成 ULID、数据库主键、幂等键或直接写 Outbox。
- Parent 在验证核心结果和归属后生成事件。
- shared artifact 先按现有 Skill 原子写入并通过现有校验器，再记录其哈希事件。

### Candidate 顺序

```text
Hunter observation
→ candidate.observed（candidate_id 为空）
→ Parent fingerprint consolidation
→ candidate.consolidated
→ observation 关联稳定 candidate
```

不得预建占位 Candidate 来满足外键。

### Validation

- P3 固化 candidate、hypothesis version 和输入 SHA-256。
- P5 固化 candidate、finding revision 和输入 SHA-256。
- Verifier 独立性失败不得产生有效 decision。
- 重大 replacement 必须创建新 revision 和新独立验证。

### P6 与研究指标

- Skill 只冻结原始事实和人工标签。
- Brier/ECE 等指标由后置任务计算，不进入审计事务。
- 首次预测读取 version 1 / score 1；final revision 只用于修订质量分析。

## 不变量测试

修改 Skill 后必须证明：

1. Telemetry off 与 local best-effort 的 `coverage-ledger.json`、`findings.json` 和两个 validator 结果一致。
2. MySQL、Writer 或远程同步失败不改变当前审计 Verdict。
3. best-effort Outbox 故障继续 P1–P6；required 才停止启动新 Agent。
4. Agent 和目标代码看不到数据库凭据、Outbox、其他 Agent 目录或 retained artifacts。
5. 相同事件重放不产生第二个 hypothesis version、attack execution 或 finding revision。
6. P5 validation 能反向定位唯一 finding revision。
7. 数据库只是旁路投影，不能成为当前运行的安全事实源。

## 禁止开始 Skill 修改的条件

出现任一情况必须停止：

- 36 表 DDL 尚未在项目远程 MySQL 8.0.26 通过用户批准的正式执行验收。
- TLS VERIFY_IDENTITY 仍无法建立。
- 仍计划使用当前广权限账号作为运行时 Writer。
- JSON Schema 与 projection map 版本不一致。
- 任何延期表重新进入第一版但没有新的查询/并发证据。
