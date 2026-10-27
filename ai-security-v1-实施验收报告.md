# ai-security-v1 过程采集与数据库对接实施验收报告

> 验收日期：2026-10-27（Asia/Shanghai）  
> 数据库结构：`1.3.0-core`  
> Telemetry 协议：`1.4.0`  
> 最终 Skill 文件：42 个；运行时清单 SHA-256 `92cd8f568d517434ee5ce9affaefd474fd9c0391c6d9e5620ff8058328b306ea`

## 1. 结论

第一版核心修改已完成。原 P1–P6 审计文件与两个原有校验器仍是裁决权威；新增 P0、Agent `_process`、Hunter 两检查点、本地 Outbox、五个 Parent CLI 接口、32 类事件投影和 Parent 记录点直写 database-client 均作为旁路实现。此次修改没有执行 DDL、没有创建视图、没有补 schema seed，也没有更改现有 36 张表。

数据库或过程采集失败不会改变 `confirmed`、`needs_validation` 或 `rejected`。`off` 模式不创建 Telemetry 目录；默认完整审计为 `local + best_effort`；远程同步要求明确授权。

## 2. 已实现能力

- `SKILL.md` 增加 P0、Telemetry 模式和旁路不变量。
- Recon、Hunter、Critic、Verifier 保留原核心结果，并增加独立 `_process` sidecar。
- `agent-adapter.cjs`自动验证并规范化Agent sidecar；Parent只提交可信上下文，Agent不能生成数据库ID、投影或SQL。
- Hunter 分为 `hunter_plan` 和 `hunter_result`，验证前评分在针对性验证前冻结。
- 运行时重算验证前评分，强制阶段、必需业务投影和因果前驱；Verifier独立性由任务ID集合机械校验。
- 五个接口：`init-run`、`record-event`、`record-snapshot`、`flush-outbox`、`finalize-run`。
- Outbox 记录 canonical envelope 字节数、envelope SHA-256、前序记录哈希和当前记录哈希；完整追加后 `fsync`。
- checkpoint 必须精确匹配 Outbox 链；尾部半行可恢复，中间损坏、哈希或长度不符会阻断重放。
- 同一幂等键/同一稳定请求返回 `already_applied`；Agent实体ID确定性派生，部分重试保持同一因果链；同键不同请求进入冲突/死信处理。
- 运行时四份 schema/projection 与外部契约逐字节一致。
- database-client 不导出任意 SQL 接口，只能使用事件表 allowlist、固定数据库、MySQL 8.0.26、固定 36 表/527 列指纹、102个外键、104个CHECK、排序规则指纹、prepared INSERT、CAS UPDATE、幂等 SELECT 和事务控制；连接与操作均有超时。
- 凭据、认证头、私钥、连接串、完整环境、主机绝对路径和隐藏推理不进入 retained payload。

## 3. 自动化验收结果

| 验收项 | 结果 |
| --- | --- |
| 原 Findings 校验器 | 34/34 PASS |
| 原 Coverage Ledger 校验器 | 31/31 PASS |
| 原流程合计 | 65/65 PASS |
| 新 Telemetry 单元与接口测试 | 24/24 PASS |
| `verify-contract.cjs` | PASS；32 类事件、36 表 |
| `verify-skill-db-alignment.cjs` | PASS；527 字段、13 来源契约、179 规范化目标 |
| Skill `quick_validate.py` | PASS |
| 运行时/外部契约副本 | 4/4 逐字节一致 |
| HTML 内联 JavaScript 语法 | PASS |
| HTML 外部 HTTP/HTTPS 请求 | 0 |
| Skill 项目/远程清单 | 42个文件；运行时哈希与最终远程run一致 |

Telemetry 测试覆盖：ULID 单调性、canonical JSON、完整 schema、远程授权、脱敏、5 MiB 上限及完整内容哈希、循环对象 blocked、幂等键规范化、Agent结果自动接入与重复提交、危险源码路径、Outbox 链、尾部恢复、篡改检测、checkpoint 对齐、业务投影必需性、阶段/因果顺序、评分重算、Verifier独立性、表 allowlist、CAS、`off`、`local`、远程断线 `best_effort` 以及五个 Parent CLI 接口。

## 4. 远程 ai_security 验收

获用户明确授权后，使用合成标识执行真实远程投影：

```text
repo   = __ai_security_v1_acceptance__
run_id = 01M5XQ45SQF7W1B4MDGQ4XQB9Y
```

验证结果：

- MySQL `8.0.26`，TLS cipher 已协商；TLS 身份未验证仍记录为 accepted risk。
- 36 表、527 列、102个外键、104个CHECK、36张`utf8mb4_general_ci`表及227个utf8mb4字符列与固定契约一致。
- run 最终状态为 `complete / synced / empty`，`row_version=3`。
- 42 条事件实际覆盖projection map的32/32种事件类型；没有用静态声明代替远程写入。
- 真实写入了模型任务、假设版本、验证前评分、攻击计划、实际执行、candidate、独立 validation、decision、finding revision 和人工 adjudication。
- 内部 Finding 为 `confirmed`，人工 adjudication 独立记录为 `false_positive`，证明两类标签没有混用。
- P0 envelope重复投递返回`already_applied`；本地Agent自动适配重复提交也返回`already_applied`且Outbox不增长。
- 最终run保存的Skill清单哈希与当前项目运行时代码完全相同：`92cd8f568d517434ee5ce9affaefd474fd9c0391c6d9e5620ff8058328b306ea`。

合成数据按用户要求保留，运行时 database-client 不具备删除能力；后续可按 repo、run ID 和时间范围由单独获批的管理操作清理。

## 5. 主流程安全性结论

原 65 项测试全部通过，说明原 Findings 与 Coverage Ledger 机器门禁没有因 Telemetry 修改而改变。Telemetry `off` 测试证明原流程可以不创建任何旁路状态；远程断线测试证明事件仍先安全落地 Outbox，返回 `pending_sync`，checkpoint 不前进；数据库不参与漏洞裁决。

本轮没有实际运行一次完整目标代码审计，因此“同一个真实/合成代码库分别以 off、local、remote 三种模式执行完整 P1–P6 后比较最终业务文件”属于下一次 Skill 试运行验收，而不是数据库或 database-client 结构缺口。大规模并发、Outbox 轮转和长期容量基线也属于后续强化项。

