# 流程与字段复核说明

## 结论

以当前本机安装的 security-audit 为边界，数据字典的主要阶段、字段、三种裁决和类别索引覆盖正确；本次补足了执行并行/条件分支、完整 Hunter prompt 组成和原文自身的解释缺口。不能据此声称 skill 已有完整的确定性执行状态机，或已经完整记录运行时的假设/调查轨迹。

| 核对对象 | 结果 | 依据 |
| --- | --- | --- |
| 38 个细分动作 | 六阶段与准备动作均有导航；P 编号仅为文档索引 | 四份核心 Markdown。 |
| findings 字段路径 | 46 个不同属性路径全部覆盖 | 当前 `report-schema.json`，包括嵌套对象/数组属性。 |
| ledger 必需字段 | 19 个全部覆盖，生命周期条件字段另列 | `validate-coverage-ledger.cjs` 的 REQUIRED_FIELDS。 |
| 分支矩阵 | 三种裁决的 17 个顶层字段必需/禁止关系一致 | schema 的 properties/required。 |
| 状态 | 8 个 live 状态、3 个 attempt 状态、11 个 prior 状态覆盖 | 校验器枚举与原文状态表。 |
| 攻击类别 | 162 项英文名称/原文片段与本地定义一致，中文说明均存在 | 九种普通类 + 十个专项文件。 |
| 来源版本 | 文档中 20 个 SHA-256 与当前文件一致 | 不宣称已核对 GitHub 最新版本或提交号。 |
| 来源定位 | 链接文件存在，引用行号在文件范围内 | 只验证引用位置，不自动证明语义解释正确。 |
| 合成格式检查 | 6 项语义边界检查通过 | 只测试校验器，不执行任何目标代码，不构造真实漏洞。 |

## 本次修正和明确的内容

| 项目 | 修正/说明 |
| --- | --- |
| 并行侦察 | 1a–1d 为并行事实任务，不能按 P1.2→P1.3→P1.4→P1.5 画串行执行。 |
| 调查迭代 | 提出/修订假设、深读路径和验证可迭代，P 编号不是模型内在推理顺序。 |
| 本地执行与晋升 | 明确是条件分支；source check 不生成 local artifact、不走晋升。 |
| architecture 刷新 | 原文没有明确自动增量更新时间；删除把后续同步暗示为已有实现的表述。 |
| Hunter prompt | 增加九部分输入要求，不能从最终报告推定实际 prompt 完整。 |
| 源规则歧义 | rejected 的最终复核范围、complete 标记时点、初始 metadata 补齐、critic 理由格式、拒绝候选后的覆盖状态、架构/事件更新，都明确列为解释缺口。 |
| 可点击展示 | 独立 HTML 以主流程、逐阶段子节点、字段/方法/类别目录导航；不改变原 skill。 |

## 机械 PASS 的边界

合成、无害的内存对象证明：不存在的源码路径、极大的行号、虚构观察文字、只满足格式的 artifact 路径与不存在的提示块，都可能通过对应单文件格式检查。一个 ledger 含候选指纹而 findings 为空时，两个脚本也能各自通过，因为没有联合外键校验。

这些测试说明校验器的责任范围，不是漏洞或审计结论。真实文件、命令执行、证据归属和根因真实性，仍需可信父端检查及独立 Agent 按规范核查。

## 原文无法完全确定的分支

| 问题 | 为什么不能声称已有确定实现 |
| --- | --- |
| rejected 是否逐条进入普通 Phase 5 | 明确派发集合只有 confirmed/NV，后续却使用 every retained record 的宽泛措辞。 |
| complete 是 P5 还是 P6 标记 | 最终复核章节和主终止条件有不同里程碑；导图按主契约区分审查完成与整体完成，但保留张力。 |
| 已拒绝候选单元自动变 covered | 没有统一的决策属性和强制状态转移。 |
| metadata 在 Recon 前如何写完整 | 部分信息依赖侦察，未指定占位结构和精确补齐时点。 |
| critic 返回理由如何逐项关联 | ID 数组没有统一理由子对象，但正文要求 source-backed reason。 |

实现 MySQL 接入前，应为这些位置选择明确、版本化的处理策略；不能把新策略伪称原 skill 已实现。

## 可复核的文件

- [完整数据字典](/Users/daitongmin/security/security-audit-skill-执行流程与数据字典.md)
- [交互流程导图](/Users/daitongmin/security/security-audit-skill-交互流程导图.html)
- [字段与语义核对脚本](/Users/daitongmin/security/tools/verify-security-audit-map.cjs)
- [导图数据提取脚本](/Users/daitongmin/security/tools/build-security-audit-map-data.cjs)

执行 `node tools/verify-security-audit-map.cjs` 可重新核对当前文档与来源。导图包含生成时快照，不会自动读取后续修改；源文档变化后需重新提取并更新内嵌数据。

## 交互和布局验证

| 检查 | 结果 |
| --- | --- |
| 1,142 个可导航节点（含逐分支字段绑定与语义冲突表） | 逐个渲染无脚本错误；默认不全部展开。 |
| 阶段、子步骤、字段详情、源码片段 | 实际浏览器点击通过。 |
| quick 分支、节点搜索、展开/收起 | 实际浏览器交互通过。 |
| 屏幕宽度 | 1400、1024、768、360、320 px 无横向页面溢出；修正了长英文路径在极窄屏的换行。 |
| 外观 | 已检查浅色和深色截图。 |
| 外部请求 | 测试期间无 HTTP/HTTPS 请求。 |
| 数据一致性 | 内嵌快照的字典摘要与当前 Markdown 一致。 |

交互测试使用本机已有 Chrome 的临时空白配置，不读取用户浏览器账户，也未下载浏览器。测试脚本为 [test-security-audit-map.cjs](/Users/daitongmin/security/tools/test-security-audit-map.cjs)。这些测试验证导航/展示功能，不验证一个真实审计执行器。

本次没有修改 skill 原文件、没有接入 MySQL、没有执行针对任何代码库的安全审计。复核基线为 2026-10-14 本机版本，而不是安全扫描完备性证明。

## 整体字段统计补充核对

新增的 Markdown 附录 E 和 HTML“整个 skill 字段统计”使用同一统计对象。数据库主口径改为 `contract_type + branch + full_path + schema_version`：7 类结构共有 416 个分支字段项；同一结构跨分支合并后的 282 条路径只用于浏览。85 个裸名称中有 58 个发生重复，仅作为词法碰撞诊断，严禁用于数据库去重。ledger 47 个路径、findings 46 个路径；建议 X 另计 91 个路径出现。

schema 和 JSON 模板自动遍历；metadata 的固定键、ledger 生命周期配对/历史尝试/检查对象的组合按原文及脚本规则显式映射。数字是该边界下的定义统计，不是动态运行日志，也不是可扩展 bookkeeping 的有限上限。参考 [字段统计脚本](/Users/daitongmin/security/tools/security-audit-field-stats.cjs) 和 [同步生成脚本](/Users/daitongmin/security/tools/update-security-audit-field-stats.cjs)。

本次重新核对了 79 张 Markdown 表、来源链接与行号、20 个原文件版本；416 个字段绑定均具有唯一身份键、非空语义角色，且定义行实际包含对应字段名。浏览器检查包括同名碰撞警告、高风险语义分离规则、Hunter candidate 的 proposed_verdict 字段及来源、所有 1,142 个节点和 320–1400 px 布局，未产生外部请求。
