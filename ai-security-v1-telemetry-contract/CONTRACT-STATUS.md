# Telemetry Contract 1.3.0 验证状态

更新时间：2026-10-26（Asia/Shanghai）

## 结论

当前已完成远程 `ai_security` 的 36 张核心表创建及排序规则迁移，但**尚未开始修改 Skill**。目标兼容基线是已配置的远程 MySQL 8.0.26；本地 MySQL 5.7 不作为通过标准。

## 已完成

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| 远程目标能力只读探测 | PASS | MySQL 8.0.26、服务端 `utf8mb4_0900_ai_ci`、数据库 `utf8mb4_general_ci` 等记录于 `target-mysql-profile.json` |
| 远程现状复核 | PASS | `ai_security` 中 36 张 `audit_*` 表均为 `utf8mb4_general_ci`；视图和 schema seed 尚未应用 |
| 远程解析器检查 | PASS | 远程 8.0.26 以 `PREPARE/DEALLOCATE` 解析 36 个 `CREATE TABLE` 和 4 个 `ALTER TABLE`，未执行 `EXECUTE` |
| 核心 DDL 清单 | PASS | 36 表、2 视图、15 张延期表未进入候选迁移 |
| 契约静态一致性 | PASS | 206 个具名约束、32 个投影事件；JSON 契约、表 allowlist、DDL 哈希一致 |
| 生成可重复性 | PASS | `generate-core-ddl.cjs` 重复生成内容稳定 |
| Skill 现有回归测试 | PASS | 两个现有 JavaScript 校验器共 65/65 通过；本轮未修改 Skill |
| 远程核心 schema 变更 | PASS | 已创建 36 张表并完成 227 个文本列、36 个表默认排序规则迁移；未创建视图、账号或权限 |

当前候选 DDL：

```text
contract_version = 1.3.0
database_contract = 1.3.0-core-draft
ddl_sha256 = 02b953a0fd48274390c15659cfdcb9c6595d4a14460569f485416baf9afe7581
ddl_body_sha256 = 6e9c0af3b51be034a802a9aa547182b181a7adf326265a4be7730452c15d7f46
```

## 尚未完成的硬门禁

| 门禁 | 为什么必须完成 | 完成条件 |
| --- | --- | --- |
| 视图与 schema seed | 当前按最小建表授权尚未应用 | 用户单独批准后执行 2 个视图和 1 条 schema seed，并通过验收 |
| 最小权限 Writer | 当前配置账号拥有 `ai_security.*` 的广权限和 `GRANT OPTION` | 建立独立 Writer，并证明 DDL、DELETE、GRANT 与其他数据库访问失败 |
| TLS 身份校验 | 当前连接已加密，但 `VERIFY_IDENTITY` 缺可信 CA/匹配主机名 | 使用可信 CA 与证书匹配主机名成功连接 |
| 迁移版本最终冻结 | 当前数据库契约仍标记 `core-draft` | 正式执行验收后冻结非 draft 版本并重新计算全部哈希 |
| 后续远程 DDL 单独授权 | DDL 自动提交，失败恢复成本高 | 用户在执行前明确批准具体目标和对象 |

## 下一步唯一安全顺序

```text
核心表与排序规则迁移已完成
→ 如需要，用户批准后补齐视图和 schema seed
→ 修复（如有）并冻结非 draft 契约
→ 验证最小权限 Writer 与 TLS VERIFY_IDENTITY
→ 远程建表并验收
→ 按同一契约修改 Skill
```

在上述硬门禁完成前，任何人都不应把候选 SQL 直接导入远程 `ai_security`，也不应让 Skill 按未冻结的列或事件名开始写库。
