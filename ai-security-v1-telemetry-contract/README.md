# ai-security-v1 Telemetry Protocol 1.4.0 / Database Schema 1.3.0-core

本目录是数据库结构和Skill过程采集共同依赖的机器契约包。数据库结构已冻结为`1.3.0-core`；event/config/Agent/Writer协议为`1.4.0`。契约验证本身不连接MySQL、不执行DDL。

## 文件

- `001_ai_security_core_schema.sql`：36 张核心表和两个只读视图的候选 DDL，由生成器产生。
- `generate-core-ddl.cjs`：从已审查的逻辑模型生成冻结的1.3.0-core数据库结构；输出必须可重复。
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

`001_ai_security_core_schema.sql` 是冻结的核心 schema 参考 DDL；36 张核心表已经在项目远程数据库应用，两个只读视图和 schema seed 仍未应用。后续变更仍需满足以下门禁：

1. `node verify-contract.cjs`通过；输出同时标明协议版本和数据库结构版本。
2. 生成器重复运行后 SQL SHA-256 不变。
3. 核心表迁移和排序规则迁移在项目远程 MySQL 8.0.26 数据库执行成功。
4. 36 张表、外键、CHECK、索引与本目录清单一致；视图和 schema seed 是否应用必须单独标记。
5. 重复执行必须按迁移策略明确失败或被迁移管理器识别为已应用，不能静默覆盖。
6. 第一版使用现有账号属于用户接受风险；运行时Writer代码仍必须拒绝DDL、GRANT、DELETE、动态表名和其他数据库访问。
7. 任何后续远程 DDL/DML 都必须由用户针对具体操作另行明确授权。

远程只读语法探针覆盖 36 个 `CREATE TABLE` 和 4 个 `ALTER TABLE`，证明目标 MySQL 能解析这些语句；它不创建对象，也不验证 2 个视图、schema seed、外键引用、CHECK 和事务行为。视图在 `PREPARE` 阶段会解析尚不存在的基础表，因此必须在项目远程数据库的正式 DDL 操作中验证。

```bash
node generate-remote-prepare-probe.cjs > /受控临时目录/prepare-probe.sql
```

必须使用受保护的客户端配置执行，且脚本中不得出现 `EXECUTE audit_probe_stmt`。

远程只读探测已确认目标是 MySQL 8.0.26；服务端默认排序规则为 `utf8mb4_0900_ai_ci`，数据库和已应用的36张`audit_*`表统一为`utf8mb4_general_ci`。当前没有`audit_*`视图和schema seed，第一版也不要求它们。连接协商到TLS 1.3，但`VERIFY_IDENTITY`因缺少可信CA配置而失败；当前账号拥有`ai_security.*`的ALL PRIVILEGES和GRANT OPTION。用户已将后两项作为第一版`accepted_risk`，不再阻止Skill实施；Writer仍必须执行应用层SQL/表/列allowlist，并如实记录风险。

本机MySQL 5.7.24客户端只用于连接和降级烟雾测试，不是数据库结构验收标准。数据库行为以远程MySQL 8.0.26为准。

## 已完成实施顺序

```text
数据库结构1.3.0-core已冻结并应用
→ Telemetry协议1.4.0与P0–P6记录点
→ 本地Outbox/Writer实现和单元测试
→ 原Skill回归与文件↔事件一致性测试
→ 获授权后在远程ai_security执行合成投影验收
```

上述五步均已完成。远程验收 run 为 `01M5WJHH0GWHDBZP15X9NBHV6Y`；更大规模容量、并发和多分支批量矩阵属于后续强化，不改变第一版核心实现状态。
