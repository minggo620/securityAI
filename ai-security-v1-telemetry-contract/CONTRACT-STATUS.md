# Telemetry Contract 1.3.0 验证状态

更新时间：2026-10-26（Asia/Shanghai）

## 结论

当前已具备“数据库迁移与 Skill 修改使用同一机器契约”的前提，但**尚不允许在远程 `ai_security` 建表，也尚不开始修改 Skill**。目标兼容基线是已配置的远程 MySQL 8.0.26；本地 MySQL 5.7 不作为通过标准。

## 已完成

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| 远程目标能力只读探测 | PASS | MySQL 8.0.26、`utf8mb4_0900_ai_ci`、严格模式等记录于 `target-mysql-profile.json` |
| 远程现状复核 | PASS | `ai_security` 中 `audit_*` 表数量为 0；只读探针后再次复核仍为 0 |
| 远程解析器检查 | PASS | 远程 8.0.26 以 `PREPARE/DEALLOCATE` 解析 36 个 `CREATE TABLE` 和 4 个 `ALTER TABLE`，未执行 `EXECUTE` |
| 核心 DDL 清单 | PASS | 36 表、2 视图、15 张延期表未进入候选迁移 |
| 契约静态一致性 | PASS | 206 个具名约束、32 个投影事件；JSON 契约、表 allowlist、DDL 哈希一致 |
| 生成可重复性 | PASS | `generate-core-ddl.cjs` 重复生成内容稳定 |
| Skill 现有回归测试 | PASS | 两个现有 JavaScript 校验器共 65/65 通过；本轮未修改 Skill |
| 远程数据变更 | NONE | 未执行 DDL/DML，未创建表、视图、账号或权限 |

当前候选 DDL：

```text
contract_version = 1.3.0
database_contract = 1.3.0-core-draft
ddl_sha256 = 0f1b6eddc44250ca63d9d2739314db789ceb07472a12a38354f2053f9f500a26
ddl_body_sha256 = f6805891190002ed87c7f2b85e36c8555e582b8063a2143cb2869f461a78c40d
```

## 尚未完成的硬门禁

| 门禁 | 为什么必须完成 | 完成条件 |
| --- | --- | --- |
| 项目远程 MySQL 8.0.26 完整执行 | `PREPARE` 不验证视图依赖、seed、外键和 CHECK 的真实行为 | 用户明确批准后在项目远程执行完整 DDL，并通过 `MIGRATION-RUNBOOK.md` A–C |
| 最小权限 Writer | 当前配置账号拥有 `ai_security.*` 的广权限和 `GRANT OPTION` | 建立独立 Writer，并证明 DDL、DELETE、GRANT 与其他数据库访问失败 |
| TLS 身份校验 | 当前连接已加密，但 `VERIFY_IDENTITY` 缺可信 CA/匹配主机名 | 使用可信 CA 与证书匹配主机名成功连接 |
| 迁移版本最终冻结 | 当前数据库契约仍标记 `core-draft` | 正式执行验收后冻结非 draft 版本并重新计算全部哈希 |
| 远程 DDL 单独授权 | DDL 自动提交，失败恢复成本高 | 用户在执行前明确批准目标 `ai_security`、36 表和 2 视图的建表操作 |

## 下一步唯一安全顺序

```text
用户批准项目远程 DDL
→ 在项目远程 MySQL 8.0.26 完整执行候选 DDL 与行为测试
→ 修复（如有）并冻结非 draft 契约
→ 验证最小权限 Writer 与 TLS VERIFY_IDENTITY
→ 远程建表并验收
→ 按同一契约修改 Skill
```

在上述硬门禁完成前，任何人都不应把候选 SQL 直接导入远程 `ai_security`，也不应让 Skill 按未冻结的列或事件名开始写库。
