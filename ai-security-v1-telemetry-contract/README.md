# ai-security-v1 Telemetry Contract 1.3.0

本目录是“创建数据库表”和“修改 Skill”共同依赖的前置契约包。它不连接 MySQL、不执行建表，也不修改 `ai-security-v1` Skill。

## 文件

- `001_ai_security_core_schema.sql`：36 张核心表和两个只读视图的候选 DDL，由生成器产生。
- `generate-core-ddl.cjs`：从已审查的逻辑模型提取稳定表，并应用 1.3.0 修订；输出必须可重复。
- `event-envelope.schema.json`：Parent→Outbox→Writer 的事件信封。
- `telemetry-config.schema.json`：off/local/remote 与 best_effort/required 配置。
- `agent-process-extension.schema.json`：后续修改 Skill 时使用的显式过程扩展；不允许隐藏思维链。
- `projection-map.json`：事件类型到 36 张核心表的确定性投影 allowlist。
- `target-mysql-profile.json`：对已配置远程 `ai_security` 的只读能力快照，不含凭据。
- `generate-remote-prepare-probe.cjs`：生成只执行 `PREPARE/DEALLOCATE`、绝不执行候选 DDL 的远程 8.0.26 语法探针。
- `verify-contract.cjs`：静态一致性、安全和可重复性检查。
- `MIGRATION-RUNBOOK.md`：项目远程数据库迁移、回滚准备和权限验证步骤。
- `SKILL-MODIFICATION-GATE.md`：修改 Skill 前必须满足的契约和不变量。
- `CONTRACT-STATUS.md`：已完成验证、剩余硬门禁和当前 DDL 哈希的一页式状态。

## 当前状态

`001_ai_security_core_schema.sql` 是候选执行 DDL，不是已验证迁移。只有同时满足以下门禁后才允许建表：

1. `node verify-contract.cjs` 通过。
2. 生成器重复运行后 SQL SHA-256 不变。
3. 在项目远程 MySQL 8.0.26 数据库完整执行成功。
4. 36 张表、外键、CHECK、索引和两个视图与本目录清单一致。
5. 重复执行必须按迁移策略明确失败或被迁移管理器识别为已应用，不能静默覆盖。
6. 使用迁移账号执行；运行时 Writer 的 DDL、GRANT、DELETE 和其他数据库访问必须失败。
7. 未在远程 `ai_security` 执行任何 DDL/DML，除非用户针对具体操作另行明确授权。

远程只读语法探针覆盖 36 个 `CREATE TABLE` 和 4 个 `ALTER TABLE`，证明目标 MySQL 能解析这些语句；它不创建对象，也不验证 2 个视图、schema seed、外键引用、CHECK 和事务行为。视图在 `PREPARE` 阶段会解析尚不存在的基础表，因此必须在项目远程数据库的正式 DDL 操作中验证。

```bash
node generate-remote-prepare-probe.cjs > /受控临时目录/prepare-probe.sql
```

必须使用受保护的客户端配置执行，且脚本中不得出现 `EXECUTE audit_probe_stmt`。

远程只读探测已确认目标是 MySQL 8.0.26、服务端默认 `utf8mb4_0900_ai_ci`，且当前不存在 `audit_*` 表。当前连接协商到 TLS 1.3，但 `VERIFY_IDENTITY` 因缺少可信 CA 配置而失败；服务端也没有强制安全传输。当前配置账号拥有 `ai_security.*` 的 ALL PRIVILEGES 和 GRANT OPTION，不能作为正式运行时 Writer。上述两项是远程 Writer 启用前的阻断条件。

本机 MySQL 5.7.24 只用于降级烟雾测试：替换 8.0 专用排序规则后曾成功创建旧版表结构。它不作为当前 1.3.0 的通过标准，也不能证明项目远程 MySQL 8.0.26 上的 CHECK、视图和权限行为。

## 后续顺序

```text
冻结本契约
→ 用户明确批准后在项目远程 MySQL 8.0.26 执行 DDL
→ 修复并重新冻结（如有）
→ 创建最小权限 Writer 账号方案
→ 修改 Skill 返回契约与 P0–P6 记录点
→ 实现 Outbox/Writer
→ 合成运行验证文件↔事件↔数据库投影
→ 单独授权后部署远程数据库
```
