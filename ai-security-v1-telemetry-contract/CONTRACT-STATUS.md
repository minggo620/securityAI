# Telemetry协议1.4.0 / 数据库结构1.3.0-core状态

更新时间：2026-10-27（Asia/Shanghai）

## 结论

远程`ai_security`已部署36张核心`audit_*`表，数据库结构保持`1.3.0-core`；Skill过程采集协议升级为`1.4.0`。本次Skill修改不执行DDL、不创建视图、不补schema seed。

## 已完成

| 项目 | 状态 | 说明 |
|---|---|---|
| 远程版本 | PASS | MySQL 8.0.26 |
| 核心表 | PASS | 36/36 |
| 排序规则 | PASS | 表及227个utf8mb4文本列为`utf8mb4_general_ci` |
| ASCII标识与外键 | PASS | 142个`ascii_bin`列，102个外键；104个CHECK约束 |
| 核心约束冒烟 | PASS | CHECK、FK、幂等、P3/P5输入、关系与人工标签 |
| 原Skill基线 | PASS | 65/65测试通过 |
| Telemetry协议 | IMPLEMENTED | 1.4.0 schemas、Outbox、Writer、P0–P6接口 |
| 运行时协议副本 | PASS | 4份schema/projection与外部契约逐字节一致 |
| 固定列契约 | PASS | 36表、527列，SHA-256 `6e59feddd4f17ee8269c847a2954a3d8228b37cffeb9e4a722cf1ad58c4634f3` |
| Telemetry单元/接口测试 | PASS | 24/24；新增业务投影必需性、阶段、因果顺序、评分重算、Verifier独立性、Outbox请求幂等、超限控制保留和Agent自动适配 |
| Skill快速校验 | PASS | `quick_validate.py`在临时PyYAML路径运行通过，未修改用户Python环境 |
| Agent过程自动接入 | PASS | `record-event`直接接收核心结果、`_process`与可信上下文；`agent-adapter.cjs`生成实体ID、32类事件中的角色投影和完成事件 |
| 远程32类事件矩阵 | PASS | 最终run `01M5XQ45SQF7W1B4MDGQ4XQB9Y`，42条事件覆盖32/32种类型，最终`complete/synced/empty` |
| Skill清单哈希 | PASS | 最终run保存值与项目运行时代码一致：`92cd8f568d517434ee5ce9affaefd474fd9c0391c6d9e5620ff8058328b306ea` |
| 远程幂等重放 | PASS | 相同P0 envelope返回`already_applied`，未产生重复版本 |
| 内部/人工标签分离 | PASS | 合成Finding为confirmed，人工adjudication独立记录false_positive |
| 数据库结构 | FROZEN | 1.3.0-core，无本轮DDL |
| 视图 | NOT_REQUIRED_V1 | 0个 |
| schema seed | NOT_REQUIRED_V1 | 0条 |

数据库DDL基线：

```text
ddl_sha256 = 02b953a0fd48274390c15659cfdcb9c6595d4a14460569f485416baf9afe7581
ddl_body_sha256 = 6e9c0af3b51be034a802a9aa547182b181a7adf326265a4be7730452c15d7f46
```

## 用户接受的非阻断风险

| 项目 | 状态 | 运行时处理 |
|---|---|---|
| TLS服务端身份未验证 | ACCEPTED_RISK | `PREFERRED`，记录`tls_identity_not_verified`，不伪称安全通过 |
| 当前账号权限较大 | ACCEPTED_RISK | 记录`broad_database_account`；Writer代码限制表、列和SQL类别 |

## 启用远程Writer前仍必须满足

- 本次运行具有明确`remote_mysql`授权或可审计组织策略。
- 本地Outbox已经安全落盘。
- MySQL 8.0.26、36表、527列及固定列指纹、102个外键、104个CHECK、36张`utf8mb4_general_ci`表和227个utf8mb4字符列只读预检通过。
- `MYSQL_PWD`只在可信Parent启动的Writer环境中存在。
- 相同幂等键不得对应不同请求哈希；重复请求必须返回既有事件，远程数据库仍以envelope hash确认相同效果。

数据库和Outbox故障不能改变审计Verdict。完整审计默认remote/best-effort；事件先写本地Outbox，再投影到远程数据库；数据库暂时不可用时以pending_sync继续并在恢复后补传。
