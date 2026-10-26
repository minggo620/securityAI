# 1.3.0-core 数据库迁移门禁与运行手册

## 当前结论

- 目标远程数据库已只读确认是 MySQL 8.0.26。
- `ai_security` 已有 36 张 `audit_*` 核心表，表和 utf8mb4 文本列均为 `utf8mb4_general_ci`。
- 当前配置账号权限过高，不能作为运行时 Writer。
- 远程连接虽协商 TLS 1.3，但 `VERIFY_IDENTITY` 尚因可信 CA 缺失而失败。
- 远程 8.0.26 已通过只读 `PREPARE/DEALLOCATE` 解析 36 个 `CREATE TABLE` 和 4 个 `ALTER TABLE`；核心表 DDL 和排序规则迁移已执行。视图、seed 和约束行为仍未全部验证。
- 本文件不授权任何后续 DDL；补齐视图或 seed 需要用户针对目标、版本和操作再次明确授权。

## A. 项目远程数据库正式执行前检查

项目远程 `ai_security` 是本方案的目标数据库。由于本项目明确不使用隔离库，必须先完成本节只读检查，并在执行 DDL 前由用户单独明确批准目标、版本和操作。

验证前检查：

```sql
SELECT VERSION(), @@character_set_server, @@collation_server, @@sql_mode,
       @@lower_case_table_names, @@innodb_strict_mode,
       @@explicit_defaults_for_timestamp, @@max_allowed_packet,
       @@character_set_database, @@collation_database;
```

期望：

```text
version                       8.0.26
character_set_server          utf8mb4
collation_server              utf8mb4_0900_ai_ci
lower_case_table_names        0
innodb_strict_mode            1
explicit_defaults_for_timestamp 1
max_allowed_packet            >= 5242880
character_set_database        utf8mb4
collation_database            utf8mb4_general_ci
```

执行规则：

1. 使用获批的迁移账号；运行时 Writer 仍必须是独立最小权限账号。
2. 使用受保护 defaults file；命令行、日志和文档不得出现密码。
3. 客户端强制 `VERIFY_IDENTITY`，提供可信 CA 和与证书匹配的主机名。
4. 不使用 `--force`，不关闭 `foreign_key_checks`。
5. 对后续变更执行精确 SQL；任意错误立即停止。
6. DDL 自动提交，失败时不得盲目重跑；保留失败现场，按精确变更单和恢复方案处理。

## B. 执行后验收 SQL

```sql
SELECT COUNT(*) AS base_tables
FROM information_schema.tables
WHERE table_schema = DATABASE() AND table_type='BASE TABLE' AND table_name LIKE 'audit\_%';

SELECT COUNT(*) AS views
FROM information_schema.views
WHERE table_schema = DATABASE() AND table_name LIKE 'audit\_%';

SELECT COUNT(*) AS foreign_keys
FROM information_schema.referential_constraints
WHERE constraint_schema = DATABASE() AND table_name LIKE 'audit\_%';

SELECT table_name
FROM information_schema.tables
WHERE table_schema = DATABASE() AND table_name LIKE 'audit\_%'
ORDER BY table_name;

SELECT version, HEX(ddl_sha256), schema_version, applied_at
FROM audit_schema_version;
```

必须满足：

- 36 张 `audit_*` 基础表。
- 当前核心表验收阶段为 0 个视图；若执行完整扩展，则必须为 2 个视图。
- 表名与 `verify-contract.cjs` 的 allowlist 完全一致。
- 不存在 15 张延期表。
- 当前 schema seed 行数为 0；若执行完整扩展，则必须存在 `audit_schema_version.version=1.3.0-core-draft`。
- CHECK 约束在 MySQL 8.0.26 实际拒绝非法 telemetry mode、非法 verdict 和错误人工标签组合。

## C. 最小行为测试

在项目远程数据库完成建表后，使用不含真实源码、凭据或审计结果的合成数据进行最小行为测试：

1. 插入 run、payload、event，验证 UTC 时间和 UTF-8。
2. 重复 `idempotency_hash` 必须失败。
3. Observation 可在 `candidate_id=NULL` 时插入；合并后可以更新 candidate ID。
4. Hypothesis merge/split 可以表达多对多关系。
5. P3 validation 缺 hypothesis version 必须失败。
6. P5 validation 缺 finding revision 必须失败。
7. Hypothesis 人工标注不能使用 Finding validity 标签，反之亦然。
8. version/current pointer 必须属于同一父对象。
9. 删除被引用的历史对象必须被 RESTRICT 拒绝。
10. 两个视图只能读取冻结事实，不得把 latest score 当作首次预测。

测试数据必须使用专用测试 run 标识并按用户批准的清理方案处理；不得执行无 WHERE 的 DELETE。

## D. 远程 `ai_security` 正式建表门禁

只有 A–C 全部通过后，才准备远程变更：

1. 重新只读确认远程已有 36 张 `audit_*` 表且排序规则统一为 `utf8mb4_general_ci`；如果不一致，停止并做 schema reconciliation。
2. 固化 DDL 文件 SHA-256、生成器 SHA-256、四个 JSON 契约 SHA-256。
3. 如果补齐视图或 seed，形成变更单：目标数据库、对象清单、预计锁影响、恢复方案。
4. 不得自动 DROP 已有核心表；失败现场保留，由用户另行批准精确恢复操作。
5. 用户必须在执行前明确批准远程 DDL。
6. 执行后运行 B 节验收，并保存不含凭据的结果。

## E. 账号分离

当前配置账号只用于获批迁移或只读检查，不用于 Skill Writer。正式 Writer 使用独立账号：

| 表类型 | Writer 权限 |
| --- | --- |
| `audit_schema_version` | `SELECT` |
| append-only event/version/relation/observation/revision 表 | `SELECT, INSERT` |
| run、phase、task、coverage、hypothesis、candidate、validation、finding 当前投影 | `SELECT, INSERT, UPDATE` |
| payload/artifact 保留状态 | `SELECT, INSERT, UPDATE`，UPDATE 仅允许受控状态/清理字段 |
| 所有 `audit_*` | 禁止 `DELETE, ALTER, DROP, INDEX, REFERENCES, TRIGGER` |
| 数据库/全局 | 禁止 `GRANT, CREATE USER, FILE, PROCESS, SUPER` 及其他数据库访问 |

Writer defaults file 权限必须为 `0600`，不得是符号链接；必须包含 CA、匹配证书的主机名和 `ssl-mode=VERIFY_IDENTITY`。
