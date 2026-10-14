# security-audit skill 执行流程、数据字典与调查轨迹采集说明

## 0. 文档范围与阅读规则

| 项目 | 说明 |
| --- | --- |
| 目的 | 在接入 MySQL 前，弄清每一步做什么、产生什么、字段有什么作用，以及假设、分析方法、验证方法和调查演进目前能记录到什么程度。 |
| 分析对象 | 当前本机安装的 `/Users/daitongmin/.codex/skills/security-audit/`，而不是把 Cloudflare 工业 harness 的额外能力混入 skill。 |
| 整理日期 | 2026-10-14，Asia/Shanghai。 |
| 使用模式 | 使用 security-audit 的指导模式核对契约；本次没有对某个项目执行完整安全审计。 |
| 版本依据 | 文件内容及附录中的 SHA-256。未把本机安装目录认定为 GitHub 最新提交；本次未确认其 Git 提交号。 |
| 已核对 | 主说明、侦察、Hunter、验证与报告、结果 schema、两个校验器、普通攻击类别和十个专项伴随文件。 |
| 测试文件 | 在附录登记其版本；不是审计流程阶段，也不意味着本次运行了这些测试。 |
| 当前交付 | 流程和数据说明文档，不安装 MySQL、不创建数据库、不修改 skill、不新增执行器。 |
| 全部的含义 | 覆盖该版本明文定义的阶段、输出、字段路径、状态与攻击类别；不承诺枚举 LLM 运行时可能采取的所有行为。 |

### 0.1 四类信息必须分开

| 标记 | 含义 | 示例 | 能否把它当作实际发生过？ |
| --- | --- | --- | --- |
| E：已有结构契约 | 提示词、schema 或脚本定义了明确字段/返回结构 | `trace[].kind`、`checks[].method` | 不能；必须看到具体运行产出。 |
| N：已有文字要求 | 要求做或记录，但没有统一 JSON 字段名或严格 schema | 侦察事实、排序理由、精确命令、沙箱限制 | 不能；可能未输出、只在自由文本中输出或执行不合规。 |
| O：运行时可观测 | 宿主/执行器可能提供的实际事件 | 工具调用、Agent 启停、退出码、文件版本 | 取决于平台是否开放并成功采集；skill 本身不保证提供。 |
| X：建议新增 | 为你的分析目标设计的补充记录 | `hypothesis_id`、`method_code`、`decision_event` | 当前 skill 没有这些统一字段，不得伪称已有实现。 |

重要边界：下文的流程是“规范要求的执行流程”，不是本次已执行的审计日志。记录的思考路径应是模型明确输出的分析摘要、证据、理由和实际行动轨迹；不能读取未公开的内部思考，也不能事后编造出一条完整推理链。后补总结必须标明是后补、何时生成、依据哪些记录。

### 0.2 核心来源索引

| 来源编号 | 实际文件 | 主要内容 |
| --- | --- | --- |
| S1 | [SKILL.md](/Users/daitongmin/.codex/skills/security-audit/SKILL.md) | 模式、运行配置、预算、隔离、证据标准、六阶段和终止条件。 |
| S2 | [RECONNAISSANCE.md](/Users/daitongmin/.codex/skills/security-audit/RECONNAISSANCE.md) | 四类基础侦察、历史输入、架构摘要、覆盖单元和状态约束。 |
| S3 | [HUNTING.md](/Users/daitongmin/.codex/skills/security-audit/HUNTING.md) | Hunter 提示词组装、调查方法、候选门槛、返回 JSON、合并和 critic 循环。 |
| S4 | [VALIDATION-AND-REPORTING.md](/Users/daitongmin/.codex/skills/security-audit/VALIDATION-AND-REPORTING.md) | 候选验证、三种裁决、最终复核、替换记录和报告。 |
| S5 | [report-schema.json](/Users/daitongmin/.codex/skills/security-audit/report-schema.json) | 最终发现记录的三分支字段契约。 |
| S6 | [validate-coverage-ledger.cjs](/Users/daitongmin/.codex/skills/security-audit/validate-coverage-ledger.cjs) | 覆盖字段、身份编码、状态、检查归属、历史尝试的机械校验。 |
| S7 | [validate-findings.cjs](/Users/daitongmin/.codex/skills/security-audit/validate-findings.cjs) | schema 解释器、裁决互斥、路径格式、trace 顺序、严重性上限。 |
| S8 | [ATTACK-CLASSES.md](/Users/daitongmin/.codex/skills/security-audit/ATTACK-CLASSES.md) | 九种普通攻击类别与专项文件选择入口。 |

### 0.3 再次复核结论与解释边界

| 项目 | 复核结论 |
| --- | --- |
| 字段完整性 | 以本地 schema/脚本/返回模板为边界逐项核对；字段名称覆盖不等于运行时一定产出，更不等于已记录全部调查过程。 |
| 执行顺序 | 本文 P 编号是索引，不是严格的全序：四类基础侦察并行；历史比较可与侦察准备交织；Hunter 的分析、假设修订和检查可迭代。 |
| 条件执行 | 本地检查只在需要且全部隔离条件具备时执行；artifact 晋升只适用于确实产生并需保留的本地证据；源码检查不走晋升。 |
| 原文歧义 | rejected 的 Phase 5 范围、complete 标记时点、初始 metadata 的信息补齐、critic 理由的返回格式和拒绝候选后的单元状态，原文没有完全统一；见第 12.1 节。 |
| 可视化用途 | 另存交互导图，用节点显示职责、思路、字段、来源和条件分支；是规范导航，不是实际运行记录，也不是新增编排实现。 |

## 1. 原有机制是什么，数据库应观察什么

| 层次 | skill 已提供 | skill 没有随包提供 | 对过程分析的影响 |
| --- | --- | --- | --- |
| 工作流层 | Markdown 定义角色、步骤、约束和返回契约 | 一个自动强制所有阶段的完整编排程序 | 需要对照实际日志判断模型是否按规范执行。 |
| 分析层 | 以主体、能力、输入、控制、路径、边界结果为核心的调查方法 | 自动保证事实完整或假设可靠的形式化求解器 | 不能把“要求追踪”当成“已经正确追踪”。 |
| 验证层 | 新 Agent 尝试反驳候选；重大替换需再独立验证 | 内置任意目标的 PoC、测试环境或安全扫描器集成 | 必须记录实际使用了什么工具、检查和证据。 |
| 结构校验层 | 两个零第三方依赖的 Node.js 校验器 | MySQL 写入器、日志服务和完整事件模型 | 校验器输出应作为过程事件采集，不是数据库自动同步。 |
| 结果层 | 覆盖账本、三种发现记录和三份报告 | 从最初怀疑到最终结论的完整假设版本历史 | 只导入最终文件不能还原全过程。 |
| 工具层 | 允许满足隔离要求后的本地测试、sanitizer、fuzzer、浏览器等 | 统一 `tool_name`/工具版本/调用事件字段，也没有保证这些工具已安装 | 方法要求、工具可用性、真实调用必须分别记录。 |

## 2. 执行角色与责任

| 角色 | 平台角色称呼 | 输入 | 做什么 | 返回/输出 | 是否拥有统一输出字段 | 来源 |
| --- | --- | --- | --- | --- | --- | --- |
| Parent | 父 Agent/协调者 | 用户范围、目标、全部子任务返回和历史产出 | 初始化、组装提示词、分配、合并、写共享文件、更新账本、执行校验 | 七个共享文件及任务调度 | 部分 E，部分 N | S1、S2、S3、S4 |
| Recon 1a | `research` | 源码、文档、构建定义 | 产品、技术栈、入口、离线运行方式 | 带 `file:line` 的事实 | N，没有独立 JSON schema | S2:9 |
| Recon 1b | `research` | 身份、授权、隔离代码 | 主体、权限、资源、控制与边界 | 边界与控制位置 | N | S2:22 |
| Recon 1c | `research` | 接口、解析和消费路径 | 输入入口、转换、衍生副本、sink | 路径清单与限制 | N | S2:35 |
| Recon 1d | `research` | 测试、配置、部署与平台能力 | 本地验证可行性、不可见部署事实、沙箱和证据晋升能力 | 可行检查、禁止操作、缺失条件 | N | S2:44 |
| 聚焦 Recon | `research` | 尚未映射的子系统/部署模式 | 补充基础侦察未覆盖的实质差异 | 补充事实 | N，数量按目标和预算增减 | S2 |
| Hunter | `general` | 架构、覆盖单元、选中攻击块、排除项与隔离约束 | 形成调查假设、追踪、检查、最小本地验证、返回候选或覆盖结果 | 一个结构化 JSON | E | S3 |
| Post-wave critic | 新 `research` | 架构、完整账本、候选、历史缺口 | 找覆盖缺口、无根据关闭、需要重派的单元 | `missing_units` 等 JSON | E，提出覆盖工作而不是最终漏洞 | S3:221 |
| Final-clean critic | 与上一 critic 不同的新 `research` | 同类覆盖状态 | standard/deep 的最终覆盖复查 | 同类 critic JSON | E | S3 |
| Phase 3 verifier | 新 `general`，不能是发现该候选的 Hunter | 候选、必要架构事实、相关检查/证据和 schema | 尝试反驳、重读源码、可行时独立复现、修正裁决 | `decision` + `record` | E | S4:3 |
| Phase 5 verifier | 新 `research` | 最终结构化记录 | 核对引用、条件、结果、风险和修复；不只复核 confirmed | `verified` 或 `replace` | E | S4:120 |
| 重大替换 verifier | 未参与发现、Phase 3 或提出替换的新 verifier | 完整替换记录 | 重新验证重大变化；必要时形成下一次替换 | `verified` 或 `replace` | E | S4 |
| Ledger validator | Node.js 脚本，不是 Agent | `coverage-ledger.json` | 检查结构和记录一致性 | stdout/stderr 与退出码 | O，输出不是统一 JSON | S6 |
| Findings validator | Node.js 脚本，不是 Agent | `findings.json` + 同目录 schema | 结构与有限语义约束校验 | stdout/stderr 与退出码 | O，输出不是统一 JSON | S7 |

角色名称并不等于数据库里的实际 Agent 实例 ID。`research`/`general` 是平台中性角色；“Recon 1a”是职责标签，实际实例标识必须从运行平台或你的执行器采集。

## 3. 全流程逐步表

这里的 P0、P1.1 等是本文索引，不是 skill 内置阶段字段，也不是所有动作必须严格串行的时间线。P1.2–P1.5 是并行基础侦察；P2.3–P2.5 是按证据迭代的调查动作。

| 步骤 | 执行者 | 输入 | 实际应做的事情 | 输出/字段 | 条件与后续 | 来源 |
| --- | --- | --- | --- | --- | --- | --- |
| P0.1 模式与范围 | Parent | 用户请求 | 判断 guidance/full；明确目标、范围、输出目录与源码版本 | `target`、`source_ref`、`profile`、`scope_paths` | 本文只说明 full 模式规范；不触发实际审计 | S1 |
| P0.2 预算门 | Parent | 用户预算、profile | 为基础侦察、critic、验证预留调用数 | `budget`、`run_status`、`incomplete_reason` | 最低预算不够则不启动侦察 | S1:119 |
| P0.3 隔离与元数据 | Parent | 平台能力、输出路径 | 建立共享文件所有权、独立 scratch、父端 artifacts；登记执行策略 | `run-metadata.json` | 配置不足阻止目标代码执行，不等于禁止源码阅读 | S1:54 |
| P1.1 历史输入 | Parent | 同仓库历史账本/发现 | 核对相关源码和条件是否变化，决定继承、排除或重验证 | `prior_status`、历史路径/版本、排除指纹 | 不能只因 commit 相同就认定证据仍有效 | S2:59 |
| P1.2 产品侦察 | Recon 1a | 本地源码/文档 | 识别产品、用户、技术栈、入口、可离线命令、可比软件 | 事实返回 N | 不执行构建或联网 | S2:9 |
| P1.3 权限侦察 | Recon 1b | 身份/授权源码 | 映射低信任主体、正常能力、对象权限、租户和控制 | 事实返回 N | 不推断线上可达性 | S2:22 |
| P1.4 路径侦察 | Recon 1c | 输入和处理源码 | 列入口、转换、副本、sink、并行路径及限制 | 事实返回 N | 不发送测试输入 | S2:35 |
| P1.5 验证条件侦察 | Recon 1d | 测试/配置/沙箱能力 | 找最小离线检查、部署未知、禁止命令、可执行条件 | 事实返回 N | 缺少沙箱/晋升能力要保留阻塞原因 | S2:44 |
| P1.6 补充侦察 | 聚焦 Recon | 未映射模式/子系统 | 按实质差异补足事实 | 事实或 `deferred` 单元 | 必须先重新检查预算 | S2 |
| P1.7 架构综合 | Parent | 四类事实、历史缺口 | 写约 1,000 words 上限的架构摘要 | `architecture.md` | 子 Agent 不是该文件写入者 | S2:73 |
| P1.8 方法选择 | Parent | 真实边界 + 攻击文件 | 选普通类、专项类，记录选中块和排除理由 | `ordinary_attack_class_block`、`selected_companion_blocks`、`excluded_blocks` | 不能只因某种语言出现就选专项 | S2、S8 |
| P1.9 建覆盖单元 | Parent | 入口×边界×子系统×类别；deep 可加生命周期 | 编码稳定 ID、排序、建立计划 | `coverage-ledger.json` | 这是任务空间，不是具体漏洞全集 | S2:90 |
| P1.10 校验账本 | Parent/脚本 | 初始账本 | 运行 ledger validator，修正全部错误 | PASS/FAIL、退出码 O | 不合法账本不能驱动任务 | S2、S6 |
| P2.1 预算与优先级 | Parent | 单元、历史证据、剩余预算 | 优先低信任入口、高价值资源、历史缺口和变化源码等 | 排序理由 N、被延后单元 | 保留 critic 与验证预算 | S3:3 |
| P2.2 组装任务 | Parent | 架构、单元、方法块、schema | 按规定顺序组装完整 Hunter 提示词 | 实际 prompt O；`in_progress`、`agent_id` | 必须复制选中块正文，不能只发类名 | S3:11 |
| P2.3 形成/检查假设 | Hunter | 入口、能力、控制与路径 | 从具体安全不变量出发深读代码，寻找失败条件及反例 | `invariant`、候选根因/路径等 | 初始和放弃假设没有统一历史字段 | S3:27 |
| P2.4 选择分析路径 | Hunter | 假设、已有证据 | 追踪 identity/authz/normalization/state/copies/sink；比较并行路径 | `checks`、`reviewed_paths`、`trace`、`evidence` | 调查深度限定在负责边界及依赖保证内 | S3 |
| P2.5 最小本地检查（条件） | Hunter | 可执行条件、假数据 | 需要观察行为且隔离可执行时选择最窄测试；记录命令、输入、限制、最小实际结果 | `execution` 或阻塞；scratch 证据 | 非每条假设必执行；源码可反驳时停止，需本地证据却无法执行时保留精确阻塞 | S1、S3 |
| P2.6 晋升证据（条件） | 可信父端代码 | 预声明 scratch 文件、目录描述符 | 需保留本地文件时，在子进程全部结束后逐文件安全读取、复制到 artifacts | `artifact` 路径；晋升结果 O/N | source check 不晋升；Agent 不能自行写 artifacts；失败证据不可引用 | S1、S3 |
| P2.7 候选门 | Hunter | 路径、最强防护、检查结果 | 排除单纯硬化、自我影响、已被源码反驳的推测 | `proposed_verdict`；空 `candidates` 也合法 | 暂定 confirmed 还不是最终 confirmed | S3:138 |
| P2.8 返回 | Hunter | 各单元调查结果 | 返回且只返回一个 JSON | `units`、`candidates`、`hardening`、`uncovered` | 每个分配 ID 必须出现一次 | S3:168 |
| P2.9 父端接收 | Parent | 原始 Hunter 返回 | 检查 ID、归属、证据、结构；逐单元更新账本 | `checks`→`local_checks`，指纹/未知等 | 失败/畸形/不支持的结论不算完成，重新计划 | S3:215 |
| P2.10 候选合并 | Parent | 多 Hunter 候选 | 先按 fingerprint 再按根因去重 | 合并候选；账本关联 | 独立缺失控制仍需独立指纹 | S3 |
| P2.11 波后 critic | 新 critic | 全账本、架构、候选、历史 | 找缺失单元、弱检查、无根据关闭和排除 | critic JSON | critic 不负责输出漏洞裁决 | S3:221 |
| P2.12 接受/重派 | Parent | critic 建议 | 检查范围、派生规范 ID；归档旧 attempts；新 owner 重查 | `attempts`、`wave`、新增单元 | 不把旧 owner 的证据复制到新 live attempt | S2、S3 |
| P2.13 最终覆盖复查 | 新 final-clean critic | 波后无接受工作且无 planned 的状态 | standard/deep 再做独立 clean pass | critic JSON | 有新工作则继续；quick 无该额外 pass | S3 |
| P3.1 独立候选验证 | 新 general verifier | 每个唯一候选/继承候选 | 重读全部引用、重构最强控制、尝试反驳；安全可行时复现 | `decision` + schema `record` | 不接收另一个 verifier 的结论 | S4:3 |
| P3.2 接收裁决 | Parent | verifier 原始 JSON | 核对指纹、合并修正、登记每个关联单元 | 三种 verdict、检查归属 | 畸形返回直接丢弃并用新 verifier 重试，不手工修成有效裁决 | S4 |
| P4.1 写最终记录 | Parent | 已独立决定的记录 | 按 fingerprint 排序写三种裁决 | `findings.json` | 尚未验证的候选不得塞入任意 verdict | S4:95 |
| P4.2 两个校验器 | Parent/脚本 | findings/ledger | 各自检查结构和有限语义约束 | PASS/FAIL、错误、退出码 | 不证明漏洞真实性，不自动验证两文件外键 | S6、S7 |
| P5.1 最终记录复核 | 新 research verifier | confirmed/needs_validation 结构记录 | 检查 source、接口、条件、影响、风险、修复或阻塞计划 | `verified` 或 `replace` | quick 合并在 P3；其他 profile 独立 | S4:120 |
| P5.2 替换门 | Parent | replace 记录和理由 | 区分文字微调与根因/路径/输入/结果/影响/严重性等重大变化 | 替换前后记录 | 重大变化必须由又一个独立 verifier 复查 | S4 |
| P5.3 循环/不完整 | 新 verifier/Parent | 重大替换 | 再验证；必要时继续替换与独立复核 | verified 或新 replace | 预算或独立性不足，移除争议发现，保留 unresolved candidate，标记 incomplete | S4 |
| P5.4 再次校验 | Parent/脚本 | 已应用替换 | 更新关联决定并重跑两个校验器 | 校验事件 O | 每次应用替换都要做，不只是最后做 | S4 |
| P6.1 生成总报告 | Parent | 最终记录、账本、hardening | 写范围、姿态、已确认/待验证、硬化、覆盖限制 | `REPORT.md` | 报告不能增强裁决或影响 | S4:155 |
| P6.2 详细确认报告 | Parent | medium/high/critical confirmed | 复制完整证据和本地重现、修复/回归案例 | `FINDINGS-DETAIL.md` | low/informational 不在明确要求的详细集合中 | S4:169 |
| P6.3 待验证报告 | Parent | needs_validation 记录 | 写精确阻塞、边界和适用检查计划 | `NEEDS-VALIDATION.md` | 未独立验证的 ledger candidate 必须单独披露，不伪装成 needs_validation finding | S4:180 |
| P6.4 终止 | Parent | 文件、裁决、校验、剩余工作 | 区分完成与明确不完整 | `run_status`；必要时 `incomplete_reason` | 审查完成与全部报告落盘是两个里程碑；按 S1 的全部输出/校验终止条件判断整体完成 | S1、S4 |

## 4. Profile、历史与失败分支

| 分支 | 固定要求 | 必须记录 | 不能推断 |
| --- | --- | --- | --- |
| `quick` | 一个 Hunter 波次 + 一个最终波后 critic；Phase 3/5 合并为一个独立 reviewer | 粗粒度单元、新缺口 deferred、`quick_profile_final_critic` | quick 完成不等于全面覆盖。 |
| `standard` | 默认；波后 critic 无接受工作且无 planned 后，再由不同 final-clean critic 复查 | 每波和最终 critic、重派 attempts、候选两阶段复核 | critic `stop=true` 不等于项目没有漏洞。 |
| `deep` | 更细子系统/生命周期；同源码历史 covered 单元增加独立第二遍 | 生命周期维度、历史重查和两阶段复核 | 多 Agent 不构成完备性证明。 |
| scoped | 只为范围内任务安排执行，范围外仍登记 | `scope_paths`、`out_of_scope` 与理由 | 不能把未审范围写成 covered。 |
| 历史 confirmed 源码/条件不变 | 放入当前候选重新验证；只从 Hunter 排除该根因 | 原 fingerprint、当前源码对照、验证归属 | 历史确认不是自动继承当前最终确认。 |
| 历史 confirmed 已变化 | 建新重验证工作，不排除根因 | `prior_confirmed_changed_source` | 旧 verdict 不自动延续。 |
| 历史 needs_validation/blocked/deferred | 保留为当前工作 | 原阻塞、当前路径、重新检查 | 历史有记录不代表已覆盖。 |
| 历史 rejected | 未变化时只抑制该错误主张；不抑制整个单元 | 拒绝理由、是否出现改变结论的新证据 | 一次拒绝不能证明该区域永久安全。 |
| 预算不足启动 | 不启动任何 Recon | `budget_cannot_fund_reconnaissance_and_reserves` | 不能声称已经做了审计。 |
| 预算不足新一波/聚焦侦察 | 不启动该工作，未执行单元 deferred | `budget_cannot_reserve_critics_and_validation` | 不允许悄悄忽略单元。 |
| critic 预算耗尽 | 不再 hunting，不作完整覆盖声明 | `critic_budget_exhausted` | 不把“没钱继续”解释为 clean。 |
| 候选验证预算耗尽 | 停 hunting，按 fingerprint 顺序验证；剩余候选只在账本 | `validation_budget_exhausted`、未验证指纹/单元 | 不把未验证候选改名 needs_validation 以完成报告。 |
| 无沙箱/无安全晋升 | 不执行目标代码或不使用失败证据 | 缺少哪一项能力、源证据和最小验证计划 | 有工具不等于允许执行，有输出不等于安全可信证据。 |
| 无效 Agent 返回 | 保留原始返回以供额外日志分析；规范中丢弃有效裁决资格 | 原始返回 O、错误、重试实例 X/O | 不能静默修复成仿佛 Agent 曾给出的有效裁决。 |
| 重大替换无法复核 | 争议记录不保留为最终 finding，ledger unresolved candidate | exact `incomplete_reason` N、争议版本/关联 X | 不能以第二个 Agent 的建议替代第三个的独立复核。 |

## 5. 文件与返回产物清单

| 产物 | 创建/更新时机 | 写入者 | 内容/类型 | 用途 | 记录局限 |
| --- | --- | --- | --- | --- | --- |
| `run-metadata.json` | 委派前；运行事实和状态改变时 | Parent | JSON 对象，文字规定的最少信息 | 标识一次运行与约束 | 没有随包提供其 JSON schema 或专门 validator。 |
| Recon 返回 | Phase 1 各子任务结束 | Recon 经 Task 返回，Parent 接收 | 结构化事实 + file:line，未固定 JSON 属性 | 架构和任务选择依据 | 没有强制每个 Recon 单独保存文件。 |
| `architecture.md` | Phase 1 综合后；后续刷新时点未单独规定 | Parent | 约 1,000 words 的 Markdown 摘要 | 所有 Hunter 的共享上下文 | 不是全量侦察事实档案，也没有明文规定自动增量刷新机制。 |
| `coverage-ledger.json` | Phase 1 初始化；每次父端更新 | Parent | 顶层数组，当前单元与 attempts | 覆盖、任务归属、检查、候选关联 | 当前状态不是完整时间序列；仅部分重派历史有规范归档。 |
| Hunter 返回 | 每次 Hunter 调用结束 | Hunter 经 Task 返回 | `units/candidates/hardening/uncovered` | 更新账本和收集候选 | 没有规定 `hunter-result.json` 这个固定文件名。 |
| critic 返回 | 每波、最终 clean pass | critic 经 Task 返回 | 缺口/重派/历史线索/stop JSON | 决定下一波 | 没有规定固定 critic 文件或完整处理结果档案。 |
| Phase 3 返回 | 每个候选验证结束 | verifier 经 Task 返回 | `decision/record` | 独立裁决与纠正记录 | 原始候选可能被最终文本覆盖。 |
| `findings.json` | Phase 4；应用替换后 | Parent | 顶层数组，按 fingerprint 排序 | 最终三种记录的权威来源 | 不存过程事件、Agent 归属或完整版本历史。 |
| Phase 5 返回 | 每次复核/替换验证结束 | verifier 经 Task 返回 | verified 或 replace JSON | 最终复核、修正 | 没有固定 `verification.json` 文件。 |
| `agents/<id>/scratch/` | 分配后；子 Agent/目标代码工作时 | 对应 Agent/隔离进程 | 临时文件、fixture、输出 | 本地执行工作区 | 不是最终可信证据；本机 `/tmp` 不作为审计 Agent 写隔离的替代。 |
| `agents/<id>/artifacts/` | 可信父端成功晋升后 | 可信父端代码 | 限定、非秘密、普通证据文件 | 保留可回放的最小证据 | 无固定文件名；不能直接复制整个 scratch。 |
| 校验器输出 | 初始 ledger、每次 ledger 更新、Phase 4、替换后、报告前 | Node.js | stdout/stderr、退出码 | 结构门禁和诊断 | 不自动写日志文件或数据库。 |
| `REPORT.md` | 最终复核后；不完整情况明确披露 | Parent | 总体报告 | 对人交付 | 不能反过来改变 JSON verdict。 |
| `FINDINGS-DETAIL.md` | Phase 6 | Parent | 中高严重性 confirmed 细节 | 重现与修复 | 不是所有 candidate 的调查史。 |
| `NEEDS-VALIDATION.md` | Phase 6 | Parent | 已核查但有决定性未知的线索 | 安全的后续检查 | 不包含无依据泛泛猜想。 |

## 6. `run-metadata.json` 数据字典

以下 E/N 均来自 S1:44–86；类型是规范语义说明，不是一个已存在的 metadata schema。没有明确拼写的属性不能假称已有字段。

| 字段/信息 | 类型或取值 | 作用 | 固定字段名？ | 限制 |
| --- | --- | --- | --- | --- |
| `run_id` | 运行标识 | 区分执行批次 | 是，N | 格式、全局唯一规则未规定。 |
| `repo` | 仓库标识 | 同仓库历史关联 | 是，N | 不能只凭显示名认定同一个仓库。 |
| `target` | 绝对仓库根路径 | 确定阅读对象 | 是，N | 最终源码引用仍要求仓库相对路径。 |
| `source_ref` | 被审源码版本说明 | 固定证据基线 | 是，N | 需记录 commit 和 dirty 信息，但子结构未固定。 |
| `profile` | `quick/standard/deep` | 控制粒度、重复检查和复核策略 | 是，N | 不降低证据门槛。 |
| `scope_paths` | 范围路径集合 | 声明局部范围 | 是，N | 没有自动核验覆盖 scope 的程序。 |
| `budget` | 未设为 null；设定时最大 Agent 调用数 | 控制支出/保留 critic 和 verifier | 是，N | 原义不是 token 数或金额；建议规范成整数，当前无类型 schema。 |
| `execution_policy` | `sandboxed-source-and-local-only` | 限定目标执行边界 | 是，N | 一段字符串不是已实施的 OS 隔离证据。 |
| `run_status` | `in_progress/complete/incomplete` | 总体运行状态 | 是，N | 模型写 complete 不足以证明所有条件满足。 |
| `incomplete_reason` | 原因字符串 | 解释不能完成的门禁/资源问题 | 是，条件 N | 部分预算原因有固定关键词，其他原因要求精确但没有统一枚举。 |
| selected companion files | 选中的专项文件 | 解释方法范围 | 否，N | 原文规定记录信息但未固定 JSON 属性；`selected_companion_files` 若采用则是 X。 |
| prior-run paths | 历史输入路径 | 来源追溯 | 否，N | `prior_run_paths` 是可选新增命名，不是已规定字段。 |
| shared-file owners | 共享文件所有权 | 防止子 Agent 篡改 | 否，N | `shared_file_owners` 是可选新增命名。 |

## 7. 侦察信息与架构摘要的数据字典

侦察没有统一 JSON schema。下面列的是明确要求返回/综合的概念，而不是虚构原有属性。若以后结构化，建议键放入你自己的记录模型。

| 侦察信息 | 谁产出 | 必须回答什么 | 影响下游什么 | 原有承载 | 建议键 X |
| --- | --- | --- | --- | --- | --- |
| 产品/普通动作 | 1a | 产品做什么，谁使用/运营，哪些动作敏感 | 合法行为基线，避免把正常功能当漏洞 | 返回文本；architecture | `product_type`、`normal_actions` |
| 技术栈/版本/模式 | 1a | 语言、框架、runtime、构建/本地可见部署 | 分析路径、默认控制与工具可行性 | 同上 | `stack_facts` |
| 入口/子系统 | 1a/1c | 哪些入口通向哪个代码区域 | `surface`、`subsystem`、起点 | 同上 + ledger | `entry_facts` |
| 主体/正常能力 | 1b | 谁能做哪些操作，能力来自哪里 | 攻击者起始能力与越权界定 | 返回文本；architecture | `principal_facts`、`capability_facts` |
| 身份/对象/租户控制 | 1b | 哪行完成身份/授权/隔离，哪些取决于部署 | 预期控制和最强可见防护 | 同上 | `control_facts` |
| 状态/权限转换 | 1b | 撤销、恢复、fallback 等如何改变权限 | 生命周期与并行路径分析 | 同上 | `transition_facts` |
| 输入与转换 | 1c | 输入在哪进入、如何解析/规范化/存储 | source→sink、二阶使用和解释差异 | 返回文本；architecture | `flow_facts` |
| 衍生副本/并行路径 | 1c | 缓存、索引、日志、后台、batch 等有哪些 | 防止只检查主路径 | 同上 | `derived_copy_facts`、`parallel_path_facts` |
| 可离线构建/测试 | 1a/1d | 精确命令、依赖、写位置、fixture | 本地验证计划与执行门禁 | 返回文本；architecture | `local_check_options` |
| 禁止命令 | 1d | 哪些会联网、发布、花钱、改变共享状态 | 阻止越界执行 | 返回文本 | `prohibited_actions` |
| 部署未知 | 1b/1d | 哪项事实源码无法建立 | 避免把缺失配置当成缺失防护 | architecture；后续 blockers | `visibility_gaps` |
| 沙箱能力 | 1d | 网络、环境、只读、写隔离、资源限制是否可执行 | 是否允许目标代码运行 | 返回文本 | `sandbox_capabilities` |
| 证据晋升能力 | 1d | 描述符/no-follow/普通文件/大小界限等是否可执行 | 本地输出能否成为 retained artifact | 返回文本 | `promotion_capabilities` |
| 可比软件基线 | 1a | 仅使用本地可证据化的对照及权衡 | 校准努力/严重性；不否定已证实漏洞 | architecture，可无 | `comparable_baseline` |
| 历史缺口/排除 | Parent | 哪些重查、哪些只排除已确认同根因 | 计划和去重 | architecture + ledger | 不需重复虚构原始 verdict |
| 方法选择理由 | Parent | 哪个边界要求哪个 companion | prompt 与任务空间 | architecture 摘要 + ledger block map | `selection_decisions` |

`file:line` 是侦察要求的引用形式，不是一个已规定的 `evidence_id`。原始事实容易在约 1,000 words 的架构摘要里被压缩；要研究侦察质量，应额外保留各 Recon 原始返回及生成时间。

## 8. `coverage-ledger.json` 全字段

来源：S2:90、S6:26、S6:646。顶层是数组。表中 `[]` 表示数组元素路径，不是属性名的一部分。

| 字段路径 | 类型/约束 | 含义与作用 | 何时写入/更新 | 备注 |
| --- | --- | --- | --- | --- |
| `coverage_id` | 非空字符串；脚本上限 65,536 JS 字符 | 规范覆盖单元身份 | 创建单元 | 从 canonical_refs 编码；不是漏洞 ID。 |
| `canonical_refs` | 对象，仅四个必需键，生命周期可再加一键 | 可跨运行稳定关联的源码身份 | 创建/映射 | 不允许其他键。 |
| `canonical_refs.surface` | NFC，可见、无禁用字符，最多 1,024 JS 字符 | 入口源码身份 | 创建 | 不用波次/行号形成身份。 |
| `canonical_refs.boundary` | 同上 | 边界/控制源码身份 | 创建 | 不是“auth”这样随意改名的泛标签。 |
| `canonical_refs.subsystem` | 同上 | 子系统源码身份 | 创建 | quick 使用固定合并身份。 |
| `canonical_refs.attack_class` | 同上 | 精确攻击块引用 | 创建 | `FILE.md#原文名称`，不是网页 slug。 |
| `canonical_refs.lifecycle` | 条件字段，同上 | 生命周期身份 | deep/实质必要时 | 必须与 `lifecycle` 同时存在。 |
| `surface` | 非空可见文本 | 面向人的入口说明 | 创建 | 与 canonical 身份分别保存。 |
| `boundary` | 同上 | 面向人的边界说明 | 创建 | 不能仅凭标签证明边界真实。 |
| `subsystem` | 同上 | 面向人的子系统说明 | 创建 | 用于粒度/归属分析。 |
| `attack_class` | 同上 | 面向人的类别说明 | 创建 | 类别不是分析工具名称。 |
| `lifecycle` | 可选文本 | 生命周期显示说明 | 条件创建 | 不是每种 profile 都必须有。 |
| `starting_paths` | 非空、不重复、安全仓库相对路径数组 | Hunter 开始阅读的地方 | 创建/任务调整 | 不表示只允许读这几个文件。 |
| `ordinary_attack_class_block` | 文本或 null | 选中的普通攻击块 | 选择方法 | 无适用普通块时才 null。 |
| `selected_companion_blocks` | 不重复文本数组，可空 | 专项 core/class/universal/validation 块引用 | 选择方法 | 脚本不实际打开专项文件核对名称。 |
| `excluded_blocks` | 对象数组，可空 | 考虑后未选块及理由 | 选择方法 | 不可和选中 companion 冲突。 |
| `excluded_blocks[].block` | 非空文本，块不重复 | 排除的精确块 | 选择方法 | 原有信息是明确排除，不是默认从未考虑。 |
| `excluded_blocks[].reason` | 非空文本 | 为什么不适用/不安排 | 选择方法 | 理由应有源事实支持；脚本只检文本。 |
| `prior_status` | 见第 9 节 | 与历史状态的关系 | 计划建立 | 与当前 status 分开。 |
| `attempts` | 数组，可空 | critic 重开工作时旧证据终态归档 | 重派前追加 | 不是所有工具调用日志。 |
| `wave` | 正整数 | 当前单元的尝试/波次索引 | 初始 1，重派递增 | 不用作 coverage_id 组成部分。 |
| `status` | 八种状态，见第 9 节 | 当前覆盖工作状态 | 计划、分配、合并、critic | 与 findings verdict 不同。 |
| `agent_id` | null 或规范小写 ID | 当前分配 owner | 分配/继承验证 | 未分配状态必须 null；不是所有 check 的作者。 |
| `reviewed_paths` | 不重复安全路径数组 | 当前尝试全部已检查路径 | 返回合并 | 必须等于全部 local_checks 里路径的并集。 |
| `local_checks` | check 对象数组 | 当前尝试的证据化检查 | Hunter/Verifier 返回合并 | 名称虽叫 local，实际同时允许 source 与 local。 |
| `result_fingerprints` | 不重复指纹数组 | 关联候选根因 | candidate 合并 | 仅 candidate 状态可非空；不是直接代表 confirmed。 |
| `unresolved` | 不重复非空文本数组 | 未知、阻塞、延期/范围说明 | 按状态更新 | 各状态对空/非空要求不同。 |

### 8.1 检查对象：`local_checks[]` / Hunter 的 `checks[]`

| 字段 | 类型 | 作用 | 脚本/流程约束 |
| --- | --- | --- | --- |
| `agent_id` | 规范小写字符串 | 本次检查实际作者 | 与 unit owner 可以不同，尤其是 verifier 补充证据时。 |
| `reviewed_paths` | 非空路径数组 | 该作者检查的源码集合 | 汇总进 unit 的路径并集。 |
| `invariant` | 非空可见文本 | 要验证的具体安全控制/不变量 | 是调查目标，不是完整假设推理历史。 |
| `method` | `source` 或 `local` | 源码检查/本地执行两大类 | 没有 `taint`、`race`、`sanitizer` 等具体枚举。 |
| `result` | 非空可见文本 | 源码或检查实际建立了什么 | 支持/反驳与观察内容往往混在自由文本中。 |
| `artifact` | null 或输出目录相对路径 | 最小保留证据的位置 | source 必须 null；local 必须 `agents/<该 check.agent_id>/artifacts/<文件>`。 |

S6 对这些对象检查必需字段，但不像 findings schema 那样统一禁止额外 bookkeeping 属性。即使附加字段可以通过，也仍属你的扩展，原始 skill 没有保证会产出。

### 8.2 历史尝试：`attempts[]`

| 字段 | 含义/约束 |
| --- | --- |
| `wave` | 正整数，归档之间严格递增，全部小于 live `wave`。 |
| `status` | 只可 `covered/candidate/blocked`，保留原终态证据。 |
| `agent_id` | 旧分配 owner；重派 owner 必须新鲜独立。 |
| `reviewed_paths` | 原路径集合，不能删成空掩盖调查。 |
| `local_checks` | 原检查及作者/artifact，遵循同样的检查契约。 |
| `result_fingerprints` | 原 candidate 指纹集合；其他归档状态必须空。 |
| `unresolved` | 原未知/阻塞，遵循同样状态约束。 |
| `reassignment_reason` | critic 提供的源码支持的重开理由，非空可见文本。 |

`attempts` 只归档重开覆盖任务的终态。不会自动保存 initial hypothesis、每次读取、候选合并前版本、Phase 5 每次替换或所有失败 Agent 调用。

### 8.3 ID 与关联规则

| 标识 | 构造/格式 | 关联对象 | 必须注意 |
| --- | --- | --- | --- |
| `coverage_id` | surface、boundary、subsystem、attack_class 的 UTF-8 RFC 3986 percent 编码，以 `::` 拼接，必要时末尾 lifecycle | 一个覆盖单元 | `%HH` 大写；NFC；不做有损 slug；本 run 唯一并排序。 |
| `fingerprint` | `^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$` | 一个源码根因主张，贯穿三种 verdict | 规范要求不含行号/波次/Agent/严重性/verdict；脚本只检查形式，不理解根因稳定性。 |
| `agent_id` | `^[a-z0-9][a-z0-9_-]{0,63}$`，排除 Windows 设备名 | 一个规范 Agent 实例/检查作者 | 同一次 run 中明确 owner；跨 run 不应只凭名称认定同实例。 |
| `run_id` | 原文未给编码规则 | 一次运行 | 数据库需要自行保证唯一性。 |
| `source_ref` | 版本信息，结构未固定 | 一份被审源码基线 | dirty worktree 最好额外采集快照摘要 X。 |

一个候选可能关联多个覆盖单元；一个单元也可能发现多个候选。`fingerprint` 不在 findings 中直接指向 coverage_id，要通过账本 `result_fingerprints` 建立关联。数据库不宜把它们强制做成一对一。

## 9. 状态、裁决和关键字字典

### 9.1 覆盖单元状态

| `status` | 含义 | owner | 路径/检查 | fingerprints | unresolved |
| --- | --- | --- | --- | --- | --- |
| `planned` | 尚待分配 | null | 空 | 空 | 空 |
| `in_progress` | 已分配，等待终态返回 | 必须有 | 空 | 空 | 空 |
| `covered` | 有证据的检查完成，未形成候选 | 必须有 | 非空 | 空 | 空 |
| `candidate` | 形成关联候选主张 | 必须有 | 非空 | 非空 | 可空或非空 |
| `blocked` | 做了部分检查，尚有阻塞；未形成关联候选 | 必须有 | 非空 | 空 | 非空 |
| `deferred` | 没安排执行/下一次尝试延后 | null | 空 | 空 | 非空理由 |
| `out_of_scope` | 不在本次审查范围 | null | 空 | 空 | 非空理由 |
| `not_applicable` | 不适用的覆盖单元 | null | 空 | 空 | 非空理由 |

`covered` 是覆盖检查状态，不是“证明无漏洞”；`candidate` 是工作单元状态，不是最终裁决。已拒绝候选的关联单元不一定就自动变成 covered：原文要求记录验证决定，但未定义统一的决定字段或强制转移，不能擅自补一个实现。

### 9.2 历史关系 `prior_status`

| 取值 | 意义 |
| --- | --- |
| `new` | 存在兼容历史账本，但此 surface 在本 run 首次发现。 |
| `none` | 没有兼容历史账本时种入的单元。 |
| `prior_confirmed_same_source` | 相关源码与条件未变，历史 confirmed 需要当前重验证。 |
| `prior_confirmed_changed_source` | 历史 confirmed 的相关源码/条件变动。 |
| `prior_needs_validation` | 历史尚有决定性未知。 |
| `prior_deferred` | 历史延后未做。 |
| `prior_blocked` | 历史部分检查但受阻。 |
| `prior_out_of_scope` | 历史在范围外，当前可能进入范围。 |
| `prior_covered_same_source` | 历史 covered 且相关源码未变，仍在当前账本可见。 |
| `prior_covered_changed_source` | 历史检查过的相关源码已变。 |
| `prior_rejected_claim_changed` | 已拒绝主张有新证据/改变的失败路径，需要重新处理。 |

### 9.3 裁决、复核和其他关键字

| 字段/关键字 | 取值 | 含义 | 不是 |
| --- | --- | --- | --- |
| Hunter `proposed_verdict` | `confirmed/needs_validation` | Hunter 暂定分支 | 最终独立裁决。 |
| Phase 3 `decision` / record `verdict` | `confirmed/needs_validation/rejected` | 独立验证决定及其最终记录分支 | 任务是否执行完。 |
| `confirmed` | 完整源码路径 + 有意义边界影响 + 最小本地观察结果 | 已按流程独立证明的记录 | 仅模型高置信度或 schema 通过。 |
| `needs_validation` | 有源证据、存在具体决定性未知 | 后续本地/owner 观察需要 | 任意未验证猜想、低置信度 confirmed。 |
| `rejected` | 源码/行为/防护/不可能条件等反驳主张 | 保留反例防止重复错误 | 工具失败或预算不足。 |
| Phase 5 `decision` | `verified/replace` | 记录接受或要求替换 | 第四/第五种 finding verdict。 |
| critic `stop` | boolean | critic 自己的覆盖评估 | 父端循环与全流程的唯一停止条件。 |
| `hardening` | 非 finding 的具体加固建议 | 与漏洞分开报告 | informational confirmed 的同义词。 |
| `uncovered` | 未有对应当前单元的新边界 | 下一波潜在工作 | Hunter 可以越界继续查其他 owner 的许可。 |
| `Core discipline` | 专项共同证据纪律 | 必须复制进选用该专项的 Hunter prompt | 一种独立安全工具。 |
| `Universal moves` | 专项共同分析动作 | 为多个该域类别提供调查方法 | 保证 LLM 实际做过每个动作。 |
| `Validation rules` | 专项确认前门槛 | 判断证据和阻塞 | Node 脚本自动执行的测试。 |
| `entrypoint/propagation/sink` | trace 节点类型 | 代码中的有序来源—传播—结果路径 | Agent 的思考步骤/调用时间线。 |

## 10. Hunter 与 critic 返回字段

### 10.1 Hunter 返回

来源 S3:168。这些是 JSON 结构契约，但没有随包提供单独 Hunter schema/专用校验器；父端按要求接收处理。

| 字段路径 | 类型/值 | 作用 | 进入哪份最终文件 |
| --- | --- | --- | --- |
| `units` | 对象数组 | 每个被分配 coverage_id 的结果 | 对应 ledger 单元更新。 |
| `units[].coverage_id` | 分配的 ID，每个恰一次 | 确定结果归属 | ledger 对应项。 |
| `units[].disposition` | `covered/candidate/blocked` | 本单元的调查结果 | 转为 ledger `status`。 |
| `units[].reviewed_paths` | 非空路径集合 | 当前检查覆盖哪些文件 | ledger `reviewed_paths`。 |
| `units[].checks` | 第 8.1 节 check 对象数组 | 当前具体检查和结果 | ledger `local_checks`。 |
| `units[].candidate_fingerprints` | 指纹数组 | 本单元候选关联 | ledger `result_fingerprints`。 |
| `units[].unresolved` | 未知数组 | 受阻/候选未决事实 | ledger `unresolved`。 |
| `candidates` | 候选对象数组，可空 | 符合门槛的根因主张 | 经独立验证后才进入 findings。 |
| `candidates[].proposed_verdict` | 两种暂定分支 | 选择候选字段要求 | 最终 record 改为 `verdict`，不得保留该 wrapper 字段。 |
| `candidates[].其他字段` | 按 confirmed/needs_validation schema，除 verdict 外全部字段 | 根因、路径、证据、条件、结果/阻塞等 | 第 11 节；原始版本需额外保留。 |
| `hardening` | 字符串数组 | 具体非漏洞备注 | Parent 放入相关 ledger bookkeeping；属性名未固定。 |
| `uncovered` | 对象数组 | 意外遇到、没有当前单元的边界 | Parent 派生新 ledger 单元。 |
| `uncovered[].surface` | 字符串 | 新入口 | ledger surface。 |
| `uncovered[].boundary` | 字符串 | 新边界 | ledger boundary。 |
| `uncovered[].subsystem` | 字符串 | 新子系统 | ledger subsystem。 |
| `uncovered[].attack_class` | 字符串 | 相关类别 | ledger attack_class。 |
| `uncovered[].starting_paths` | 路径数组 | 新调查起点 | ledger starting_paths。 |
| `uncovered[].reason` | 字符串 | 为什么需要独立单元 | Parent 决定/新增日志；无强制统一的 ledger reason 属性。 |

### 10.2 critic 返回

| 字段路径 | 类型 | 作用 | 契约缺口/记录建议 |
| --- | --- | --- | --- |
| `missing_units` | 对象数组 | 新发现覆盖缺口 | 应保存原建议和 Parent 是否接受，不能只保存接受后的账本。 |
| `missing_units[].surface` | 文本 | 新入口 | 后续派生规范 identity，不是原建议自带 coverage_id。 |
| `missing_units[].boundary` | 文本 | 新边界 | 同上。 |
| `missing_units[].subsystem` | 文本 | 子系统 | 同上。 |
| `missing_units[].attack_class` | 文本 | 攻击类别 | 同上。 |
| `missing_units[].starting_paths` | 路径数组 | 起点 | 同上。 |
| `missing_units[].selected_companion_blocks` | 文本数组 | 选中专项块 | Parent 仍须补齐完整单元 block map。 |
| `missing_units[].excluded_blocks[].block` | 文本 | 排除块 | 使用同类排除规则。 |
| `missing_units[].excluded_blocks[].reason` | 文本 | 排除理由 | 需要来源支持。 |
| `missing_units[].reason` | 文本 | 新覆盖工作的源依据 | 不只是“我感觉还有问题”。 |
| `reassign_ids` | 已存在 ID 数组 | 请求重开弱检查/未关闭工作 | JSON 只列 ID，但正文另要求 source-backed 重派理由；未给统一逐 ID reason 对象。 |
| `resolved_prior_leads` | fingerprint 数组 | 声称历史线索已解决 | 正文要求 Parent 记录源支持的原因，但返回结构未单独规定该原因字段。 |
| `stop` | boolean | 没有 missing/reassign 时才 true | Parent 接受、预算、profile、planned 数共同决定后续。 |

## 11. `findings.json` 完整数据字典

来源 S5（字段）、S7:485（有限语义检查）、S4:95（产生方式）。顶层为数组；所有分支以及大多数嵌套对象均 `additionalProperties: false`。不要把事件、Hypothesis ID、model/tool 元数据直接塞入 findings。

### 11.1 分支字段矩阵

| 字段 | confirmed | needs_validation | rejected | 作用 |
| --- | --- | --- | --- | --- |
| `verdict` | 必需 | 必需 | 必需 | 分支识别。 |
| `fingerprint` | 必需 | 必需 | 必需 | 稳定根因身份；整个数组唯一且排序。 |
| `title` | 必需 | 必需 | 必需 | 人类可读标题。 |
| `description` | 必需 | 必需 | 必需 | 主张说明；应与状态相称。 |
| `trace` | 必需，非空 | 必需，非空 | 必需，非空 | 有序源码路径。 |
| `evidence` | 必需，非空 | 必需，非空 | 必需，非空 | 源码证据引用，反驳也需要证据。 |
| `root_cause` | 必需 | 禁止 | 禁止 | 已建立的真实根因。 |
| `claimed_root_cause` | 禁止 | 必需 | 必需 | 尚未成立或已反驳的根因主张。 |
| `intended_behavior` | 必需 | 禁止 | 禁止 | 正确的安全行为/不变量。 |
| `conditions` | 必需，可空数组 | 禁止 | 禁止 | 已确认结论成立条件。 |
| `execution` | 必需 | 禁止 | 禁止 | 已执行的目标原生接口最小本地重现。 |
| `remediation` | 必需 | 禁止 | 禁止 | 最小源级修复建议。 |
| `severity` | 必需 | 禁止 | 禁止 | 发生可能性、影响及总体等级。 |
| `confidence` | 必需 | 禁止 | 禁止 | 对已确认记录的定性证据信心。 |
| `blockers` | 禁止 | 必需，非空 | 禁止 | 精确决定性未知。 |
| `validation_plan` | 禁止 | 必需 | 禁止 | 至少一个适用 local/deployment 计划。 |
| `reason` | 禁止 | 禁止 | 必需 | 反驳主张的理由。 |

### 11.2 通用、路径和证据字段

| 字段路径 | 类型/取值 | 含义 | 注意 |
| --- | --- | --- | --- |
| `verdict` | 三种固定字符串 | 最终裁决 | 不是 Agent 角色或运行状态。 |
| `fingerprint` | 第 8.3 节格式 | 根因稳定身份 | 不是内容哈希自动保证语义相同。 |
| `title` | 非空可见字符串 | 简短主张标题 | 不能只含空白/不可见 Unicode。 |
| `description` | 非空可见字符串 | 说明问题和边界结果/未决主张 | 定位攻击者/资源等可能在这里，但没有专门必需字段。 |
| `trace` | 非空、不重复对象数组 | 完整或支持主张的有序路径 | 这是代码路径，不是调查事件。 |
| `trace[].kind` | `entrypoint/propagation/sink` | 节点类别 | 多节点首 entrypoint、末 sink、中间 propagation；单节点只可 entrypoint/sink。 |
| `trace[].file` | 非空安全仓库相对路径 | 源文件 | 校验器只验证字符串安全性，不打开目标文件验证其存在。 |
| `trace[].line` | ≥1 整数 | 一基源码行号 | 不自动核对是否超出文件行数。 |
| `trace[].scope` | 非空可见文本 | 函数/类/模块/处理范围 | 不自动核对函数真实存在。 |
| `trace[].description` | 非空可见文本 | 该节点的实际传播/安全操作 | 文本内容正确性由 verifier 负责。 |
| `evidence` | 非空、不重复对象数组 | 支持/反驳源码引用集合 | 不自动代替本地运行 artifact。 |
| `evidence[].file` | 安全相对路径 | 源证据文件 | 与 trace 同类路径门。 |
| `evidence[].line` | ≥1 整数 | 源证据行 | 与 trace 同类行号门。 |
| `evidence[].description` | 非空可见文本 | 该引用建立了什么 | 应区分源事实与推断。 |
| `root_cause` | 非空可见文本，仅 confirmed | 已证实根因 | 不该包含尚未证明的部署假定。 |
| `claimed_root_cause` | 非空可见文本，NV/rejected | 原主张的根因 | rejected 保存被反驳的对象，而不是删除其存在。 |
| `intended_behavior` | 非空可见文本，仅 confirmed | 应被代码保证的行为 | 可映射到安全不变量，但不是机器可判定逻辑式。 |
| `blockers[]` | 非空可见文本，数组非空且不重复 | 具体缺少的观察/能力 | 工具失败不自动变成部署未知。 |
| `validation_plan.local` | 可选非空文本 | 最小隔离本地检查 | 只是计划，不表示已做。 |
| `validation_plan.deployment` | 可选非空文本 | 由 owner 观察部署事实的安全方案 | 不是授权 Agent 打线上流量。 |
| `reason` | 非空可见文本，仅 rejected | 为什么主张不成立 | 应关联阻断控制/不可能条件/实际反例。 |

### 11.3 `conditions[]` 的九种类型

| 字段路径 | 类型/约束 | 作用 |
| --- | --- | --- |
| `conditions[].kind` | 必需字符串，以下九种枚举之一 | 指明该条件属于哪类前提。 |
| `conditions[].description` | 必需非空可见字符串 | 描述该条已确认条件；没有逐条件证据/认识状态属性。 |

| `kind` | 含义 | 示例信息，不是本次真实发现 |
| --- | --- | --- |
| `authentication_level` | 身份认证层级 | 无认证、登录用户、完成强认证。 |
| `authorization_role` | 角色/对象权限 | 普通租户成员、管理员。 |
| `user_interaction` | 用户交互条件 | 受影响用户打开本地测试页面。 |
| `system_configuration` | 配置 | 某功能旗标开启。 |
| `network_routing` | 路由/网络条件 | 特定本地代理路径。 |
| `environmental_dependency` | runtime/OS/架构等 | 特定构建或平台条件。 |
| `data_state` | 数据/生命周期状态 | 记录撤销、恢复、迁移中。 |
| `timing_dependency` | 时序/并发 | 特定确定性调度。 |
| `third_party_dependency` | 第三方依赖行为 | 某固定版本库的语义。 |

每个条件对象只有必需 `kind` 和非空 `description`。原结构没有逐前提的 `known/unknown/refuted`、证据 ID、初始置信度或历史版本；要研究假设前提，需要额外记录。

### 11.4 重现、修复与风险

| 字段路径 | 类型/取值 | 作用 | 记录局限 |
| --- | --- | --- | --- |
| `execution.attacker_perspective` | 非空可见文本 | 攻击者起始视角/能力 | 不是结构化 principal/capability 对象。 |
| `execution.payloads` | 必需字符串数组，至少一项且不重复 | 容纳最小输入/fixture/原生调用 | 与元素内容分开理解，单个元素可为空字符串。 |
| `execution.payloads[]` | 字符串；数组非空、不重复 | 最小测试输入、fixture 或原生调用 | 元素字符串本身可以为空，表示空输入；不是必须 HTTP payload。 |
| `execution.instructions` | 必需字符串数组，至少一项 | 容纳有序重现步骤 | 原 schema 没有要求此数组 uniqueItems。 |
| `execution.instructions[]` | 非空可见字符串；数组非空 | 按原生接口执行的本地步骤 | 没有强制独立 command/tool/version 字段。 |
| `execution.observed_result` | 非空可见文本 | 实际观察到的最小结果 | 不是完整 stdout/stderr 的标准结构。 |
| `remediation.strategy` | 非空可见文本 | 源级修复策略 | 审计描述修复，不实际修改目标源码。 |
| `remediation.code_changes` | 可选数组，可空 | 拟议源代码片段 | 不是已合并 patch 或修复验证事件。 |
| `remediation.code_changes[].file_name` | 安全仓库相对路径 | 拟改文件 | 校验器不确认改动已落盘。 |
| `remediation.code_changes[].fixed_code` | 字符串，可空 | 建议修复代码 | 不自动编译、测试或证明正确。 |
| `severity.likelihood` | 必需对象，只含必需 score/reason | 发生可能性评分及依据 | 与 impact、confidence 分开，不是数值概率。 |
| `severity.likelihood.score` | 五级字符串 | 发生可能性的定性等级 | 不是 0–1 概率或校准后的频率。 |
| `severity.likelihood.reason` | 非空可见文本 | 为什么在这些条件下可能发生 | 与 confidence 不同。 |
| `severity.impact` | 必需对象，只含必需 score/reason | 已观察影响评分及依据 | 不从崩溃推断更强影响。 |
| `severity.impact.score` | 五级字符串 | 已观察影响的等级 | 必须限制在证据影响。 |
| `severity.impact.reason` | 非空可见文本 | 影响对象、范围及程度依据 | 不把崩溃自动升级为代码执行。 |
| `severity.overall_severity` | 五级字符串 | 总体优先级 | 不得高于 impact；未实现 likelihood×impact 数值公式。 |
| `confidence.score` | `low/medium/high` | 证据确定性的定性信心 | 只存在于 confirmed；不是初始假设概率。 |
| `confidence.reason` | 非空可见文本 | 信心依据 | 不自动经过概率校准。 |

五级风险枚举是 `informational/low/medium/high/critical`；总体等级 ≤ 影响等级是校验器强制的有限语义约束。

## 12. 独立验证返回字段与替换路径

| 阶段/返回 | 字段 | 类型/作用 | 原结构是否保存前后历史 |
| --- | --- | --- | --- |
| Phase 3 | `decision` | 三种最终裁决 | 否，须额外保留调用返回。 |
| Phase 3 | `record` | 完整、匹配 decision 的 schema 记录 | 修正记录替代 Hunter 文本。 |
| Phase 5 verified | `decision` | 固定 `verified` | 否。 |
| Phase 5 verified | `fingerprint` | 被复核记录身份 | 不同时包含 reason/record。 |
| Phase 5 replace | `decision` | 固定 `replace` | 否。 |
| Phase 5 replace | `reason` | 为什么应替换 | 是返回要求，但无固定独立存档文件。 |
| Phase 5 replace | `record` | 完整替换分支记录 | 与原 fingerprint/根因必须核对。 |
| 新根因 | 新 `fingerprint` | 真实独立根因身份 | 要重新走候选独立验证，不是直接改标题。 |
| 重大替换 | 外部流程判断 N | verdict 增强、根因/trace/输入/结果/影响/严重性重大变化 | 没有内置 `material_change` 字段或确定性差异程序。 |
| 小修正 | 外部流程判断 N | 不改变含义/证据的文字或行号纠正 | 可直接应用，但仍须重跑校验。 |

Phase 5 明确新建 verifier 的对象是 confirmed 和 needs_validation；并未要求对每个 Phase 3 rejected 再启动普通 Phase 5 verifier。不能把“所有裁决已定”理解成三个分支都自动有同样次数的复核。

### 12.1 原始规范自身的歧义与缺口

以下是原文存在的张力，不是本说明或导图自行决定的执行器逻辑。实现时应先明确策略并版本化记录，不能声称原 skill 已解决。

| 位置/问题 | 原文内容之间的张力或未定义之处 | 本文与导图的表达 |
| --- | --- | --- |
| Phase 5 的 rejected 范围 | S4:122 只规定对 confirmed/NV 启动普通复核；S4:147、153 又使用 every retained record/every record 的宽泛要求。 | 普通派发按明确两类集合展示，同时标注 rejected 的全记录门禁措辞有歧义；不杜撰自动再审 rejected 的机制。 |
| `run_status=complete` 时点 | S4:147 以候选定案/Phase 5 通过为标记条件；S1:179 要求 Phase 6 全部产物与校验才能达到成功终态。 | 分开显示“记录审查已完成”和“全流程完成”；后者以 S1 总终止契约为准，说明这是解释优先级，不是已有确定性状态机。 |
| 初始 metadata 信息补齐 | S1:86 要求委派前包含专项选择/历史输入，但这些信息可能依赖后续侦察；未规定占位形式。 | 先记录已知运行事实、后续补齐是实现候选策略，不作为原有字段/步骤；导图明确未知结构。 |
| critic 的逐项理由 | S3 返回模板的 reassign_ids、resolved_prior_leads 只是字符串数组，正文同时要求源支持的重派/解决理由。 | 保留已定义字段和另有理由要求；不假设一个未定义的理由 JSON 已存在。 |
| 候选拒绝后的覆盖状态 | 正文要求把 verifier decision 写入每个关联单元，但未固定该 bookkeeping 字段名，也未统一规定 candidate→covered。 | 显示裁决与覆盖状态两个独立维度；不画无依据的自动状态转移。 |
| 架构刷新和调查事件 | 没有 architecture 的强制增量刷新策略，也没有完整初始假设/修改/放弃的事件契约。 | 明确区分现有产物与建议采集项 X。 |

### 12.2 Hunter 提示词组装的九个组成部分

来源 [HUNTING.md:11](/Users/daitongmin/.codex/skills/security-audit/HUNTING.md:11)。这九项是提示词输入要求，不能从最终 findings 反推实际 prompt 一定包含。

| 顺序 | 组成内容 | 作用 |
| --- | --- | --- |
| 1 | 两句角色前言 + 唯一 JSON 返回要求 | 明确目标与输出纪律。 |
| 2 | `architecture.md` 原文 | 提供共同架构事实。 |
| 3 | 分配 IDs、子系统、边界、起始路径和各单元 block map | 限定调查对象与覆盖义务。 |
| 4 | 普通块及专项 Core discipline、选中类别、Universal moves、Validation rules 的原文 | 给出具体分析思路和确认门槛，不能只给名称。 |
| 5 | 显式排除块与逐项理由 | 说明不调查什么及其依据。 |
| 6 | 核心调查方法 + 证据晋升完整程序 | 约束调查深度、隔离执行与保留证据。 |
| 7 | 核心 candidate gate | 禁止推测升级与无边界 finding。 |
| 8 | 同源码历史确认的 fingerprint/title/root cause 排除 + peer 单元排除 | 限制重复调查，但不抑制其他根因。 |
| 9 | scratch/artifact 路径、Agent ID、晋升 allowlist/字节上限、Hunter 返回模板与 confirmed/NV schema 分支原文 | 明确隔离边界及完整记录契约。 |

## 13. 漏洞假设、分析方式与思考路径：现有机制实际记录了什么

### 13.1 调查链对应表

| 调查环节 | skill 要求的动作 | 现有可找的字段/内容 | 已有记录程度 | 缺少什么 |
| --- | --- | --- | --- | --- |
| 观察事实 | 读入口、主体、控制、路径 | Recon 返回、architecture、`evidence`、`reviewed_paths` | E/N，分散且摘要化 | 原始事实 ID、发现时间、与推断的显式区分。 |
| 确定安全目标 | 从具体 invariant 出发 | `invariant`、`intended_behavior`、boundary | E | 该目标从哪条规范/源事实推导。 |
| 提出初始假设 | 猜测某个控制/路径可能违反边界 | `claimed_root_cause` 或最终 `root_cause`、description | 部分 E；通常已是筛选后的候选 | 未达到 candidate gate 的最初假设、生成时间和版本。 |
| 前提分析 | 主体起始能力、可控输入、必要状态和依赖 | attacker_perspective、conditions、blockers | 部分 E/N | 前提逐项状态、支持/反驳来源与变化史。 |
| 经验推断 | 按类别/类似形态/历史经验寻找失败机制 | block map、prior_status、可比基线、自由文本 | N/E 间接 | 哪条经验用于哪条推断；相似机制的适用条件。 |
| 分析方法选择 | 深读代码、前向/反向追踪、比较、生命周期、算术等 | `method=source/local`、instructions/result | E 粗粒度 + N 文本 | 标准具体方法码、选择理由、开始/结束、工具关联。 |
| 支持/反驳 | 找最强防护、反例和可行路径 | evidence、result、rejected reason、verifier 返回 | E | 每条证据明确支持/反驳哪个前提或假设。 |
| 转向/修改 | 新事实改变路径、结论或范围 | uncovered、attempts、replace | 部分 E | 一般假设修改/拆分/合并/放弃历史。 |
| 停止调查 | invariant 已判定/未知决定性条件/预算或范围限制 | disposition、unresolved、blockers、deferred reason | E/N | 早期放弃理由、剩余替代解释。 |
| 最终确认 | 路径+最小观察+独立反驳验证 | verdict、execution、trace、evidence | E 较完整 | 从最初假设到结论的全部事件关联。 |

`trace` 不等于思考路径；`attempts` 不等于思考路径；`confidence` 不等于合理假设概率。应记录可审计的依据和决策摘要，不要求模型暴露逐 token 的隐藏推理。

### 13.2 核心分析方法目录

以下中文方法名是对明确指令的整理；右侧建议方法码 X 不是原有枚举。方法是否实际使用必须看运行证据。

| 分析方式 | 在做什么 | 应留下什么可观测依据 | 现有出处 | 建议方法码 X |
| --- | --- | --- | --- | --- |
| 主体—能力—资源分析 | 确认起始权限和受保护操作 | identity/authority 控制位置、正常允许动作 | S1、S2、S3 | `principal_capability_analysis` |
| 安全不变量驱动 | 指定必须绑定/隔离/限制/撤销的条件 | invariant、控制位置、违反时的最小结果 | S3 | `security_invariant_analysis` |
| 前向 source-to-sink | 输入经解析、授权、规范化、状态到 sink | 有序 trace 和每一跳依据 | S3、S8 Injection | `forward_flow_trace` |
| 反向 sink-to-source | 从敏感工具/DOM/发行物等向上找控制者 | sink、来源、能力授予路径 | 各专项 Universal moves | `backward_flow_trace` |
| 并行/兼容路径比较 | 比较正常、legacy、batch、retry、error 等同效路径 | 两条路径的控制差异 | S3、各专项 | `parallel_path_comparison` |
| 组件契约比较 | 上游保证与下游假定是否一致 | 两侧值、单位、归属或策略差异 | S3、Chained、RPC 等 | `cross_component_contract_analysis` |
| 状态机/生命周期 | 检查撤销、恢复、迁移、取消、过期等 | 状态前后、合法转移、失效点 | S8 Business、专项 | `state_lifecycle_analysis` |
| 二阶/衍生副本追踪 | 存储后再次使用，或缓存/搜索/导出副本 | 写入者、消费者、ACL/上下文变化 | S8、Data、AI | `derived_data_lineage_analysis` |
| 解析/规范化差异 | 同输入在两个消费者里如何解释 | 同 fixture、两侧解析/键/主体值 | Web、RPC、Client | `parser_policy_differential` |
| 边界/单位/整数重算 | 长度、容量、元素大小、符号、窄化等 | 计算式、类型、最坏可接受输入 | Memory | `bounds_representation_analysis` |
| 所有权/生命周期 | free、回调、视图、teardown 是否一致 | 所有 owner、释放/使用路径 | Memory | `ownership_lifetime_analysis` |
| 并发/TOCTOU | 检查后状态在使用前变化 | 锁、原子性、时序和重复可行路径 | S8、Memory、Desktop | `concurrency_interleaving_analysis` |
| 身份/令牌绑定 | 凭据与用户/会话/资源/受众/一次状态是否绑定 | 验签与绑定两类控制 | Web、RPC | `identity_binding_analysis` |
| 授权与意图绑定区分 | 操作有权执行但是否被当事人真实请求/批准 | 规范批准对象与最终执行对象 | AI、Desktop | `action_intent_binding_analysis` |
| 威胁/能力链前提检查 | 每个上游结果是否真实支持后续决策 | 各前提的支持与未知 | S3、Chained | `prerequisite_chain_analysis` |
| 配置合成/默认行为 | 追踪 overlay、feature、版本默认到活跃路径 | 最终配置、选择它的源定义 | Cloud、Web、Desktop | `effective_configuration_analysis` |
| 软件/历史类比 | 用源可见对照或历史结果校准调查 | 对照来源、差异与适用性 | S2、S3 | `experience_pattern_application` |
| 通用关键词定位 | 查 secret、TODO、eval、debug 等入口线索 | 搜索结果后继续完整路径追踪 | S8 Obvious things | `lexical_lead_search` |
| 测试缺口/异常阅读 | 从没有测试、奇怪旧代码/fallback 发现线索 | 异常位置、缺口、具体边界 | S8 Wildcard | `anomaly_test_gap_analysis` |
| 复杂度/成本建模 | 输入增长、fan-out、持久资源与恢复范围 | 数量/复杂度依据、现有上限 | Availability | `input_to_resource_cost_analysis` |
| 反例/最强防护搜索 | 主动寻找阻止假设成立的控制 | 最强控制、不可达/合法动作反例 | S3、S4 | `adversarial_refutation` |
| 同根因变体搜索 | 在负责单元内找词法、结构、逻辑变体 | 各变体条件/影响与关联 | S3 | `root_cause_variant_search` |
| 覆盖缺口检查 | 检查遗漏入口/生命周期/排除理由 | missing/reassign 及源支持理由 | critic | `coverage_gap_analysis` |

### 13.3 验证方式目录

| 验证方式 | 实际能验证什么 | 必须记录 | 不足以证明什么 | 来源 |
| --- | --- | --- | --- | --- |
| 源码重构/反驳 | 路径、防护、不可达前提、正常权限 | 引用、检查对象、实际源依据 | 静态阅读不自动替代 confirmed 所需本地观察 | S3、S4 |
| 已有单元测试 | 最窄函数/条件行为 | 原测试/调整 fixture、调用、输出 | 测试名叫 security 不等于证明边界 | S1、S3 |
| 最小 function harness | 局部接受输入与错误行为 | 原函数版本、参数、构建/执行条件 | harness 人为改变语义不能证明原目标 | S3 |
| dummy-tenant 集成测试 | 跨主体访问、更新、撤销等 | 两主体权限、假记录、路径、观察 | 不能用真实用户数据或凭据 | S3、Data |
| 解析/消息差分 fixture | 两消费者解析差异 | 相同原始输入、两侧输出、后续作用 | 仅差异而无安全影响不够 | Web、RPC |
| sanitizer | 无效读/写、生命周期等可仪器化错误 | 工具版本/配置、被仪器化操作、精确输入、诊断 | 不自动证明代码执行或全路径覆盖 | Memory |
| 有界 fuzz/regression | 特定输入空间的本地违规 | 种子、限制、最小失败输入、重跑 | 不证明无其他漏洞 | S3、Memory |
| 确定性并发调度 | 可重复竞态/不变量失败 | barrier/schedule、线程事件、观察 | 口头假想 interleaving 不够 | S3、Memory |
| 本地浏览器测试 | DOM/消息/存储/跨源策略实际行为 | 版本、测试 origin、假账户、策略、观察 | 部署 header 不可见时不能推定线上成立 | Client |
| 本地模拟器/IPC fixture | 原生桥、身份与方法绑定 | OS/模拟器版本、peer、dummy 资源、操作 | 不推断实际设备/打包权限 | Desktop |
| 本地策略渲染/评估 | 活跃源配置和权限结果 | overlay、版本、生成对象、dummy 身份 | manifest 不等于线上附件已生效 | Cloud |
| 有界复杂度/泄漏检查 | 小输入增长/资源保留/取消传播 | 小增长点、限制、持久资源、清理/恢复 | 不允许压测共享/线上系统 | Availability |
| mock 外部/付费调用 | 请求绑定、预算、循环等本地逻辑 | mock 行为和真实依赖差异 | mock 结果不证明 provider 的真实行为 | S3、AI |
| owner-observed 部署检查 | 精确未知配置/identity/route 等 | 计划；将来由 owner 提供的实际证据 | 当前只是计划，不算执行/确认 | S4 |
| 机械 JSON 校验 | 结构、身份、有限一致性约束 | 脚本版本、输入哈希、退出码、错误 | 不证明漏洞、工具执行或证据真实性 | S6、S7 |

这是“可用方法”清单，不是默认全部执行。除两个结果校验器外，skill 没有保证调用某个扫描器或 API；各工具是否存在、被选用、实际调用由环境和任务决定。

## 14. 十个专项的分析职责

| 专项文件 | 使用前提 | 假设形成重点 | 分析/验证重点 | 关键未知 |
| --- | --- | --- | --- | --- |
| `MEMORY-SAFETY-AND-BINARY.md` | 不可信字节进入 native/unsafe/特权环境 | bounds、类型、单位、寿命、ABI、loader、并发 | 两侧 contract、最坏边界、sanitizer/harness、确定性调度 | 架构、ABI、allocator、instrumentation、实际可达性 |
| `AI-AND-LLM.md` | 模型参与信任敏感决策 | 不可信上下文→能力/身份/持久状态/输出 | 可写源、执行身份、handler 授权、意图绑定、MCP 相关性 | provider/model/部署/renderer/外部身份 |
| `WEB-PROTOCOL-AND-AUTH.md` | HTTP/缓存/浏览器身份/令牌 | 请求解释差异、credential 绑定与 assurance | 相同请求/token fixture、两侧 parse/key、合法/非法状态 | proxy、IdP、cookie 行为、证书/secret、配置 |
| `CLIENT-SIDE.md` | 浏览器 DOM、origin、消息、存储 | 攻击者可控源→victim sink/持久状态 | origin/source、gadget、CSP 等、dummy 浏览器生命周期 | renderer/extension 权限/header/browser 版本 |
| `SUPPLY-CHAIN-AND-RELEASE.md` | 依赖、CI、构建、签名、发布、更新 | 低信任输入跨入受信构建/产物 | writer→job→immutable artifact→consumer；dummy marker | hosted runner/branch policy/registry/signing/promotion |
| `CLOUD-AND-DEPLOYMENT.md` | IAM/IaC/container/serverless 等 | active 配置和 workload 能力是否越界 | render overlays、policy、identity/resource 选择 | 实际附件、网络、admission、drift |
| `PROTOCOLS-RPC-AND-MESSAGING.md` | RPC/schema/broker/stream/event | channel 身份与业务主体、解码与顺序保证 | producer→transport→consumer、两 parser、重试/提交测试 | broker ACL、mesh、topic、实际 delivery 语义 |
| `RESOURCE-EXHAUSTION-AND-AVAILABILITY.md` | 不可信工作影响共享资源/运营成本 | 输入→工作量→持久资源→共享影响 | 复杂度/上限、cleanup/cancel、严格限额的小规模测试 | upstream caps、topology、autoscaling、quota/recovery |
| `DATA-ISOLATION-AND-LIFECYCLE.md` | 多租户、derived copies、撤销/删除 | primary 与所有副本的 ACL/lifecycle 分歧 | 数据谱系、query/key、dummy tenant、restore/revoke | 外部 storage/cache/replica/backup/retention |
| `DESKTOP-MOBILE-AND-LOCAL-IPC.md` | native app、bridge、helper、IPC | 不同 OS/app/内容主体的权限与意图混淆 | peer credential、最终资源授权、local emulator/fixture | signing、manifest merge、ACL、OS/device/packaging |

每个专项的准确类别名称和原文定位见附录 B。类别是方法提示块，不是已经生成的漏洞假设。

## 15. 校验器到底保证什么

| 校验对象 | 真正执行的检查 | 不能由 PASS 推断 | 适合额外保存 |
| --- | --- | --- | --- |
| ledger 结构 | 必需字段、集合/深度/输入上限、类型、状态 | 每个入口都被发现了 | 输入原文/哈希、退出码、错误列表 O/X |
| coverage 身份 | NFC/ref 编码、ID 推导、排序、重复/语义 identity 冲突 | 入口/边界标签在真实源码中正确 | canonical_refs 与源引用证据 |
| block map | 基本字符串、集合、selected/excluded 冲突 | 块名真实存在、prompt 已逐字复制、边界选择合理 | 实际 prompt、块版本/摘要、父端选择理由 |
| check/attempt | owner 格式、路径并集、source/local artifact 归属格式、历史 wave/owner/证据复用约束 | 文件真实存在、是普通文件、已经安全晋升或测试真的运行过 | 文件晋升事件和 artifact 元数据 |
| finding 分支 | 匹配恰一个 schema 分支、必需/禁止字段、可见文本 | claimed/root_cause 的逻辑正确 | 原始独立 reviewer 返回 |
| source 路径/行号 | 相对路径安全格式、正整数行号 | 文件存在、行有效、函数真实、描述准确 | 固定源码快照、读源/核对事件 |
| trace | entry→propagation→sink 的类型次序 | 每一跳真实可达或数据确实传播 | 节点间关系和支持证据 X |
| finding 身份 | 指纹唯一、按字典序排序、字符格式 | 不同指纹没有同根因、跨运行语义稳定 | 显式 dedup 判断和 merge 关系 X |
| severity | overall 不高于 impact | 等级符合真实影响，或置信度已校准 | 每次评分来源和 reviewer 变化 |
| NV 计划 | 至少一条可见 local/deployment 文本 | 计划适用、安全可做或已经执行 | 计划与实际 check 分开保存 |
| 两文件联合关系 | 两脚本分别各自校验输入 | 每个 ledger 指纹在 findings 中有对应记录、反向关联完整、所有 candidate 均有裁决 | 数据库/外层执行器的独立关系校验 X |

### 15.1 实际输入/资源上限

| 限制 | ledger validator | findings validator | 说明 |
| --- | --- | --- | --- |
| 输入字节 | 5 MiB | 5 MiB | 常常先于理论数量上限触发。 |
| 顶层项 | 10,000 units | 1,000 findings | findings 的所有数组同时受 1,000 项上限。 |
| 嵌套集合 | 数组 1,000；对象字段 1,000 | 数组 1,000 | 不应混为数据库业务限制。 |
| 深度 | 64 | 64 | 防资源消耗。 |
| 总 preflight values | 500,000 | 没有同名总值上限 | 不能假设两个脚本限制完全一致。 |
| 普通 ledger 文本 | 多处最多 4,096 JS 字符 | 无同类统一文本上限 | 各路径/coverage/ref 另有规则。 |
| canonical key | 无同名限制 | 单个 1 MiB | 用于唯一性比较的内部表示。 |
| uniqueness set | 无同名限制 | 5 MiB | 是内部计算上限。 |
| 错误输出 | 最多 100 | 最多 100 | 达上限不代表只存在 100 个错误。 |
| 文件安全打开 | no-follow、nonblocking、普通文件、严格 UTF-8 | 同类保护 | 这是校验器输入保护，不是 scratch 晋升程序本身。 |

脚本是 CLI 文本输出：成功 `PASS: ... valid` 且退出 0；失败 `ERROR:`/`FAIL:` 或读/解析失败消息，退出 1。若做 MySQL 分析，应从执行器捕获，不应假定原脚本输出 JSON。

## 16. 为假设与调查轨迹建议增加的记录（全部 X）

本节是采集契约建议，不是已实施修改，不是读取隐藏思考。不要把这些属性加进禁止额外属性的原始 finding 分支；放入侧车事件或独立数据表。

### 16.1 过程事件公共字段

| 建议字段 | 含义 | 来源/采集点 | 必要性 |
| --- | --- | --- | --- |
| `event_id` | 一条事件唯一标识 | 可信执行器 | 追加而不是覆盖。 |
| `run_id` | 运行关联 | metadata/执行器 | 必需。 |
| `event_type` | 事件类别 | 采集器映射 | 不混入 verdict。 |
| `phase` / `step_code` | 阶段/具体动作 | 执行器或明确标注的 Agent 结果 | 与本文件 P 编号约定绑定版本。 |
| `agent_instance_id` / `parent_agent_instance_id` | 实例与委派关系 | 平台可见数据 | 角色标签不能代替实例 ID。 |
| `task_id` / `attempt_id` | 调用与重试 | 执行器 | malformed/retry 必须保留。 |
| `coverage_ids` / `hypothesis_ids` / `fingerprints` | 多对多关联 | 明确返回/外层映射 | 未生成 fingerprint 的早期假设也有身份。 |
| `sequence_no` / `occurred_at` / `captured_at` | 序号、发生和采集时间 | 平台/采集器 | 并行时靠因果关系，不只靠时间排序。 |
| `caused_by_event_id` | 直接触发事件 | 明确关联 | 证据→修订→新 check。 |
| `origin` | `runtime_observation/agent_statement/posthoc_summary` 等 | 采集器 | 区分观察事实、模型自述与事后整理。 |
| `payload_ref` / `payload_hash` / `schema_version` | 原始内容引用、完整性、记录版本 | 可信采集器 | 对敏感内容只保存允许的受控引用/摘要。 |
| `recorded_status` / `error_category` | 采集/执行成功、失败原因 | 平台真实返回 | 不把未采集当作“没有发生”。 |

### 16.2 假设对象与版本

| 建议字段 | 含义 | 为什么现有记录不够 |
| --- | --- | --- |
| `hypothesis_id` | 从最初怀疑就分配的 ID | fingerprint 只对已形成根因主张稳定，不覆盖全部初始怀疑。 |
| `hypothesis_version` | 第几版 | 最终 root_cause 会覆盖原措辞。 |
| `statement` | 当时提出的主张 | 不应从 confirmed 描述反向编造。 |
| `invariant` | 所要检验的安全要求 | 已有 check.invariant，但不绑定初始假设版本。 |
| `attacker_principal` / `starting_capability` | 起始主体与真实能力 | 原义散落在 description/attacker_perspective。 |
| `controlled_input` / `expected_boundary_failure` | 可控项与预测最小结果 | 原 trace 只存路径，不能替代预测。 |
| `supporting_fact_refs` / `counterevidence_refs` | 当时支持/反驳引用 | 原 evidence 没有关系类型或发生时间。 |
| `premises` | 前提对象集合 | confirmed conditions 没有逐前提认识状态。 |
| `premises[].statement` / `premises[].status` | 前提内容，`supported/unknown/refuted` 等 | 未知不能自动当满足。 |
| `premises[].evidence_refs` | 前提对应证据 | 允许核查经验推断的依据。 |
| `experience_basis` | 使用了哪条类提示/历史经验/源可见对照 | block 选中不证明该经验参与了实际推断。 |
| `applicability_rationale` | 为什么该经验适用于当前项目的短理由 | 记录可审计说明，不要求完整内部链。 |
| `alternative_explanations` | 当前保留的替代解释 | 减少把缺失局部控制直接等同漏洞。 |
| `next_discriminating_check` | 下一项能区分主张与反例的检查 | 阻塞后的 plan 不覆盖调查全过程。 |
| `hypothesis_status` | `proposed/revised/under_test/refuted/blocked/withdrawn` 等自定义枚举 | 不用 finding verdict 覆盖早期过程。 |
| `supersedes_version` / `split_from` / `merged_from` | 修订、拆分、合并关系 | 根因去重没有历史关系对象。 |
| `change_reason` / `trigger_evidence_refs` | 为什么变化、哪条证据触发 | 不能只保留新版本。 |

若未来记录初始“概率/评分”，单独叫 `estimated_support` 等，保留未校准标记与评分版本；不要套用 confirmed 的 confidence，更不要把 LLM 自报数字当作真实概率。

### 16.3 分析动作、验证执行与理由

| 建议字段 | 内容 | 采集方式 |
| --- | --- | --- |
| `analysis_action_id` / `method_code` | 具体分析方式和版本 | 第 13.2 节受控词表 + 当时简短 Agent 声明。 |
| `selection_rationale` | 为什么选择这条分析路线 | 模型明确输出；不是读取内部推理。 |
| `tool_call_id` / `tool_name` / `tool_version` | 真正调用的工具/版本 | 平台实际工具日志；不可根据 method 猜工具。 |
| `inputs_ref` / `command_ref` | 安全允许的输入/命令 | dummy fixture、必要无秘密参数，按采集策略脱敏/拒收。 |
| `reviewed_source_refs` | 被读代码位置、版本/摘要 | 原有引用 + 读源事件；看到读取不代表理解正确。 |
| `expected_result` / `actual_result` | 检验前预测与实际观察 | 必须分时保存，避免事后改预测。 |
| `exit_code` / `stdout_ref` / `stderr_ref` | 进程实际执行证据 | 平台可见返回，受控存储。 |
| `sandbox_policy_ref` / `sandbox_enforcement_result` | 规定配置与真正实施结果 | 可信执行器检查，不只 Agent 文字承诺。 |
| `artifact_id` / `artifact_hash` / `promotion_result` | retained 证据、完整性、晋升门 | 父端可信事件。 |
| `limitations` / `unresolved_facts` | 检查无法建立的部分 | 当时输出的短摘要。 |
| `conclusion_relation` | 支持/反驳/不足以决定哪个假设或前提 | 显式关系 + 来源；不能由退出 0 自动推断支持。 |
| `decision_summary` / `decision_basis_refs` | 保留、转向、停止等理由摘要 | 当时可审计外显决策；后补要另标 posthoc。 |

### 16.4 建议过程事件类型及采集点

| 建议事件 | 采集时机 | 最少关联数据 |
| --- | --- | --- |
| `run_started` / `run_finished` | 开始/整体终止 | run、版本、范围、状态和限制。 |
| `phase_started` / `phase_finished` | 阶段边界 | phase、输入/输出快照、是否完整。 |
| `agent_assigned` / `agent_returned` / `agent_failed` | 委派前、原始返回、错误 | 实例、任务、prompt 版本、原始返回、真实错误。 |
| `recon_fact_reported` / `architecture_synthesized` | 事实返回、摘要完成 | 事实源引用、生产者、摘要包含/未包含信息。 |
| `attack_block_selected` / `attack_block_excluded` | 方法选择 | 精确块名/版本、证据支持的理由。 |
| `hypothesis_proposed` / `hypothesis_revised` / `hypothesis_withdrawn` | 当时显式形成/改变/放弃 | 原版本、新版本、理由、触发证据。 |
| `analysis_action_completed` | 完成源码分析动作 | method、检查对象、支持/反驳/未知。 |
| `tool_called` / `tool_returned` | 平台调用/返回 | 工具、受控参数、调用结果、时间/用量若可见。 |
| `local_check_completed` / `artifact_promoted` | 本地观察、可信晋升结束 | fixture、真实结果、沙箱门、retained hash。 |
| `candidate_proposed` / `candidate_gate_rejected` | 候选形成/在 Hunter 门中淘汰 | 原始主张、被阻断条件；后者目前无强制完整日志。 |
| `candidate_merged` | 去重 | 来源假设/候选、多对一根因、合并理由。 |
| `critic_returned` / `critic_suggestion_decided` | critic 返回和父端接受/拒绝 | 原建议、源依据、决定，不只剩接受后的账本。 |
| `coverage_reassigned` / `coverage_deferred` | 重派/预算范围分支 | old attempt、新 owner/wave、原因。 |
| `verification_decided` / `record_replacement_proposed` | P3/P5 原始返回 | reviewer、输入 record 版本、决定、差异。 |
| `replacement_verified` / `replacement_applied` | 重大替换复查/真正应用 | 独立实例、验证链、前后版本。 |
| `validator_completed` | 每次校验 | 脚本/hash、输入/hash、退出码、错误和上限截断标记。 |
| `file_version_written` / `report_generated` | 共享文件每次写完 | 文件路径、内容 hash、版本、产生它的事件。 |

在当前无完整编排器的情况下，平台未开放的工具/Agent 事件可能无法自动采集。此时记录“未采集/不可获取”，不能假设可实时钩住任意动作。

## 17. MySQL 之前的数据对象映射（建议，不是建表实现）

| 逻辑对象 | 原始来源 | 主关联 | 为什么不能只存一个大 JSON |
| --- | --- | --- | --- |
| 运行 | metadata + 执行器 | run_id | scope、skill 版本、源码版本和成本基线。 |
| Agent/调用尝试 | Task 运行日志 | run + instance/task/attempt | 角色与实例分开，保留重试。 |
| prompt/方法块版本 | 真实 prompt + 本地文件摘要 | 调用 + prompt hash | 判断收益是否来自 prompt 修改。 |
| 侦察事实 | Recon 原始返回 | run + producer + source | 可研究事实质量/摘要遗漏。 |
| 覆盖单元/尝试 | ledger live/attempts | run + coverage_id + attempt | 当前视图与历史记录分开。 |
| 假设/版本/前提 | 第 16 节新增外显记录 | hypothesis_id + version | 未达到候选门的调查也可研究。 |
| 分析动作/检查 | checks + 显式方法声明 | action + hypothesis/version + coverage | source/local 不足以比较具体方法。 |
| 工具调用/本地执行 | 平台日志、artifact | action + tool_call/check | 方法声明必须与真实执行区分。 |
| 候选/发现版本 | Hunter/P3/P5 原始 record | fingerprint + record version | verdict 变化和文本替换不能覆盖历史。 |
| 去重/多单元关联 | Parent 明确决定 + ledger | candidate/fingerprint ↔ coverage | 多对多、独立根因区分。 |
| 验证/替换链 | P3/P5 返回 | 输入版本 + verifier + 后继版本 | 追踪意见变化和独立性。 |
| critic/父端决定 | critic 返回和接受/拒绝 | unit/proposal + event | 不把所有建议当已执行任务。 |
| 证据/源码引用 | evidence、trace、artifact | source snapshot + ref / artifact hash | 引用与文件内容、动态观察分开。 |
| 状态/过程事件 | 附加可信采集 | run + event + caused_by | 重建执行轨迹，而不冒称完整内部推理。 |
| 输出文件/报告快照 | 七个文件每次版本 | run + artifact version | 报告是派生产物，不重复计算成新漏洞。 |

MySQL 类型、DDL、索引、增量写入和执行器接入是下一阶段；本文件只确定语义。数据库的主键、时区、原文保留策略和多对多关系不应直接沿用某个显示标题。

## 18. 用这些数据能分析什么，不能分析什么

| 分析问题 | 原文件能支持到哪里 | 还需要什么 | 关键偏差 |
| --- | --- | --- | --- |
| 每个阶段做了什么 | 文件规范和最终状态 | 实际调用/阶段事件 | 按规范推断执行会漏违规/失败。 |
| 谁提出了什么假设 | 最终根因与归属间接关联 | initial hypothesis、版本、producer | 只看幸存候选会产生选择偏差。 |
| 什么方法有效 | source/local + attack class | 具体方法、真实工具、预算和未成功尝试 | 类别有效不等于工具或推理方式有效。 |
| 侦察如何影响 hunting | architecture、block map | 原事实、选择理由、下游假设关联 | 摘要压缩和代码可见性差异。 |
| 为什么判 confirmed/rejected | 当前 record 和部分 checks | 原主张、独立 verifier 输入/输出、替换链 | 当前 record 可能已覆盖最初错误。 |
| 哪些前提经常无依据 | blockers/conditions 自由文本 | 前提逐项 known/unknown/refuted、源关系 | “未找到支持”不总等于前提错误。 |
| 独立验证是否真正独立 | check.agent_id 与 unit owner | 完整实例谱系、prompt、上下文共享情况 | 新 Agent 不保证训练或推断错误独立。 |
| 成本/发现效率 | budget 是调用上限 | 实际次数、时间、可见 token/金额 | 模型价格和失败重试成本须实际记录。 |
| 覆盖是否增长 | units、waves、attempts、critic | 版本快照与稳定关联 | unit count 不是完整漏洞 recall。 |
| 假设合理性/泛化论文 | 源证据、结果、方法块 | 前瞻性假设、跨项目控制实验、独立评价 | 最后成立不等于生成时合理，没确认不等于错误。 |
| skill 修改是否改善 | 当前最终输出 | skill/prompt/source/model/budget 版本固定对照 | 多用了资源、换模型或目标变化会混淆。 |

## 19. 采集安全与可信性要求

| 风险 | 最低处理原则 |
| --- | --- |
| 把 MySQL 接入目标沙箱 | 目标代码不应获得数据库连接、账号、网络或共享存储；由可信父端/执行器写库。 |
| 收集 ambient environment | 不捕获主机完整环境、凭据、认证状态和不相关路径；只允许必要安全变量名/值。 |
| 原始源码/工具结果含秘密 | 原始日志并非一律可存；限制内容、访问和保留，必要时拒收正文、只留受控摘要/引用。 |
| 直接导入 scratch | 保持原父端 no-follow/普通文件/大小/身份晋升门；不要为日志便利绕过。 |
| LLM 声明当实际执行 | 明确 agent_statement 与 runtime_observation；命令文本不等于命令已运行。 |
| 日志被提示注入影响 | 日志/源码/工具文本作为不可信数据处理，不当作修改采集器或数据库权限的指令。 |
| 重试覆盖旧记录 | 事件和版本追加保留；当前视图可更新，历史不能静默覆写。 |
| 后补理由伪装实时推断 | 标记 posthoc_summary，留生成时间与输入来源；不得当成生成时证据。 |
| 以采集代替审计门禁 | 入库成功、JSON PASS、模型声明 confirmed 是三种不同事情。 |

## 20. 当前整理结论

| 结论 | 对后续工作的意义 |
| --- | --- |
| 核心流程有明确规定，但不是完整自动执行器 | 需要观察实际行为，而不是仅解析 Markdown。 |
| 最终结果字段较完整，覆盖账本也有严格状态约束 | 可以先导入权威产物，建立 run/unit/finding/check 基础。 |
| 侦察事实没有统一 schema | 要保留原返回，再决定规范化结构，不能只保留 architecture。 |
| 初始/淘汰/修订假设没有完整历史 | 若研究合理性，这是必须补的前瞻性采集点。 |
| `method` 只有 source/local | 分析方式和验证方式需单独、版本化的扩展词表。 |
| 代码 trace 不等于调查轨迹 | 另存实际事件、证据关系和明确决策摘要。 |
| 两个校验器只做结构和有限一致性 | 文件存在、执行真实性、根因正确、联合关联需另检。 |
| 没有内置 MySQL/完整模型调用日志/隐藏思考接口 | 接入能力需依据实际平台，不能先许诺完整采集。 |
| 初次整理新增本说明；后续复核补充解释并另存交互导图 | 未更改原 skill 和其他研究方案，未建立数据库；复核范围与局限见第 0.3、12.1 节。 |

## 附录 A. 本地版本指纹

下列 SHA-256 用于本文件分析基线，不能替代运行时保存 skill/prompt 的具体版本。测试文件登记只为版本完整性。

| 文件 | SHA-256 |
| --- | --- |
| `SKILL.md` | `5e3e96a1e438d8f35fef0a1e38f02d4f00e2bdf910401b7dfe00e6779c6dac85` |
| `RECONNAISSANCE.md` | `02ca887aca84de8ae137f1891bd2f0a54f28d3fa6da92a27f54734382b3381a2` |
| `HUNTING.md` | `71c121decea1322c47c718f6e110f1a892980bb4266bd7ac55ef043a213ade09` |
| `VALIDATION-AND-REPORTING.md` | `b892470cb89bb31f33403e050d4bdfbe2cdaef940ade1496fa65e32b2e129449` |
| `ATTACK-CLASSES.md` | `3ee4f00c6e8c9dcf6dd02dd5ac2a4ceb322e2085f3e9fbe79cf0c6330bc7ef83` |
| `report-schema.json` | `6575c9de4a62255699ea052ebf9a49ebfb373a32891bcd89af6f55cc84b35519` |
| `validate-findings.cjs` | `e85f232e36bfac0f866f244da50376692d6b45c690beadcb00608b0e6c8b5283` |
| `validate-coverage-ledger.cjs` | `2eb280bd2e33c002916f86db9b29f9edfedb6454e5db973c766290465b868ac8` |
| `validate-findings.test.cjs` | `b92001117a92c4161d43777a0ba2fa182a8a4d97f2304cc8c0cee5331497b73b` |
| `validate-coverage-ledger.test.cjs` | `cfb9df26b03469a4279a70e7664a2a5434dd6f8c2c204e91f9b0aeb9dd71e648` |
| `AI-AND-LLM.md` | `7335a95c43554eadefcf03ece639291bb0e038c398a179299e3887ffe06bd2ef` |
| `MEMORY-SAFETY-AND-BINARY.md` | `7c8b0dccfb35315cca2455509674d49632b2fe37e1f3aac16c1a496a7e9924a7` |
| `WEB-PROTOCOL-AND-AUTH.md` | `4f3066dffa23c5635859187be9b96c32f2aff29a688186b91ff0c63e47d62b5c` |
| `CLIENT-SIDE.md` | `613f6b98f86083e045525c5b60154ffdab122bac35f1e05eb17488e6e453370c` |
| `SUPPLY-CHAIN-AND-RELEASE.md` | `f372e919940e335468ba1ae09f99026c3986a345f7fe26f8068f132e199f52a5` |
| `CLOUD-AND-DEPLOYMENT.md` | `3c80f3088be22345e07b057c056d6ed99fe2b0304f794398964f7ccd5a496ca3` |
| `PROTOCOLS-RPC-AND-MESSAGING.md` | `8b73816fa5b3697c9c40977f0c836b40f01d6e81929ff2720fe83ce089e9a619` |
| `RESOURCE-EXHAUSTION-AND-AVAILABILITY.md` | `4326fab5c92a0b4c420a70196254040105cd794026562130b59bf1a6db3e4baa` |
| `DATA-ISOLATION-AND-LIFECYCLE.md` | `307dcb3e24d292715c4a041190e7bb135646a37eb6187619ae01d000a634a4ad` |
| `DESKTOP-MOBILE-AND-LOCAL-IPC.md` | `58eae8ee0ca6a46611c501ec5a3ab47fdff88dd7db0d8d74789bbf8bb19d8cb2` |

## 附录 B. 原有攻击类别与提示块名称索引

下列是当前本地文件的类别精确名称和源码行号，用于关键字检索与 block map 对照；不是已发生的调查或数据库扩展枚举。


原文片段仅用于识别类别意图（超过 220 字符则截短）；完整机制以链接原文及第 13–14 节的整理为准。类别名称保持原文，精确块引用不应翻译或生成 slug。

“类别中文说明”帮助理解名称；“意图片段中文说明”概括该片段关注的缺陷机制，不是完整规则的逐字翻译。两列均为阅读辅助，不替代原有英文类别名、精确块引用或确认漏洞所需的证据条件。

### B.1 ATTACK-CLASSES.md

| 类别原名 | 类别中文说明 | 原文意图片段 | 意图片段中文说明 | 原文位置 |
| --- | --- | --- | --- | --- |
| Injection | 注入漏洞 | Trace untrusted input from entry point to dangerous sink. | 从输入入口追踪不可信数据，检查其是否进入危险操作点。 | [ATTACK-CLASSES.md:29](/Users/daitongmin/.codex/skills/security-audit/ATTACK-CLASSES.md:29) |
| Access control | 访问控制缺陷 | Verify that a caller cannot do something outside its authority. | 检查调用者是否能够执行超出自身权限的操作。 | [ATTACK-CLASSES.md:39](/Users/daitongmin/.codex/skills/security-audit/ATTACK-CLASSES.md:39) |
| Resource and file handling | 资源与文件处理缺陷 | - Path traversal (reading/writing outside intended directories) — including through symlinks, encoded sequences, and null bytes | 检查路径穿越，包括利用符号链接、编码形式或空字节访问预期目录之外的位置。 | [ATTACK-CLASSES.md:49](/Users/daitongmin/.codex/skills/security-audit/ATTACK-CLASSES.md:49) |
| Cryptography and secrets | 密码学与秘密信息缺陷 | - Weak randomness for security-critical values (tokens, keys, nonces) | 检查令牌、密钥、随机数等安全关键值是否使用弱随机性。 | [ATTACK-CLASSES.md:56](/Users/daitongmin/.codex/skills/security-audit/ATTACK-CLASSES.md:56) |
| Business logic | 业务逻辑缺陷 | Hunt logic errors by hand: standard scanners cannot find them, and they yield high-impact findings. | 原文强调深入分析业务逻辑错误，并关注其可能造成的高影响。 | [ATTACK-CLASSES.md:64](/Users/daitongmin/.codex/skills/security-audit/ATTACK-CLASSES.md:64) |
| Feature abuse and data leakage | 功能滥用与数据泄露 | Legitimate features used for unintended purposes. | 检查正常功能是否被用于产品未预期的用途。 | [ATTACK-CLASSES.md:74](/Users/daitongmin/.codex/skills/security-audit/ATTACK-CLASSES.md:74) |
| Chained vulnerabilities and trust boundaries | 漏洞组合与信任边界缺陷 | Individually allowed or contained behavior can become a vulnerability when another component or lifecycle step relies on a stronger guarantee: | 某行为单独看被允许或已受限，但其他组件或生命周期步骤若依赖更强保证，组合后仍可能产生漏洞。 | [ATTACK-CLASSES.md:83](/Users/daitongmin/.codex/skills/security-audit/ATTACK-CLASSES.md:83) |
| Wildcard | 未预设类别的探索 | You are not given a category. | 不指定固定攻击类别，探索常规分类之外的漏洞线索。 | [ATTACK-CLASSES.md:92](/Users/daitongmin/.codex/skills/security-audit/ATTACK-CLASSES.md:92) |
| Obvious things | 显而易见的基础安全问题 | Other agents hunt subtle bugs. | 与调查细微缺陷的其他任务分工，关注容易被默认已检查而遗漏的基础问题。 | [ATTACK-CLASSES.md:111](/Users/daitongmin/.codex/skills/security-audit/ATTACK-CLASSES.md:111) |

### B.2 MEMORY-SAFETY-AND-BINARY.md

| 公共提示块 | 原文位置 |
| --- | --- |
| `MEMORY-SAFETY-AND-BINARY.md#Core discipline` | [MEMORY-SAFETY-AND-BINARY.md:9](/Users/daitongmin/.codex/skills/security-audit/MEMORY-SAFETY-AND-BINARY.md:9) |
| `MEMORY-SAFETY-AND-BINARY.md#Universal moves` | [MEMORY-SAFETY-AND-BINARY.md:89](/Users/daitongmin/.codex/skills/security-audit/MEMORY-SAFETY-AND-BINARY.md:89) |
| `MEMORY-SAFETY-AND-BINARY.md#Validation rules` | [MEMORY-SAFETY-AND-BINARY.md:95](/Users/daitongmin/.codex/skills/security-audit/MEMORY-SAFETY-AND-BINARY.md:95) |

| 类别原名 | 类别中文说明 | 原文意图片段 | 意图片段中文说明 | 原文位置 |
| --- | --- | --- | --- | --- |
| Out-of-bounds read or write | 越界读写 | A length, offset, index, or terminator reaches a fixed or allocated buffer without a correct bound. | 长度、偏移、索引或终止符在缺少正确边界约束时被用于固定或动态分配的缓冲区。 | [MEMORY-SAFETY-AND-BINARY.md:21](/Users/daitongmin/.codex/skills/security-audit/MEMORY-SAFETY-AND-BINARY.md:21) |
| Integer overflow, underflow, truncation, and signedness | 整数溢出、下溢、截断与符号性问题 | Review attacker-controlled arithmetic before allocation, copy, loop, indexing, and pointer operations. | 检查内存分配、复制、循环、索引和指针操作之前由攻击者影响的算术运算。 | [MEMORY-SAFETY-AND-BINARY.md:24](/Users/daitongmin/.codex/skills/security-audit/MEMORY-SAFETY-AND-BINARY.md:24) |
| Unit and pointer-depth confusion | 计量单位与指针层级混淆 | Code mixes bytes, elements, code units, pages, words, wire units, or nested pointer element sizes. | 检查代码是否混用字节、元素、编码单元、页、字、协议单位或不同指针层级的元素大小。 | [MEMORY-SAFETY-AND-BINARY.md:27](/Users/daitongmin/.codex/skills/security-audit/MEMORY-SAFETY-AND-BINARY.md:27) |
| Uninitialized or partially initialized data | 未初始化或部分初始化数据 | A buffer, padding, struct field, or vector capacity is returned, compared, hashed, serialized, or passed across a trust boundary before initialization. | 数据在初始化之前被返回、比较、哈希、序列化或传过信任边界。 | [MEMORY-SAFETY-AND-BINARY.md:30](/Users/daitongmin/.codex/skills/security-audit/MEMORY-SAFETY-AND-BINARY.md:30) |
| Use-after-free, stale view, and double free | 释放后使用、失效视图与重复释放 | Owners are released while callbacks, wait queues, timers, iterators, borrowed slices, or cached raw pointers can still use them. | 所有者已释放对象，但回调、队列、定时器、迭代器、借用切片或缓存指针仍可能使用它。 | [MEMORY-SAFETY-AND-BINARY.md:35](/Users/daitongmin/.codex/skills/security-audit/MEMORY-SAFETY-AND-BINARY.md:35) |
| Type confusion and invalid downcast | 类型混淆与无效向下转型 | A tag, vtable, union discriminator, object kind, or foreign handle is checked differently from the representation later read. | 检查标签、虚表、联合体判别值、对象种类或外部句柄的验证是否与后来读取的表示一致。 | [MEMORY-SAFETY-AND-BINARY.md:38](/Users/daitongmin/.codex/skills/security-audit/MEMORY-SAFETY-AND-BINARY.md:38) |
| Reference-count and ownership races | 引用计数与所有权竞态 | Non-atomic retain/release, a check followed by an unlocked use, or inconsistent ownership across threads can free or mutate an object during access. | 非原子引用操作、未加锁使用或线程间所有权不一致可能导致访问中的对象被释放或修改。 | [MEMORY-SAFETY-AND-BINARY.md:41](/Users/daitongmin/.codex/skills/security-audit/MEMORY-SAFETY-AND-BINARY.md:41) |
| Shared-state races and TOCTOU | 共享状态竞态与检查使用时差（TOCTOU） | Concurrent parser streams, global caches, lazy initialization, signal handlers, and resource teardown can invalidate bounds, policy, or pointers established earlier. | 并发解析、全局缓存、延迟初始化、信号处理或资源销毁可能使先前确认的边界、策略或指针失效。 | [MEMORY-SAFETY-AND-BINARY.md:44](/Users/daitongmin/.codex/skills/security-audit/MEMORY-SAFETY-AND-BINARY.md:44) |
| Lock-order, deadlock, and starvation | 锁顺序、死锁与饥饿 | Externally reachable operations acquire locks in inconsistent order or hold them across callbacks and blocking I/O. | 检查外部可达操作是否以不一致顺序获取锁，或在回调及阻塞 I/O 期间持锁。 | [MEMORY-SAFETY-AND-BINARY.md:47](/Users/daitongmin/.codex/skills/security-audit/MEMORY-SAFETY-AND-BINARY.md:47) |
| Pointer-length and ownership contract mismatch | 指针长度与所有权契约不一致 | Caller and callee disagree on who allocates, frees, pins, or mutates a buffer, how long a pointer remains valid, or whether a length is bytes or elements. | 调用双方对分配、释放、固定、修改、指针有效期或长度单位存在分歧。 | [MEMORY-SAFETY-AND-BINARY.md:52](/Users/daitongmin/.codex/skills/security-audit/MEMORY-SAFETY-AND-BINARY.md:52) |
| Layout, alignment, and enum disagreement | 布局、对齐与枚举解释不一致 | Foreign code receives a struct, bitfield, packed record, callback signature, integer width, enum, or calling convention that differs by architecture or build flag. | 外部代码接收的数据布局、位域、打包、签名、位宽、枚举或调用约定可能随架构和构建选项不同。 | [MEMORY-SAFETY-AND-BINARY.md:55](/Users/daitongmin/.codex/skills/security-audit/MEMORY-SAFETY-AND-BINARY.md:55) |
| Unwind, exception, and thread-affinity violations | 栈展开、异常与线程亲和性违规 | Exceptions or panics cross an ABI that forbids unwinding, callbacks run after teardown, or APIs requiring one runtime thread are invoked elsewhere. | 检查异常越过禁止展开的 ABI、销毁后的回调，以及必须在特定运行时线程执行的操作。 | [MEMORY-SAFETY-AND-BINARY.md:58](/Users/daitongmin/.codex/skills/security-audit/MEMORY-SAFETY-AND-BINARY.md:58) |
| Library, plugin, and executable search-order trust | 库、插件与可执行文件搜索顺序的信任问题 | A privileged process loads a library, plugin, runtime image, or helper from a path writable by a less-trusted principal, or resolves a bare name through an attacker-influenceable working directory or environment. | 特权进程可能从低信任主体可写的位置加载代码，或通过攻击者影响的目录和环境解析文件名。 | [MEMORY-SAFETY-AND-BINARY.md:63](/Users/daitongmin/.codex/skills/security-audit/MEMORY-SAFETY-AND-BINARY.md:63) |
| Missing artifact identity or signature binding | 缺少产物身份或签名绑定 | A loader verifies one file or metadata record but maps a different image because path resolution, file replacement, architecture slices, or embedded resources are not bound to the check. | 验证的文件或元数据与实际映射的镜像可能因路径、替换、架构切片或资源未绑定而不同。 | [MEMORY-SAFETY-AND-BINARY.md:66](/Users/daitongmin/.codex/skills/security-audit/MEMORY-SAFETY-AND-BINARY.md:66) |
| Malformed binary metadata and relocation handling | 畸形二进制元数据与重定位处理缺陷 | Offsets, counts, sections, relocations, symbols, bytecode, or debug metadata are trusted before range, overlap, and representation checks. | 偏移、数量、段、重定位、符号或字节码在范围、重叠和表示检查之前被信任。 | [MEMORY-SAFETY-AND-BINARY.md:69](/Users/daitongmin/.codex/skills/security-audit/MEMORY-SAFETY-AND-BINARY.md:69) |
| JIT and generated-code consistency | JIT 与生成代码一致性缺陷 | Validator, interpreter, optimizer, and generated code disagree about types, bounds, side effects, or lifetime. | 验证器、解释器、优化器和生成代码对类型、边界、副作用或生命周期的解释可能不同。 | [MEMORY-SAFETY-AND-BINARY.md:72](/Users/daitongmin/.codex/skills/security-audit/MEMORY-SAFETY-AND-BINARY.md:72) |
| Unload, reload, and teardown safety | 卸载、重载与销毁安全缺陷 | Live function pointers, callbacks, worker threads, or data views survive module unload or runtime reset. | 模块卸载或运行时重置后，函数指针、回调、线程或数据视图仍存活并可能被使用。 | [MEMORY-SAFETY-AND-BINARY.md:75](/Users/daitongmin/.codex/skills/security-audit/MEMORY-SAFETY-AND-BINARY.md:75) |
| User-copy bounds and repeated reads | 用户内存复制边界与重复读取缺陷 | A syscall, ioctl, driver, or kernel parser derives a trusted fact from user memory then reads the same mutable address again. | 内核接口先从用户内存建立可信判断，之后又读取同一可变地址，可能使用已变化的数据。 | [MEMORY-SAFETY-AND-BINARY.md:80](/Users/daitongmin/.codex/skills/security-audit/MEMORY-SAFETY-AND-BINARY.md:80) |
| Privileged object lifecycle and dispatch consistency | 特权对象生命周期与分派一致性缺陷 | Externally reachable objects have unbalanced retain/release, teardown without observer drain, unchecked selector/table indices, or duplicated compatibility paths that omit a guard. | 外部可达对象可能存在引用失衡、销毁未清理观察者、分派索引未检查或兼容路径漏防护。 | [MEMORY-SAFETY-AND-BINARY.md:83](/Users/daitongmin/.codex/skills/security-audit/MEMORY-SAFETY-AND-BINARY.md:83) |
| Under-authorized powerful interfaces | 授权不足的高权限接口 | A device node, admin socket, helper, or management API validates shape but not the caller's authority over the resource. | 接口只校验输入形状，没有校验调用者对目标资源的权限。 | [MEMORY-SAFETY-AND-BINARY.md:86](/Users/daitongmin/.codex/skills/security-audit/MEMORY-SAFETY-AND-BINARY.md:86) |

### B.3 AI-AND-LLM.md

| 公共提示块 | 原文位置 |
| --- | --- |
| `AI-AND-LLM.md#Core discipline` | [AI-AND-LLM.md:9](/Users/daitongmin/.codex/skills/security-audit/AI-AND-LLM.md:9) |
| `AI-AND-LLM.md#Universal moves` | [AI-AND-LLM.md:70](/Users/daitongmin/.codex/skills/security-audit/AI-AND-LLM.md:70) |
| `AI-AND-LLM.md#Validation rules` | [AI-AND-LLM.md:76](/Users/daitongmin/.codex/skills/security-audit/AI-AND-LLM.md:76) |

| 类别原名 | 类别中文说明 | 原文意图片段 | 意图片段中文说明 | 原文位置 |
| --- | --- | --- | --- | --- |
| Indirect injection through retrieved or ingested content | 检索或摄取内容引发的间接注入 | An attacker can write a RAG document, indexed page, file, email, issue body, tool response, or metadata that enters a different principal's model context. | 攻击者可写的文档、页面、文件、邮件、工单、工具响应或元数据进入另一主体的模型上下文。 | [AI-AND-LLM.md:22](/Users/daitongmin/.codex/skills/security-audit/AI-AND-LLM.md:22) |
| Cross-session or cross-tenant context bleed | 跨会话或跨租户上下文泄漏 | Conversation history, embeddings, retrieval results, or prompt caches are keyed too broadly. | 历史对话、向量、检索结果或提示缓存的键范围过宽，可能混入不同会话或租户的信息。 | [AI-AND-LLM.md:25](/Users/daitongmin/.codex/skills/security-audit/AI-AND-LLM.md:25) |
| Persistent memory poisoning | 持久记忆投毒 | Attacker-controlled content or model summaries are written into memory that later shapes another task, user, or privileged session. | 攻击者内容或模型摘要被写入持久记忆，随后影响其他任务、用户或特权会话。 | [AI-AND-LLM.md:28](/Users/daitongmin/.codex/skills/security-audit/AI-AND-LLM.md:28) |
| Prompt role and provenance confusion | 提示角色与来源混淆 | Prompt assembly lets untrusted text impersonate a system message, prior turn, tool result, policy, or memory record. | 不可信文本在提示组装时能够伪装成系统消息、历史回合、工具结果、策略或记忆记录。 | [AI-AND-LLM.md:31](/Users/daitongmin/.codex/skills/security-audit/AI-AND-LLM.md:31) |
| Tool-argument injection into a downstream sink | 工具参数向下游危险操作点注入 | Model-produced arguments reach SQL, shell, file, URL-fetch, or privileged APIs without handler-side validation. | 模型生成参数未经处理器侧校验，进入 SQL、shell、文件、URL 获取或特权 API。 | [AI-AND-LLM.md:36](/Users/daitongmin/.codex/skills/security-audit/AI-AND-LLM.md:36) |
| Excessive agency and confused-deputy authority | 过度自主能力与混淆代理权限 | The agent uses a service identity or broad credential, while the tool handler does not re-check the requesting principal's permission on the named resource. | Agent 使用服务身份或宽权限凭据，但工具处理器未重新检查请求主体对指定资源的权限。 | [AI-AND-LLM.md:39](/Users/daitongmin/.codex/skills/security-audit/AI-AND-LLM.md:39) |
| Action-confirmation and approval binding | 动作确认与批准绑定缺陷 | A user approves one described action but execution can use changed arguments, a different resource, a different principal, or a later model turn. | 用户批准的动作与真正执行的参数、资源、主体或后续模型回合不一致。 | [AI-AND-LLM.md:42](/Users/daitongmin/.codex/skills/security-audit/AI-AND-LLM.md:42) |
| Tool-schema and dispatcher disagreement | 工具 schema 与分派器解释不一致 | The schema accepts aliases, extra fields, duplicate keys, coercions, nested free-form objects, or out-of-range values that the dispatcher or handler interprets differently. | schema 接受的别名、额外字段、重复键、类型转换、自由对象或越界值被执行端不同解释。 | [AI-AND-LLM.md:45](/Users/daitongmin/.codex/skills/security-audit/AI-AND-LLM.md:45) |
| Unbounded delegated action loops | 无界委派动作循环 | A bounded request can enqueue repeated spend, send, mutation, or external API work without a per-request budget, per-action authorization, cancellation, or idempotency control. | 有限请求可能触发重复支出、发送、修改或 API 工作，却缺少预算、逐动作授权、取消或幂等控制。 | [AI-AND-LLM.md:48](/Users/daitongmin/.codex/skills/security-audit/AI-AND-LLM.md:48) |
| Sub-agent and MCP trust inheritance | 子 Agent 与 MCP 信任继承过度 | A delegated task receives the full session, credentials, memory, or capabilities rather than the least authority required. | 委派任务继承整个会话、凭据、记忆或能力，而不是完成任务所需的最小权限。 | [AI-AND-LLM.md:53](/Users/daitongmin/.codex/skills/security-audit/AI-AND-LLM.md:53) |
| MCP server and tool identity confusion | MCP 服务端与工具身份混淆 | Calls or results are routed by attacker-influenceable server names, tool names, request IDs, resource URIs, or model-selected aliases rather than the authenticated connection and outstanding request. | 调用或结果按攻击者可影响的名称、ID、URI 或别名路由，而非绑定已认证连接与待处理请求。 | [AI-AND-LLM.md:56](/Users/daitongmin/.codex/skills/security-audit/AI-AND-LLM.md:56) |
| MCP metadata and schema as policy | 把 MCP 元数据与 schema 当作策略 | Tool descriptions, resource metadata, prompts, completion hints, or schemas supplied by an MCP peer are trusted as policy or authorization. | 将 MCP 对端提供的描述、元数据、提示或 schema 误当作安全策略或授权依据。 | [AI-AND-LLM.md:59](/Users/daitongmin/.codex/skills/security-audit/AI-AND-LLM.md:59) |
| Insecure output rendering | 不安全的模型输出渲染 | Model output reaches an executing HTML, Markdown, template, URL, or command sink without the sink's required encoding and policy. | 模型输出未经目标操作点要求的编码与策略检查，进入 HTML、Markdown、模板、URL 或命令。 | [AI-AND-LLM.md:64](/Users/daitongmin/.codex/skills/security-audit/AI-AND-LLM.md:64) |
| Sensitive context extraction | 敏感上下文提取 | The assembled context contains credentials, another user's data, private source, or policy values that themselves grant access, and user-influenced output exposes them. | 上下文包含凭据、其他用户数据、私有源码或授予权限的策略值，受用户影响的输出将其暴露。 | [AI-AND-LLM.md:67](/Users/daitongmin/.codex/skills/security-audit/AI-AND-LLM.md:67) |

### B.4 WEB-PROTOCOL-AND-AUTH.md

| 公共提示块 | 原文位置 |
| --- | --- |
| `WEB-PROTOCOL-AND-AUTH.md#Core discipline` | [WEB-PROTOCOL-AND-AUTH.md:9](/Users/daitongmin/.codex/skills/security-audit/WEB-PROTOCOL-AND-AUTH.md:9) |
| `WEB-PROTOCOL-AND-AUTH.md#Universal moves` | [WEB-PROTOCOL-AND-AUTH.md:91](/Users/daitongmin/.codex/skills/security-audit/WEB-PROTOCOL-AND-AUTH.md:91) |
| `WEB-PROTOCOL-AND-AUTH.md#Validation rules` | [WEB-PROTOCOL-AND-AUTH.md:98](/Users/daitongmin/.codex/skills/security-audit/WEB-PROTOCOL-AND-AUTH.md:98) |

| 类别原名 | 类别中文说明 | 原文意图片段 | 意图片段中文说明 | 原文位置 |
| --- | --- | --- | --- | --- |
| Request framing and desynchronization | 请求边界解析与连接不同步 | Front end and back end disagree on request length or header normalization. | 前端和后端对请求长度或请求头规范化的解释不一致。 | [WEB-PROTOCOL-AND-AUTH.md:21](/Users/daitongmin/.codex/skills/security-audit/WEB-PROTOCOL-AND-AUTH.md:21) |
| Web cache poisoning through unkeyed input | 未纳入缓存键的输入导致缓存投毒 | A request value changes cached content or security-relevant headers but is absent from the cache key. | 请求值改变缓存内容或安全相关响应头，却未包含在缓存键中。 | [WEB-PROTOCOL-AND-AUTH.md:24](/Users/daitongmin/.codex/skills/security-audit/WEB-PROTOCOL-AND-AUTH.md:24) |
| Cache deception and private-response caching | 缓存欺骗与私有响应缓存 | Cache routing treats a private dynamic path as a public static asset, or caches a response whose identity and authorization inputs are missing from policy. | 缓存将私有动态路径误当作公共静态资源，或缓存策略漏掉身份和授权输入。 | [WEB-PROTOCOL-AND-AUTH.md:27](/Users/daitongmin/.codex/skills/security-audit/WEB-PROTOCOL-AND-AUTH.md:27) |
| Host and forwarded-header trust | Host 与转发请求头信任缺陷 | Untrusted host/proxy metadata determines absolute URLs, tenant routing, callbacks, reset links, cache keys, or the client address used by authorization. | 不可信主机或代理元数据影响绝对 URL、租户路由、回调、重置链接、缓存键或授权使用的客户端地址。 | [WEB-PROTOCOL-AND-AUTH.md:30](/Users/daitongmin/.codex/skills/security-audit/WEB-PROTOCOL-AND-AUTH.md:30) |
| Response-header injection | 响应头注入 | Untrusted data reaches `Location`, `Set-Cookie`, CSP, or another response header with unsafe control characters or normalization. | 不可信数据通过不安全控制字符或规范化进入 Location、Set-Cookie、CSP 等响应头。 | [WEB-PROTOCOL-AND-AUTH.md:33](/Users/daitongmin/.codex/skills/security-audit/WEB-PROTOCOL-AND-AUTH.md:33) |
| Ordinary CSRF | 常规跨站请求伪造（CSRF） | A browser sends ambient credentials to a state-changing endpoint that accepts a cross-site request without an effective anti-CSRF token, same-site request binding, or strict Origin/Referer validation. | 浏览器自动附带凭据的跨站修改请求被接受，且缺少有效 CSRF 令牌、同站绑定或严格来源检查。 | [WEB-PROTOCOL-AND-AUTH.md:38](/Users/daitongmin/.codex/skills/security-audit/WEB-PROTOCOL-AND-AUTH.md:38) |
| Session fixation and invalidation | 会话固定与失效处理缺陷 | Session identifiers are not rotated on login, account switch, MFA completion, impersonation, or other privilege changes, or remain valid after logout, password change, revocation, and account disable. | 权限变化时不轮换会话标识，或退出、改密、撤销、禁用后会话仍有效。 | [WEB-PROTOCOL-AND-AUTH.md:41](/Users/daitongmin/.codex/skills/security-audit/WEB-PROTOCOL-AND-AUTH.md:41) |
| Cookie scope and transport | Cookie 范围与传输缺陷 | A sensitive cookie has an over-broad `Domain` or `Path`, can cross an insecure transport, or conflicts with a sibling cookie that another component selects differently. | 敏感 Cookie 的 Domain/Path 过宽、跨不安全传输，或与其他组件选择的同类 Cookie 冲突。 | [WEB-PROTOCOL-AND-AUTH.md:44](/Users/daitongmin/.codex/skills/security-audit/WEB-PROTOCOL-AND-AUTH.md:44) |
| JWT verification and claim binding | JWT 验证与声明绑定缺陷 | Check signature verification, server-pinned algorithm and key source, then `exp`, `nbf`, `aud`, and `iss`. | 检查签名、服务端固定算法和密钥来源，以及 exp、nbf、aud、iss 等时间和身份声明。 | [WEB-PROTOCOL-AND-AUTH.md:51](/Users/daitongmin/.codex/skills/security-audit/WEB-PROTOCOL-AND-AUTH.md:51) |
| OAuth/OIDC request and callback binding | OAuth/OIDC 请求与回调绑定缺陷 | Validate exact `redirect_uri` ownership where the target is the authorization server; session-bound `state`; PKCE and authorization-code binding where applicable; ID-token issuer/audience/signature/nonce; and selected-Id… | 按组件角色检查回调地址归属、会话 state、PKCE、授权码，以及 ID token 的签发者、受众、签名和 nonce 绑定。 | [WEB-PROTOCOL-AND-AUTH.md:54](/Users/daitongmin/.codex/skills/security-audit/WEB-PROTOCOL-AND-AUTH.md:54) |
| SAML signed-object and assertion binding | SAML 签名对象与身份断言绑定缺陷 | Ensure the element whose signature is validated is the element used as identity. | 被验证签名的 XML 元素必须就是实际用作身份依据的元素。 | [WEB-PROTOCOL-AND-AUTH.md:57](/Users/daitongmin/.codex/skills/security-audit/WEB-PROTOCOL-AND-AUTH.md:57) |
| MFA enrollment and assurance downgrade | MFA 注册与认证保障等级降级 | Enrollment, replacement, disablement, recovery-code generation, trusted-device creation, and fallback login require the intended prior assurance. | 注册、替换、禁用、生成恢复码、添加可信设备或回退登录必须满足所要求的先前认证强度。 | [WEB-PROTOCOL-AND-AUTH.md:62](/Users/daitongmin/.codex/skills/security-audit/WEB-PROTOCOL-AND-AUTH.md:62) |
| Step-up binding and bypass | 增强认证绑定与绕过 | A successful challenge upgrades the wrong session, account, tenant, action, or API request, or an alternate route omits the assurance check. | 成功挑战可能升级错误的会话、账户、租户、动作或 API 请求，或替代路径遗漏保障等级检查。 | [WEB-PROTOCOL-AND-AUTH.md:65](/Users/daitongmin/.codex/skills/security-audit/WEB-PROTOCOL-AND-AUTH.md:65) |
| WebAuthn and passkey verification | WebAuthn 与通行密钥验证缺陷 | At registration, bind challenge, RP ID, expected origin, credential, user/userHandle, algorithm, and policy-required user verification to the initiating session. | 注册时将挑战、RP ID、预期来源、凭据、用户、算法及所需用户验证绑定到发起会话。 | [WEB-PROTOCOL-AND-AUTH.md:68](/Users/daitongmin/.codex/skills/security-audit/WEB-PROTOCOL-AND-AUTH.md:68) |
| Account linking and identity collision | 账户关联与身份碰撞 | Adding an IdP, passkey, email, phone, device, or external account to an existing account must require a current authenticated session, verified ownership of the new identity, policy-required step-up, and callback state b… | 给已有账户添加外部身份或凭据时，必须验证当前会话、新身份归属、所需增强认证和回调状态绑定。 | [WEB-PROTOCOL-AND-AUTH.md:71](/Users/daitongmin/.codex/skills/security-audit/WEB-PROTOCOL-AND-AUTH.md:71) |
| Password reset and broader recovery | 密码重置与其他账户恢复缺陷 | Recovery tokens, support/admin recovery, backup codes, device migration, and email or phone change often become the weakest authentication path. | 恢复令牌、管理员恢复、备份码、设备迁移或联系方式变更可能成为最弱认证路径。 | [WEB-PROTOCOL-AND-AUTH.md:74](/Users/daitongmin/.codex/skills/security-audit/WEB-PROTOCOL-AND-AUTH.md:74) |
| API-key scope and resource binding | API 密钥范围与资源绑定缺陷 | A key authenticates to broader tenants, resources, actions, or environments than its server-side record grants, or request parameters override those bindings. | 密钥访问范围超过服务端记录授予的租户、资源、动作或环境，或请求参数覆盖这些绑定。 | [WEB-PROTOCOL-AND-AUTH.md:79](/Users/daitongmin/.codex/skills/security-audit/WEB-PROTOCOL-AND-AUTH.md:79) |
| API-key exposure and unsafe transport | API 密钥暴露与不安全传输 | Keys appear in client bundles, URLs, redirects, logs, error paths, build artifacts, or responses accessible to a lower-trust principal. | 密钥出现在低信任主体可见的客户端包、URL、跳转、日志、错误、构建产物或响应中。 | [WEB-PROTOCOL-AND-AUTH.md:82](/Users/daitongmin/.codex/skills/security-audit/WEB-PROTOCOL-AND-AUTH.md:82) |
| mTLS peer and application-identity confusion | mTLS 对端与应用身份混淆 | A process trusts client-certificate identity headers from any network peer, verifies a chain but maps attacker-influenceable subject text to an account incorrectly, or accepts a certificate for the wrong trust domain, ex… | 检查是否信任任意对端的证书身份头、错误映射可控证书主体，或接受不符合目标信任域和用途的证书。 | [WEB-PROTOCOL-AND-AUTH.md:85](/Users/daitongmin/.codex/skills/security-audit/WEB-PROTOCOL-AND-AUTH.md:85) |
| Certificate lifecycle fallback | 证书生命周期中的不安全回退 | Expired, revoked, missing, or renewal-failed certificates cause silent fallback to bearer-only or anonymous operation, or long-lived pooled connections retain authorization after revocation. | 证书过期、撤销、缺失或续期失败导致仅 bearer/匿名回退，或长连接在撤销后仍保留权限。 | [WEB-PROTOCOL-AND-AUTH.md:88](/Users/daitongmin/.codex/skills/security-audit/WEB-PROTOCOL-AND-AUTH.md:88) |

### B.5 CLIENT-SIDE.md

| 公共提示块 | 原文位置 |
| --- | --- |
| `CLIENT-SIDE.md#Core discipline` | [CLIENT-SIDE.md:9](/Users/daitongmin/.codex/skills/security-audit/CLIENT-SIDE.md:9) |
| `CLIENT-SIDE.md#Universal moves` | [CLIENT-SIDE.md:71](/Users/daitongmin/.codex/skills/security-audit/CLIENT-SIDE.md:71) |
| `CLIENT-SIDE.md#Validation rules` | [CLIENT-SIDE.md:77](/Users/daitongmin/.codex/skills/security-audit/CLIENT-SIDE.md:77) |

| 类别原名 | 类别中文说明 | 原文意图片段 | 意图片段中文说明 | 原文位置 |
| --- | --- | --- | --- | --- |
| DOM-based XSS | 基于 DOM 的跨站脚本（XSS） | Trace `location` fields, `document.referrer`, `window.name`, message data, storage, and browser-controlled document state into `innerHTML`, `outerHTML`, `document.write`, string-evaluating APIs, executable URLs, jQuery H… | 追踪 URL、referrer、window.name、消息、存储及文档状态，检查它们是否进入 HTML 写入、字符串执行或可执行 URL 等操作点。 | [CLIENT-SIDE.md:21](/Users/daitongmin/.codex/skills/security-audit/CLIENT-SIDE.md:21) |
| DOM clobbering | DOM 属性覆盖（DOM clobbering） | Attacker-injected `id` or `name` attributes shadow a global, form property, configuration object, or initialization flag later trusted by code. | 攻击者注入的 id/name 遮蔽全局变量、表单属性、配置或初始化标记，随后被代码信任。 | [CLIENT-SIDE.md:24](/Users/daitongmin/.codex/skills/security-audit/CLIENT-SIDE.md:24) |
| Prototype pollution and gadget chain | 原型污染与利用链 | An attacker-controlled key reaches a recursive write such as deep merge or path assignment and modifies prototype state. | 攻击者控制的键进入深度合并或路径赋值等递归写入，改变对象原型状态。 | [CLIENT-SIDE.md:27](/Users/daitongmin/.codex/skills/security-audit/CLIENT-SIDE.md:27) |
| `postMessage` origin and source trust | postMessage 来源与窗口身份信任缺陷 | A handler performs a sensitive action with `event.data` without an exact origin allowlist and, where multiple frames share an origin, the expected `event.source`. | 处理器在缺少精确 origin 白名单及必要 event.source 检查时，用消息数据执行敏感动作。 | [CLIENT-SIDE.md:32](/Users/daitongmin/.codex/skills/security-audit/CLIENT-SIDE.md:32) |
| Cross-site WebSocket request use | 跨站 WebSocket 请求利用 | A WebSocket upgrade accepts ambient cookies from an untrusted origin without an `Origin` check or channel-specific token, allowing the victim's session to read or mutate data. | 来自不可信 origin 的升级请求自动附带 Cookie，被服务端接受后可用受害会话读取或修改数据。 | [CLIENT-SIDE.md:35](/Users/daitongmin/.codex/skills/security-audit/CLIENT-SIDE.md:35) |
| Credentialed CORS trust | 携带凭据的 CORS 信任缺陷 | The server reflects or weakly matches `Origin` while allowing credentials and returns sensitive responses. | 服务端允许凭据、反射或弱匹配 Origin，并向不可信来源返回敏感响应。 | [CLIENT-SIDE.md:38](/Users/daitongmin/.codex/skills/security-audit/CLIENT-SIDE.md:38) |
| Service-worker registration and scope takeover | Service Worker 注册与作用域接管 | Attacker-influenceable content can become the registered worker script, control a path that receives an over-broad `Service-Worker-Allowed` scope, or alter update imports without integrity control. | 可受攻击者影响的内容成为 worker 脚本、获得过宽作用域，或未受完整性约束地改变更新导入。 | [CLIENT-SIDE.md:43](/Users/daitongmin/.codex/skills/security-audit/CLIENT-SIDE.md:43) |
| Service-worker cache and identity confusion | Service Worker 缓存与身份混淆 | The worker caches personalized responses without including account, tenant, authorization state, or request mode in its policy, then serves them after account switch or logout. | 个性化响应缓存未绑定账户、租户、授权状态或请求模式，在切换账户或退出后仍被返回。 | [CLIENT-SIDE.md:46](/Users/daitongmin/.codex/skills/security-audit/CLIENT-SIDE.md:46) |
| Browser-storage disclosure and stale authorization | 浏览器存储泄露与过期授权 | Tokens, private responses, draft data, or authorization decisions remain in `localStorage`, `sessionStorage`, IndexedDB, Cache Storage, extension storage, or client state and become readable by another account or less-tr… | 凭据、私有响应、草稿或授权结果留在浏览器存储中，之后被不同账户或低信任组件读取。 | [CLIENT-SIDE.md:49](/Users/daitongmin/.codex/skills/security-audit/CLIENT-SIDE.md:49) |
| Cross-context storage and broadcast confusion | 跨上下文存储与广播混淆 | `storage` events, `BroadcastChannel`, shared workers, or origin-wide caches carry identity or commands between tabs without binding them to the current session. | 存储事件、广播、共享 worker 或 origin 级缓存未绑定当前会话就在标签页间传递身份和命令。 | [CLIENT-SIDE.md:52](/Users/daitongmin/.codex/skills/security-audit/CLIENT-SIDE.md:52) |
| XS-Leaks and cross-origin state oracles | 跨站信息泄漏（XS-Leaks）与跨源状态探测 | An attacker page can distinguish protected cross-origin state through resource load/error events, frame or window state, redirect behavior, timing, cache state, or response size while the browser attaches victim credenti… | 攻击者页面通过加载事件、窗口状态、跳转、时序、缓存或响应大小区分受保护的跨源状态。 | [CLIENT-SIDE.md:57](/Users/daitongmin/.codex/skills/security-audit/CLIENT-SIDE.md:57) |
| Window and opener state disclosure | 窗口与 opener 状态泄露 | A cross-origin window's permitted metadata or navigation result reveals protected state, or a retained opener/named-window relationship lets an attacker-controlled page influence a privileged navigation. | 跨源窗口元数据或导航结果泄露受保护状态，保留的 opener/命名窗口关系也可能影响特权导航。 | [CLIENT-SIDE.md:60](/Users/daitongmin/.codex/skills/security-audit/CLIENT-SIDE.md:60) |
| Clickjacking | 点击劫持 | A framed, state-changing action lacks effective `frame-ancestors`, `X-Frame-Options`, or equivalent UI isolation. | 可嵌入框架的状态修改操作缺少有效 frame-ancestors、X-Frame-Options 或等效 UI 隔离。 | [CLIENT-SIDE.md:65](/Users/daitongmin/.codex/skills/security-audit/CLIENT-SIDE.md:65) |
| Client-side navigation confusion | 客户端导航混淆 | A client source controls redirect or navigation without scheme and destination policy, including executable `javascript:` or `data:` destinations. | 客户端可控来源在缺少协议和目标策略时决定跳转，包括 javascript:、data: 等可执行目标。 | [CLIENT-SIDE.md:68](/Users/daitongmin/.codex/skills/security-audit/CLIENT-SIDE.md:68) |

### B.6 SUPPLY-CHAIN-AND-RELEASE.md

| 公共提示块 | 原文位置 |
| --- | --- |
| `SUPPLY-CHAIN-AND-RELEASE.md#Core discipline` | [SUPPLY-CHAIN-AND-RELEASE.md:9](/Users/daitongmin/.codex/skills/security-audit/SUPPLY-CHAIN-AND-RELEASE.md:9) |
| `SUPPLY-CHAIN-AND-RELEASE.md#Universal moves` | [SUPPLY-CHAIN-AND-RELEASE.md:61](/Users/daitongmin/.codex/skills/security-audit/SUPPLY-CHAIN-AND-RELEASE.md:61) |
| `SUPPLY-CHAIN-AND-RELEASE.md#Validation rules` | [SUPPLY-CHAIN-AND-RELEASE.md:67](/Users/daitongmin/.codex/skills/security-audit/SUPPLY-CHAIN-AND-RELEASE.md:67) |

| 类别原名 | 类别中文说明 | 原文意图片段 | 意图片段中文说明 | 原文位置 |
| --- | --- | --- | --- | --- |
| Dependency source and namespace confusion | 依赖来源与命名空间混淆 | Resolver configuration can select an unintended public/private namespace, fallback registry, mirror, repository, or source URL. | 解析器配置可能选择非预期的公私命名空间、回退仓库、镜像或源码 URL。 | [SUPPLY-CHAIN-AND-RELEASE.md:21](/Users/daitongmin/.codex/skills/security-audit/SUPPLY-CHAIN-AND-RELEASE.md:21) |
| Mutable and unbound build inputs | 可变且未绑定的构建输入 | Builds consume branches, tags, unverified submodules, downloaded tools, generated assets, remote includes, floating CI actions, or container tags whose content can change without source review. | 构建使用分支、标签、未验证子模块、下载工具、生成资产、远程包含或浮动镜像，其内容可绕过源码审查而变化。 | [SUPPLY-CHAIN-AND-RELEASE.md:24](/Users/daitongmin/.codex/skills/security-audit/SUPPLY-CHAIN-AND-RELEASE.md:24) |
| Generated-source and codegen provenance gaps | 生成源码与代码生成来源缺口 | Schemas, vendored archives, generated clients, localization, documentation examples, or binary blobs produce executable or shipped content without the same review and integrity gate as source. | schema、归档、生成客户端、本地化、示例或二进制输入形成执行/发布内容，却未经过源码同等的审查和完整性门。 | [SUPPLY-CHAIN-AND-RELEASE.md:27](/Users/daitongmin/.codex/skills/security-audit/SUPPLY-CHAIN-AND-RELEASE.md:27) |
| Build-context inclusion | 构建上下文意外包含内容 | Secrets, local configuration, repository metadata, test fixtures, or developer artifacts enter a package or image because the build context and ignore rules exceed intended release inputs. | 构建范围和忽略规则过宽，使秘密、本地配置、仓库元数据、测试或开发文件进入软件包/镜像。 | [SUPPLY-CHAIN-AND-RELEASE.md:30](/Users/daitongmin/.codex/skills/security-audit/SUPPLY-CHAIN-AND-RELEASE.md:30) |
| Untrusted code in a privileged workflow | 特权工作流执行不可信代码 | A pull request, issue comment, fork, dependency update, or external event runs contributor-controlled code with protected secrets, write tokens, deployment authority, or a trusted runner. | 外部贡献或事件让可控代码获得受保护秘密、写令牌、部署权限或可信 runner。 | [SUPPLY-CHAIN-AND-RELEASE.md:35](/Users/daitongmin/.codex/skills/security-audit/SUPPLY-CHAIN-AND-RELEASE.md:35) |
| Workflow command and expression confusion | 工作流命令与表达式混淆 | Attacker-controlled branch names, commit messages, issue fields, artifact names, matrix values, or generated output enter shell commands, template expressions, paths, or privileged workflow inputs without canonical valid… | 攻击者控制的分支、提交、工单、产物名、矩阵值或生成输出未经规范校验就进入命令、表达式、路径或特权输入。 | [SUPPLY-CHAIN-AND-RELEASE.md:38](/Users/daitongmin/.codex/skills/security-audit/SUPPLY-CHAIN-AND-RELEASE.md:38) |
| Cache, artifact, and workspace trust mixing | 缓存、产物与工作区信任混用 | A lower-trust job can populate a cache, artifact, shared workspace, or output that a higher-trust job later restores and executes or releases. | 低信任任务写入的缓存、产物或共享输出被高信任任务恢复并执行或发布。 | [SUPPLY-CHAIN-AND-RELEASE.md:41](/Users/daitongmin/.codex/skills/security-audit/SUPPLY-CHAIN-AND-RELEASE.md:41) |
| Automation identity overreach | 自动化身份权限越界 | CI jobs receive permissions beyond the operation, repository, environment, or duration needed, and untrusted job inputs can select the affected resource. | CI 获得超过操作所需范围/时长的权限，不可信输入还能选择被操作资源。 | [SUPPLY-CHAIN-AND-RELEASE.md:44](/Users/daitongmin/.codex/skills/security-audit/SUPPLY-CHAIN-AND-RELEASE.md:44) |
| Build-to-promotion substitution | 构建到晋升的产物替换 | Tests, review, signature, and publication refer to mutable tags, filenames, channels, or artifact IDs rather than the same immutable digest. | 测试、审查、签名和发布绑定可变名称，而未绑定同一个不可变产物摘要。 | [SUPPLY-CHAIN-AND-RELEASE.md:49](/Users/daitongmin/.codex/skills/security-audit/SUPPLY-CHAIN-AND-RELEASE.md:49) |
| Release authorization and signing-policy gaps | 发布授权与签名策略缺口 | A release or signature is accepted from the wrong workflow, repository, branch, environment, key role, or threshold. | 来自错误工作流、仓库、分支、环境、密钥角色或签名门槛的发布/签名被接受。 | [SUPPLY-CHAIN-AND-RELEASE.md:52](/Users/daitongmin/.codex/skills/security-audit/SUPPLY-CHAIN-AND-RELEASE.md:52) |
| Update metadata and rollback confusion | 更新元数据与回滚混淆 | An updater authenticates payload bytes but not version, product, platform, channel, target path, expiry, or rollback state, or it accepts metadata and payload from different authorized transactions. | 更新器只认证内容字节，未绑定版本、产品、平台、渠道、路径、有效期、回滚状态或同一授权事务。 | [SUPPLY-CHAIN-AND-RELEASE.md:55](/Users/daitongmin/.codex/skills/security-audit/SUPPLY-CHAIN-AND-RELEASE.md:55) |
| Plugin and extension trust expansion | 插件与扩展信任扩大 | An extension package gains host authority beyond its declared scope, a lower-trust publisher can replace another publisher's identity, or install/update hooks run before authenticity and capability checks. | 扩展超出声明范围获得宿主权限、低信任发布者替换他人身份，或在认证/能力检查前执行安装更新钩子。 | [SUPPLY-CHAIN-AND-RELEASE.md:58](/Users/daitongmin/.codex/skills/security-audit/SUPPLY-CHAIN-AND-RELEASE.md:58) |

### B.7 CLOUD-AND-DEPLOYMENT.md

| 公共提示块 | 原文位置 |
| --- | --- |
| `CLOUD-AND-DEPLOYMENT.md#Core discipline` | [CLOUD-AND-DEPLOYMENT.md:9](/Users/daitongmin/.codex/skills/security-audit/CLOUD-AND-DEPLOYMENT.md:9) |
| `CLOUD-AND-DEPLOYMENT.md#Universal moves` | [CLOUD-AND-DEPLOYMENT.md:74](/Users/daitongmin/.codex/skills/security-audit/CLOUD-AND-DEPLOYMENT.md:74) |
| `CLOUD-AND-DEPLOYMENT.md#Validation rules` | [CLOUD-AND-DEPLOYMENT.md:80](/Users/daitongmin/.codex/skills/security-audit/CLOUD-AND-DEPLOYMENT.md:80) |

| 类别原名 | 类别中文说明 | 原文意图片段 | 意图片段中文说明 | 原文位置 |
| --- | --- | --- | --- | --- |
| Workload identity overreach | 工作负载身份权限越界 | A workload, pod, function, edge worker, or node identity can act on tenants, accounts, resources, or APIs beyond its role, and untrusted request or job input selects that target. | 不可信请求或任务输入选择目标，使工作负载身份执行超出其角色的租户、账户、资源或 API 操作。 | [CLOUD-AND-DEPLOYMENT.md:21](/Users/daitongmin/.codex/skills/security-audit/CLOUD-AND-DEPLOYMENT.md:21) |
| Cross-account or cross-tenant role confusion | 跨账户或跨租户角色混淆 | Role assumption, external IDs, token exchange, workload federation, or resource policies accept identity claims not bound to the intended source account, audience, repository, namespace, or workload. | 角色承担、令牌交换或联合身份接受的声明未绑定预期来源账户、受众、仓库、命名空间或工作负载。 | [CLOUD-AND-DEPLOYMENT.md:24](/Users/daitongmin/.codex/skills/security-audit/CLOUD-AND-DEPLOYMENT.md:24) |
| Application authorization delegated to cloud metadata | 把应用授权委托给云元数据 | An app trusts caller-supplied identity headers, tags, labels, account IDs, or resource metadata without verifying they came from the cloud control plane or a trusted proxy. | 应用信任调用者提供的身份头、标签、账户 ID 或资源元数据，却未验证它来自可信控制面/代理。 | [CLOUD-AND-DEPLOYMENT.md:27](/Users/daitongmin/.codex/skills/security-audit/CLOUD-AND-DEPLOYMENT.md:27) |
| Unexpected service or management-plane reachability | 非预期服务或管理面可达 | An ingress, service, listener, security group, load-balancer annotation, port mapping, or server bind exposes an admin, debug, metrics, node, control-plane, or internal API to a lower-trust network. | ingress、监听、网络规则、负载均衡注解、端口映射等将管理/调试/内部接口暴露给低信任网络。 | [CLOUD-AND-DEPLOYMENT.md:32](/Users/daitongmin/.codex/skills/security-audit/CLOUD-AND-DEPLOYMENT.md:32) |
| Trusted-proxy and mesh identity bypass | 可信代理与服务网格身份绕过 | A backend accepts forwarded identity, mTLS subject, or authorization metadata from peers outside the intended ingress/sidecar, or an alternate port and health/legacy path bypasses the mesh. | 后端接受非预期代理/sidecar 对端的身份元数据，或替代端口和健康/旧路径绕过网格。 | [CLOUD-AND-DEPLOYMENT.md:35](/Users/daitongmin/.codex/skills/security-audit/CLOUD-AND-DEPLOYMENT.md:35) |
| Metadata and internal-service reachability | 云元数据与内部服务可达 | An untrusted URL, destination, or protocol selection reaches instance/container metadata, control-plane sockets, or internal APIs with workload credentials. | 不可信 URL、目的地址或协议选择使带工作负载凭据的操作访问元数据、控制面 socket 或内部 API。 | [CLOUD-AND-DEPLOYMENT.md:38](/Users/daitongmin/.codex/skills/security-audit/CLOUD-AND-DEPLOYMENT.md:38) |
| Host or control-plane capability exposure | 宿主或控制面能力暴露 | A lower-trust workload can select privileged mode, capabilities, host namespaces, host paths, device mounts, container runtime sockets, or service-account tokens that cross into node/control-plane authority. | 低信任工作负载通过特权模式、capabilities、host namespace/path、设备或运行时 socket 跨入宿主/控制面权限。 | [CLOUD-AND-DEPLOYMENT.md:43](/Users/daitongmin/.codex/skills/security-audit/CLOUD-AND-DEPLOYMENT.md:43) |
| Admission and policy path inconsistency | 准入与策略路径不一致 | One deployment route enforces image identity, namespace, resource, secret, or privilege policy while another controller, job, upgrade, restore, or compatibility path does not. | 某部署路径执行镜像、命名空间、资源或权限策略，其他控制器、升级、恢复或兼容路径却遗漏。 | [CLOUD-AND-DEPLOYMENT.md:46](/Users/daitongmin/.codex/skills/security-audit/CLOUD-AND-DEPLOYMENT.md:46) |
| Namespace and label trust confusion | 命名空间与标签信任混淆 | Network, admission, secret, or workload-identity policy relies on labels, annotations, names, or namespaces that a less-trusted principal can set. | 网络、准入、秘密或身份策略依赖低信任主体可修改的标签、注解、名称或命名空间。 | [CLOUD-AND-DEPLOYMENT.md:49](/Users/daitongmin/.codex/skills/security-audit/CLOUD-AND-DEPLOYMENT.md:49) |
| Security-control precedence drift | 安全控制配置优先级漂移 | Development values, chart defaults, environment variables, command-line flags, feature gates, sidecar injection, or per-region overlays disable authentication, transport security, tenant scoping, or audit policy in a dep… | 开发配置、默认值、环境变量、命令行、特性开关、sidecar 或地区 overlay 在部署中关闭安全控制。 | [CLOUD-AND-DEPLOYMENT.md:54](/Users/daitongmin/.codex/skills/security-audit/CLOUD-AND-DEPLOYMENT.md:54) |
| Secret exposure across workload boundaries | 跨工作负载边界的秘密暴露 | Secrets enter logs, crash reports, process arguments, shared environment, broad volumes, build outputs, service discovery, or read APIs accessible to another workload or tenant. | 秘密进入其他工作负载或租户可访问的日志、崩溃信息、参数、共享环境、挂载、产物或 API。 | [CLOUD-AND-DEPLOYMENT.md:57](/Users/daitongmin/.codex/skills/security-audit/CLOUD-AND-DEPLOYMENT.md:57) |
| Credential renewal and outage fallback | 凭据续期与故障回退缺陷 | Failure to mount, refresh, rotate, or revoke a workload credential causes stale credentials to remain active or an app to accept a less trusted identity mode. | 挂载、刷新、轮换或撤销失败导致旧凭据持续有效，或应用回退到低信任身份模式。 | [CLOUD-AND-DEPLOYMENT.md:60](/Users/daitongmin/.codex/skills/security-audit/CLOUD-AND-DEPLOYMENT.md:60) |
| Object and signed-URL policy confusion | 对象与签名 URL 策略混淆 | Bucket/container policy, object keys, CDN origins, or signed URLs fail to bind principal, operation, object namespace, audience, or expiry. | 存储策略、对象键、CDN 来源或签名 URL 未绑定主体、操作、对象范围、受众或有效期。 | [CLOUD-AND-DEPLOYMENT.md:65](/Users/daitongmin/.codex/skills/security-audit/CLOUD-AND-DEPLOYMENT.md:65) |
| Event-source identity confusion | 事件源身份混淆 | A function or worker trusts event body fields as source identity without validating provider-signed envelope, subscription/topic, account, region, and replay state. | 函数信任事件正文自报身份，却未验证提供方签名信封、订阅、账户、地区和重放状态。 | [CLOUD-AND-DEPLOYMENT.md:68](/Users/daitongmin/.codex/skills/security-audit/CLOUD-AND-DEPLOYMENT.md:68) |
| Edge/runtime boundary mismatch | 边缘运行时边界不一致 | An edge or serverless runtime assumes a secret, API, filesystem, isolation, or tenant policy that differs from the origin runtime, and fallback to origin changes authority or cache behavior. | 边缘/无服务器环境与源站的秘密、API、文件系统、隔离或租户策略不同，回退改变权限或缓存行为。 | [CLOUD-AND-DEPLOYMENT.md:71](/Users/daitongmin/.codex/skills/security-audit/CLOUD-AND-DEPLOYMENT.md:71) |

### B.8 PROTOCOLS-RPC-AND-MESSAGING.md

| 公共提示块 | 原文位置 |
| --- | --- |
| `PROTOCOLS-RPC-AND-MESSAGING.md#Core discipline` | [PROTOCOLS-RPC-AND-MESSAGING.md:9](/Users/daitongmin/.codex/skills/security-audit/PROTOCOLS-RPC-AND-MESSAGING.md:9) |
| `PROTOCOLS-RPC-AND-MESSAGING.md#Universal moves` | [PROTOCOLS-RPC-AND-MESSAGING.md:69](/Users/daitongmin/.codex/skills/security-audit/PROTOCOLS-RPC-AND-MESSAGING.md:69) |
| `PROTOCOLS-RPC-AND-MESSAGING.md#Validation rules` | [PROTOCOLS-RPC-AND-MESSAGING.md:75](/Users/daitongmin/.codex/skills/security-audit/PROTOCOLS-RPC-AND-MESSAGING.md:75) |

| 类别原名 | 类别中文说明 | 原文意图片段 | 意图片段中文说明 | 原文位置 |
| --- | --- | --- | --- | --- |
| Message boundary and canonicalization disagreement | 消息边界与规范化解释不一致 | Components disagree on length, compression, duplicate fields, unknown fields, encoding, numeric width, normalization, or envelope/body precedence. | 组件对长度、压缩、重复/未知字段、编码、位宽、规范化或信封正文优先级有不同解释。 | [PROTOCOLS-RPC-AND-MESSAGING.md:21](/Users/daitongmin/.codex/skills/security-audit/PROTOCOLS-RPC-AND-MESSAGING.md:21) |
| Union, enum, and default confusion | 联合体、枚举与默认值混淆 | Unknown variants, missing discriminators, zero values, default privileges, or compatibility mappings reach code that assumes a validated case. | 未知变体、缺少判别值、零值、默认权限或兼容映射进入假定输入已验证的代码。 | [PROTOCOLS-RPC-AND-MESSAGING.md:24](/Users/daitongmin/.codex/skills/security-audit/PROTOCOLS-RPC-AND-MESSAGING.md:24) |
| Envelope and payload identity mismatch | 信封与消息体身份不一致 | Authorization uses trusted-looking routing or envelope metadata while the handler acts on a conflicting tenant, account, subject, object, or sender in the body. | 授权依据路由/信封元数据，但处理器按消息体中冲突的租户、账户、对象或发送者执行。 | [PROTOCOLS-RPC-AND-MESSAGING.md:27](/Users/daitongmin/.codex/skills/security-audit/PROTOCOLS-RPC-AND-MESSAGING.md:27) |
| Interceptor and method-path inconsistency | 拦截器与方法路径不一致 | An authn/authz interceptor applies to unary methods but not streams, reflection, health, gateway-transcoded paths, compatibility services, or individual stream messages. | 身份/权限拦截器覆盖一元方法，却遗漏流、反射、健康接口、网关转换、兼容路径或单条消息。 | [PROTOCOLS-RPC-AND-MESSAGING.md:32](/Users/daitongmin/.codex/skills/security-audit/PROTOCOLS-RPC-AND-MESSAGING.md:32) |
| Peer identity to application-principal confusion | 对端身份与应用主体混淆 | mTLS, workload identity, bearer metadata, forwarded identity, or broker credentials authenticate a channel, but a caller-controlled field selects the user or tenant. | 通道经 mTLS、workload 或 bearer 认证，但调用者可通过字段选择另一个用户/租户。 | [PROTOCOLS-RPC-AND-MESSAGING.md:35](/Users/daitongmin/.codex/skills/security-audit/PROTOCOLS-RPC-AND-MESSAGING.md:35) |
| Per-item and streaming authorization gaps | 逐项与流式授权缺口 | A stream, subscription, batch, or bulk message is authorized once, then later items name different resources or continue after role, membership, or token revocation. | 流、订阅或批量请求只授权一次，后续项目切换资源，或在身份权限撤销后继续执行。 | [PROTOCOLS-RPC-AND-MESSAGING.md:38](/Users/daitongmin/.codex/skills/security-audit/PROTOCOLS-RPC-AND-MESSAGING.md:38) |
| Callback and reply-correlation confusion | 回调与响应关联混淆 | Predictable, reused, or cross-tenant correlation IDs let a response, webhook, cancellation, or acknowledgment satisfy another caller's pending operation. | 可预测、复用或跨租户的关联 ID 让一方响应、取消或确认满足另一方的待处理操作。 | [PROTOCOLS-RPC-AND-MESSAGING.md:41](/Users/daitongmin/.codex/skills/security-audit/PROTOCOLS-RPC-AND-MESSAGING.md:41) |
| Topic, routing-key, and subscription scope gaps | 主题、路由键与订阅范围缺口 | A publisher or subscriber can select another tenant's topic, wildcard, consumer group, partition, reply queue, or dead-letter route. | 发布者或订阅者可选择其他租户主题、通配范围、消费组、分区、回复队列或死信路由。 | [PROTOCOLS-RPC-AND-MESSAGING.md:46](/Users/daitongmin/.codex/skills/security-audit/PROTOCOLS-RPC-AND-MESSAGING.md:46) |
| Dead-letter, retry, and diagnostic disclosure | 死信、重试与诊断信息泄露 | Messages routed to dead-letter queues, error topics, tracing, or operator views contain secrets or cross-tenant payloads accessible to a lower-trust consumer. | 失败消息进入低信任消费者可访问的死信队列、错误主题、追踪或运营视图，暴露秘密或跨租户内容。 | [PROTOCOLS-RPC-AND-MESSAGING.md:49](/Users/daitongmin/.codex/skills/security-audit/PROTOCOLS-RPC-AND-MESSAGING.md:49) |
| Untrusted producer treated as control plane | 将不可信生产者当作控制面 | A message body can declare itself an admin event, provider callback, replication record, or migration instruction without an independently authenticated producer and event type. | 未独立验证生产者和事件类型，就接受正文自称管理事件、提供方回调、复制记录或迁移指令。 | [PROTOCOLS-RPC-AND-MESSAGING.md:52](/Users/daitongmin/.codex/skills/security-audit/PROTOCOLS-RPC-AND-MESSAGING.md:52) |
| Duplicate delivery and idempotency gaps | 重复投递与幂等控制缺口 | Retries or redelivery repeat a side effect because deduplication is absent, occurs after mutation, or uses a key that collides across tenants or operations. | 重试/重投导致重复副作用，因为去重缺失、晚于修改，或去重键跨租户/操作碰撞。 | [PROTOCOLS-RPC-AND-MESSAGING.md:57](/Users/daitongmin/.codex/skills/security-audit/PROTOCOLS-RPC-AND-MESSAGING.md:57) |
| Out-of-order and stale message acceptance | 乱序与过期消息接受 | Older state, revoked membership, canceled work, or pre-step-up authorization arrives after newer state and overwrites it. | 旧状态、被撤销权限、已取消工作或旧授权迟到并覆盖新的状态。 | [PROTOCOLS-RPC-AND-MESSAGING.md:60](/Users/daitongmin/.codex/skills/security-audit/PROTOCOLS-RPC-AND-MESSAGING.md:60) |
| Acknowledgment/commit ordering defects | 确认与提交顺序缺陷 | Acknowledgment occurs before durable commit and loses security-relevant work, or commit happens before an unreliable acknowledgment and duplicates a mutation. | 提前确认丢失尚未持久化的工作，或先提交后确认失败导致修改重复。 | [PROTOCOLS-RPC-AND-MESSAGING.md:63](/Users/daitongmin/.codex/skills/security-audit/PROTOCOLS-RPC-AND-MESSAGING.md:63) |
| Partial multi-consumer transitions | 多消费者部分状态转换 | Several consumers jointly implement one authorization or business transition, but retries and partial failure leave only a subset committed. | 多个消费者共同完成一项安全/业务转换，重试与部分失败使只有部分状态提交。 | [PROTOCOLS-RPC-AND-MESSAGING.md:66](/Users/daitongmin/.codex/skills/security-audit/PROTOCOLS-RPC-AND-MESSAGING.md:66) |

### B.9 RESOURCE-EXHAUSTION-AND-AVAILABILITY.md

| 公共提示块 | 原文位置 |
| --- | --- |
| `RESOURCE-EXHAUSTION-AND-AVAILABILITY.md#Core discipline` | [RESOURCE-EXHAUSTION-AND-AVAILABILITY.md:9](/Users/daitongmin/.codex/skills/security-audit/RESOURCE-EXHAUSTION-AND-AVAILABILITY.md:9) |
| `RESOURCE-EXHAUSTION-AND-AVAILABILITY.md#Universal moves` | [RESOURCE-EXHAUSTION-AND-AVAILABILITY.md:66](/Users/daitongmin/.codex/skills/security-audit/RESOURCE-EXHAUSTION-AND-AVAILABILITY.md:66) |
| `RESOURCE-EXHAUSTION-AND-AVAILABILITY.md#Validation rules` | [RESOURCE-EXHAUSTION-AND-AVAILABILITY.md:72](/Users/daitongmin/.codex/skills/security-audit/RESOURCE-EXHAUSTION-AND-AVAILABILITY.md:72) |

| 类别原名 | 类别中文说明 | 原文意图片段 | 意图片段中文说明 | 原文位置 |
| --- | --- | --- | --- | --- |
| Superlinear parsing, matching, or evaluation | 超线性解析、匹配或求值 | Small accepted input drives catastrophic regex backtracking, nested parsing, recursive validation, symbolic evaluation, graph traversal, template expansion, or adversarial sort/hash behavior. | 小规模有效输入引发正则回溯、嵌套解析、递归验证、求值、图遍历、模板展开或排序/哈希的过量计算。 | [RESOURCE-EXHAUSTION-AND-AVAILABILITY.md:21](/Users/daitongmin/.codex/skills/security-audit/RESOURCE-EXHAUSTION-AND-AVAILABILITY.md:21) |
| Decompression and representation amplification | 解压与表示放大 | Compressed, sparse, nested, aliased, or encoded input expands far beyond the checked transfer or file size. | 压缩、稀疏、嵌套、别名或编码输入展开后远大于已检查的传输/文件大小。 | [RESOURCE-EXHAUSTION-AND-AVAILABILITY.md:24](/Users/daitongmin/.codex/skills/security-audit/RESOURCE-EXHAUSTION-AND-AVAILABILITY.md:24) |
| Database and downstream query amplification | 数据库与下游查询放大 | A small request creates broad scans, pathological joins, fan-out, unbounded sort/aggregation, or many downstream calls because query depth, filter cardinality, pagination, or expansion fields are not bounded. | 查询深度、数量、分页或展开未受限，使小请求触发全局扫描、复杂连接、扇出、聚合或大量下游调用。 | [RESOURCE-EXHAUSTION-AND-AVAILABILITY.md:27](/Users/daitongmin/.codex/skills/security-audit/RESOURCE-EXHAUSTION-AND-AVAILABILITY.md:27) |
| Unbounded buffering and cardinality | 无界缓冲与集合规模 | Bodies, out-of-order streams, uploads, sessions, unique cache keys, metrics labels, log fields, subscriptions, or pending jobs accumulate without per-item and aggregate limits. | 消息体、乱序流、上传、会话、缓存键、标签、订阅或任务在缺少单项和总量限制时持续累积。 | [RESOURCE-EXHAUSTION-AND-AVAILABILITY.md:32](/Users/daitongmin/.codex/skills/security-audit/RESOURCE-EXHAUSTION-AND-AVAILABILITY.md:32) |
| File descriptor, handle, and temporary-resource leaks | 文件描述符、句柄与临时资源泄漏 | Malformed or canceled work misses cleanup and retains sockets, files, database cursors, timers, subprocesses, temporary files, or object references. | 畸形或取消的工作遗漏清理，保留连接、文件、游标、定时器、进程、临时文件或对象引用。 | [RESOURCE-EXHAUSTION-AND-AVAILABILITY.md:35](/Users/daitongmin/.codex/skills/security-audit/RESOURCE-EXHAUSTION-AND-AVAILABILITY.md:35) |
| Detached work after cancellation | 取消后仍运行的脱离工作 | Client timeout, disconnect, canceled job, or failed authorization returns control but leaves database, model, network, or worker work running. | 超时、断连、取消或授权失败已返回，但数据库、模型、网络或 worker 工作继续运行。 | [RESOURCE-EXHAUSTION-AND-AVAILABILITY.md:38](/Users/daitongmin/.codex/skills/security-audit/RESOURCE-EXHAUSTION-AND-AVAILABILITY.md:38) |
| Pre-authentication work imbalance | 认证前的计算负担失衡 | Expensive parsing, key lookup, cryptography, decompression, or external requests happen before authentication and the earliest size/rate gate. | 在认证和最早大小/速率限制前进行昂贵解析、密钥查询、密码学、解压或外部请求。 | [RESOURCE-EXHAUSTION-AND-AVAILABILITY.md:43](/Users/daitongmin/.codex/skills/security-audit/RESOURCE-EXHAUSTION-AND-AVAILABILITY.md:43) |
| Quota-accounting scope and reset gaps | 配额核算范围与重置缺口 | Accounting uses attacker-influenceable IP, route, tenant, key prefix, task ID, or other dimension, allowing one principal's work to escape its intended budget or consume another principal's allocation. | 计费维度受攻击者影响，让工作逃避自身预算或消耗其他主体的配额。 | [RESOURCE-EXHAUSTION-AND-AVAILABILITY.md:46](/Users/daitongmin/.codex/skills/security-audit/RESOURCE-EXHAUSTION-AND-AVAILABILITY.md:46) |
| Worker, pool, and priority starvation | worker、资源池与优先级饥饿 | Low-priority or attacker-controlled jobs hold shared locks, workers, database pools, event-loop turns, or scheduler priority needed by unrelated users. | 低优先级或可控任务持续占据共享锁、worker、数据库池、事件循环或调度资源，阻碍其他用户。 | [RESOURCE-EXHAUSTION-AND-AVAILABILITY.md:49](/Users/daitongmin/.codex/skills/security-audit/RESOURCE-EXHAUSTION-AND-AVAILABILITY.md:49) |
| Reachable fatal error or deadlock | 可达的致命错误或死锁 | An untrusted input reaches `panic`, abort, fatal assertion, unhandled exception, process exit, lock cycle, or infinite loop in a shared process. | 不可信输入进入共享进程的 panic、abort、致命断言、未处理异常、退出、锁环或无限循环。 | [RESOURCE-EXHAUSTION-AND-AVAILABILITY.md:54](/Users/daitongmin/.codex/skills/security-audit/RESOURCE-EXHAUSTION-AND-AVAILABILITY.md:54) |
| Retry storm and fail-open amplification | 重试风暴与故障放行导致的放大 | Timeouts, dependency errors, partially processed messages, or health-check failures trigger synchronized or unbounded retries without jitter, ceilings, circuit breaking, or deduplication. | 超时或依赖错误引发同步或无界重试，缺少随机延迟、上限、熔断或去重。 | [RESOURCE-EXHAUSTION-AND-AVAILABILITY.md:57](/Users/daitongmin/.codex/skills/security-audit/RESOURCE-EXHAUSTION-AND-AVAILABILITY.md:57) |
| Poison-record and head-of-line blocking | 毒化记录与队头阻塞 | One malformed record or message repeatedly fails at the front of a shared queue, partition, startup scan, migration, or recovery loop. | 一条畸形记录反复在共享队列、分区、启动扫描、迁移或恢复流程前端失败，阻碍后续工作。 | [RESOURCE-EXHAUSTION-AND-AVAILABILITY.md:60](/Users/daitongmin/.codex/skills/security-audit/RESOURCE-EXHAUSTION-AND-AVAILABILITY.md:60) |
| Unsafe recovery and capacity rollback | 不安全恢复与容量约束回退 | A restart, restore, fallback, or cleanup path rebuilds unbounded state, ignores current quotas, or restores the input that immediately repeats failure. | 重启、恢复、回退或清理重新建立无界状态、忽略现有配额，或恢复立即再次触发故障的输入。 | [RESOURCE-EXHAUSTION-AND-AVAILABILITY.md:63](/Users/daitongmin/.codex/skills/security-audit/RESOURCE-EXHAUSTION-AND-AVAILABILITY.md:63) |

### B.10 DATA-ISOLATION-AND-LIFECYCLE.md

| 公共提示块 | 原文位置 |
| --- | --- |
| `DATA-ISOLATION-AND-LIFECYCLE.md#Core discipline` | [DATA-ISOLATION-AND-LIFECYCLE.md:9](/Users/daitongmin/.codex/skills/security-audit/DATA-ISOLATION-AND-LIFECYCLE.md:9) |
| `DATA-ISOLATION-AND-LIFECYCLE.md#Universal moves` | [DATA-ISOLATION-AND-LIFECYCLE.md:72](/Users/daitongmin/.codex/skills/security-audit/DATA-ISOLATION-AND-LIFECYCLE.md:72) |
| `DATA-ISOLATION-AND-LIFECYCLE.md#Validation rules` | [DATA-ISOLATION-AND-LIFECYCLE.md:78](/Users/daitongmin/.codex/skills/security-audit/DATA-ISOLATION-AND-LIFECYCLE.md:78) |

| 类别原名 | 类别中文说明 | 原文意图片段 | 意图片段中文说明 | 原文位置 |
| --- | --- | --- | --- | --- |
| Missing tenant or owner enforcement | 缺少租户或所有者约束 | A read, update, delete, list, count, or bulk query identifies an object without binding it to the authenticated tenant/owner, or trusts body fields to supply that identity. | 查询通过对象 ID 操作记录，却未绑定认证租户/所有者，或信任正文自报身份。 | [DATA-ISOLATION-AND-LIFECYCLE.md:21](/Users/daitongmin/.codex/skills/security-audit/DATA-ISOLATION-AND-LIFECYCLE.md:21) |
| Composite-key and namespace collision | 复合键与命名空间碰撞 | Cache keys, object paths, database uniqueness, search document IDs, temporary files, or deduplication keys omit tenant or environment. | 缓存键、对象路径、唯一约束、索引 ID、临时文件或去重键漏掉租户/环境维度。 | [DATA-ISOLATION-AND-LIFECYCLE.md:24](/Users/daitongmin/.codex/skills/security-audit/DATA-ISOLATION-AND-LIFECYCLE.md:24) |
| Policy and query disagreement | 策略与查询不一致 | Row-level policy, ORM default scopes, authorization filters, and raw/bypass clients apply different predicates. | 行级策略、ORM 默认范围、授权过滤器与原始/绕过客户端使用不同条件。 | [DATA-ISOLATION-AND-LIFECYCLE.md:27](/Users/daitongmin/.codex/skills/security-audit/DATA-ISOLATION-AND-LIFECYCLE.md:27) |
| Blob and signed-reference overreach | 对象数据与签名引用权限越界 | Object keys, attachment IDs, version IDs, shared links, or signed URLs permit operations or namespaces beyond the issuing principal's access, or remain valid after the underlying ACL changes. | 对象键、附件/版本 ID、共享链接或签名 URL 超出签发主体权限，或底层 ACL 改变后仍有效。 | [DATA-ISOLATION-AND-LIFECYCLE.md:30](/Users/daitongmin/.codex/skills/security-audit/DATA-ISOLATION-AND-LIFECYCLE.md:30) |
| Search, cache, and index ACL drift | 搜索、缓存与索引 ACL 漂移 | A primary record's ACL or lifecycle changes without invalidating a searchable, cached, embedded, thumbnail, RSS, preview, or index copy. | 主记录的 ACL/生命周期改变后，没有使搜索、缓存、向量、缩略图、预览或索引副本同步失效。 | [DATA-ISOLATION-AND-LIFECYCLE.md:35](/Users/daitongmin/.codex/skills/security-audit/DATA-ISOLATION-AND-LIFECYCLE.md:35) |
| Analytics, logs, traces, and diagnostics as alternate readers | 分析、日志、追踪与诊断成为替代读取通道 | Private content or credentials are emitted into systems with broader access, longer retention, or tenant mixing. | 私有内容或凭据进入权限更宽、保留更久或混合租户的数据系统。 | [DATA-ISOLATION-AND-LIFECYCLE.md:38](/Users/daitongmin/.codex/skills/security-audit/DATA-ISOLATION-AND-LIFECYCLE.md:38) |
| Enumeration and aggregate oracles | 枚举与聚合结果探测 | Counts, filters, ordering, errors, unique constraints, timings, notification behavior, or existence checks disclose protected object or account state. | 计数、筛选、排序、错误、唯一约束、时序、通知或存在检查暴露受保护对象/账户状态。 | [DATA-ISOLATION-AND-LIFECYCLE.md:41](/Users/daitongmin/.codex/skills/security-audit/DATA-ISOLATION-AND-LIFECYCLE.md:41) |
| Export and backup scope expansion | 导出与备份范围扩大 | An export, snapshot, portability package, report, or backup includes other tenants, inaccessible object fields, soft-deleted data, secret values, or history above the requester's access. | 导出、快照、报告或备份包含请求者无权访问的租户、字段、已删除数据、秘密或历史。 | [DATA-ISOLATION-AND-LIFECYCLE.md:46](/Users/daitongmin/.codex/skills/security-audit/DATA-ISOLATION-AND-LIFECYCLE.md:46) |
| Import and restore authority expansion | 导入与恢复权限扩大 | Restore/import bypasses owner, schema, ACL, uniqueness, or validation rules, overwrites existing resources, or recreates records in a tenant the requester cannot write. | 导入/恢复绕过 owner、schema、ACL、唯一性或校验，覆盖资源或在无写权限租户创建数据。 | [DATA-ISOLATION-AND-LIFECYCLE.md:49](/Users/daitongmin/.codex/skills/security-audit/DATA-ISOLATION-AND-LIFECYCLE.md:49) |
| Migration default and ownership confusion | 迁移默认值与所有权混淆 | Old records lack tenant/ACL/lifecycle fields, incompatible IDs collide, or partial rollout makes new and old readers apply different defaults. | 旧记录缺少租户/ACL/生命周期字段，或 ID 冲突及部分部署使新旧读取器采用不同默认值。 | [DATA-ISOLATION-AND-LIFECYCLE.md:52](/Users/daitongmin/.codex/skills/security-audit/DATA-ISOLATION-AND-LIFECYCLE.md:52) |
| Backup and replication boundary drift | 备份与复制边界漂移 | Encryption keys, storage accounts, cross-region replicas, restoration environments, or support snapshots have broader identity or tenant scope than primary data. | 备份、副本、密钥、恢复环境或支持快照拥有比主数据更宽的身份/租户访问范围。 | [DATA-ISOLATION-AND-LIFECYCLE.md:55](/Users/daitongmin/.codex/skills/security-audit/DATA-ISOLATION-AND-LIFECYCLE.md:55) |
| Soft-delete and tombstone bypass | 软删除与墓碑标记绕过 | Direct lookup, search, relation traversal, object link, background processor, or restore ignores the lifecycle predicate and returns or acts on a deleted/revoked record. | 替代读取、链接、后台处理或恢复忽略删除/撤销条件，继续返回或操作相关记录。 | [DATA-ISOLATION-AND-LIFECYCLE.md:60](/Users/daitongmin/.codex/skills/security-audit/DATA-ISOLATION-AND-LIFECYCLE.md:60) |
| Stale authorization and derived copy use | 过期授权与衍生副本使用 | Membership removal, ACL update, consent withdrawal, secret revocation, or role downgrade does not invalidate sessions, caches, subscriptions, jobs, or materialized data that continue to authorize future operations. | 成员、ACL、同意、秘密或角色撤销后，会话、缓存、订阅、任务或物化数据仍授权后续操作。 | [DATA-ISOLATION-AND-LIFECYCLE.md:63](/Users/daitongmin/.codex/skills/security-audit/DATA-ISOLATION-AND-LIFECYCLE.md:63) |
| Retention and queued-work overrun | 保留期限与排队工作超出约定 | Deletion completes in primary storage while queued processors, retries, exports, analytics, or generated artifacts recreate or retain the data beyond the promised boundary. | 主存储已删除数据，但排队、重试、导出、分析或生成产物重新创建或继续保留它。 | [DATA-ISOLATION-AND-LIFECYCLE.md:66](/Users/daitongmin/.codex/skills/security-audit/DATA-ISOLATION-AND-LIFECYCLE.md:66) |
| Restore reintroduces invalid state | 恢复重新引入无效状态 | Backup, undo, undelete, or replica recovery restores data, credentials, memberships, or permissions that current policy no longer allows. | 备份恢复、撤销删除或副本恢复带回当前策略不再允许的数据、凭据、成员或权限。 | [DATA-ISOLATION-AND-LIFECYCLE.md:69](/Users/daitongmin/.codex/skills/security-audit/DATA-ISOLATION-AND-LIFECYCLE.md:69) |

### B.11 DESKTOP-MOBILE-AND-LOCAL-IPC.md

| 公共提示块 | 原文位置 |
| --- | --- |
| `DESKTOP-MOBILE-AND-LOCAL-IPC.md#Core discipline` | [DESKTOP-MOBILE-AND-LOCAL-IPC.md:9](/Users/daitongmin/.codex/skills/security-audit/DESKTOP-MOBILE-AND-LOCAL-IPC.md:9) |
| `DESKTOP-MOBILE-AND-LOCAL-IPC.md#Universal moves` | [DESKTOP-MOBILE-AND-LOCAL-IPC.md:77](/Users/daitongmin/.codex/skills/security-audit/DESKTOP-MOBILE-AND-LOCAL-IPC.md:77) |
| `DESKTOP-MOBILE-AND-LOCAL-IPC.md#Validation rules` | [DESKTOP-MOBILE-AND-LOCAL-IPC.md:83](/Users/daitongmin/.codex/skills/security-audit/DESKTOP-MOBILE-AND-LOCAL-IPC.md:83) |

| 类别原名 | 类别中文说明 | 原文意图片段 | 意图片段中文说明 | 原文位置 |
| --- | --- | --- | --- | --- |
| Custom-scheme and deep-link ambiguity | 自定义 URI 协议与深链接歧义 | Another app or page can invoke a route that mutates state, imports data, completes authentication, or selects an account without a current-session and one-time callback binding. | 其他应用/页面在缺少当前会话及一次回调绑定时，通过路由修改状态、导入、完成认证或选择账户。 | [DESKTOP-MOBILE-AND-LOCAL-IPC.md:21](/Users/daitongmin/.codex/skills/security-audit/DESKTOP-MOBILE-AND-LOCAL-IPC.md:21) |
| App and account handoff confusion | 应用与账户交接混淆 | OAuth, SSO, magic-link, invite, device pairing, passwordless, or payment callbacks return to the wrong installed app, profile, tenant, or pending transaction. | 登录、邀请、配对或支付回调进入错误的应用、profile、租户或待处理事务。 | [DESKTOP-MOBILE-AND-LOCAL-IPC.md:24](/Users/daitongmin/.codex/skills/security-audit/DESKTOP-MOBILE-AND-LOCAL-IPC.md:24) |
| File-open and intent authority confusion | 文件打开与 Intent 权限混淆 | An associated file, share intent, drag/drop item, pasteboard/clipboard record, notification action, or open-file event triggers a privileged operation without confirming content type, sender trust where applicable, curre… | 文件关联、共享 Intent、拖放、剪贴板、通知或打开事件在未充分校验类型、来源及用户意图时触发特权操作。 | [DESKTOP-MOBILE-AND-LOCAL-IPC.md:27](/Users/daitongmin/.codex/skills/security-audit/DESKTOP-MOBILE-AND-LOCAL-IPC.md:27) |
| Navigation-origin to bridge confusion | 导航来源与原生桥接混淆 | Remote or attacker-controlled frames can reach a JavaScript/native bridge intended only for packaged content. | 远程或可控 frame 能访问原本仅面向应用打包内容的 JavaScript/原生桥。 | [DESKTOP-MOBILE-AND-LOCAL-IPC.md:32](/Users/daitongmin/.codex/skills/security-audit/DESKTOP-MOBILE-AND-LOCAL-IPC.md:32) |
| Over-broad native bridge capabilities | 原生桥接能力过宽 | Web content can select arbitrary files, commands, IPC methods, credentials, or system actions through a generic bridge. | 网页通过通用 bridge 选择任意文件、命令、IPC 方法、凭据或系统动作。 | [DESKTOP-MOBILE-AND-LOCAL-IPC.md:35](/Users/daitongmin/.codex/skills/security-audit/DESKTOP-MOBILE-AND-LOCAL-IPC.md:35) |
| Webview file and universal access | WebView 文件与跨源通用访问 | Remote content can read app-local files, privileged custom schemes, or internal origins because file access, universal access, mixed content, debug interfaces, or custom protocol handlers join origins unexpectedly. | 文件访问、通用访问、混合内容、调试或自定义协议意外连接不同来源，使远程内容读取本地受保护数据。 | [DESKTOP-MOBILE-AND-LOCAL-IPC.md:38](/Users/daitongmin/.codex/skills/security-audit/DESKTOP-MOBILE-AND-LOCAL-IPC.md:38) |
| IPC peer-authentication gaps | IPC 对端认证缺口 | Unix sockets, named pipes, XPC, Binder, D-Bus, native messaging, RPC, shared memory, or loopback listeners accept a lower-trust peer without checking OS credentials, code identity, sandbox token, or channel ownership. | 本地 IPC 或 loopback 接口未验证 OS 凭据、代码身份、sandbox token 或通道归属就接受低信任对端。 | [DESKTOP-MOBILE-AND-LOCAL-IPC.md:43](/Users/daitongmin/.codex/skills/security-audit/DESKTOP-MOBILE-AND-LOCAL-IPC.md:43) |
| Claimed principal versus channel identity | 自报主体与通道身份不一致 | The authenticated process/channel belongs to one app or user, but request fields select another user, tenant, profile, or capability. | 已认证的进程/通道属于一个应用或用户，但请求字段指定另一个用户、租户、profile 或能力。 | [DESKTOP-MOBILE-AND-LOCAL-IPC.md:46](/Users/daitongmin/.codex/skills/security-audit/DESKTOP-MOBILE-AND-LOCAL-IPC.md:46) |
| Exported service, activity, receiver, or provider overreach | 导出组件权限越界 | A mobile component or local automation endpoint is externally invokable and performs an operation intended for the app itself. | 移动组件或本地自动化接口被外部调用，执行原本只允许应用自身执行的操作。 | [DESKTOP-MOBILE-AND-LOCAL-IPC.md:49](/Users/daitongmin/.codex/skills/security-audit/DESKTOP-MOBILE-AND-LOCAL-IPC.md:49) |
| IPC lifecycle and correlation confusion | IPC 生命周期与请求关联混淆 | Predictable request IDs, reused handles, stale channels, inherited descriptors, world-writable socket paths, or restart behavior lets one peer answer, cancel, or reuse another peer's operation. | 请求 ID、句柄、旧通道、继承描述符、可写 socket 路径或重启让一个对端响应、取消或复用另一方操作。 | [DESKTOP-MOBILE-AND-LOCAL-IPC.md:52](/Users/daitongmin/.codex/skills/security-audit/DESKTOP-MOBILE-AND-LOCAL-IPC.md:52) |
| Privileged helper as confused deputy | 特权辅助程序成为混淆代理 | A low-privilege caller can select a privileged command, file, service, user, or system setting without per-operation authorization. | 低权限调用者在缺少逐操作授权时选择特权命令、文件、服务、用户或系统设置。 | [DESKTOP-MOBILE-AND-LOCAL-IPC.md:57](/Users/daitongmin/.codex/skills/security-audit/DESKTOP-MOBILE-AND-LOCAL-IPC.md:57) |
| Install, update, and repair path trust | 安装、更新与修复路径信任缺陷 | A privileged installer/helper reads manifests, scripts, packages, symlinks, working directories, or repair state writable by a lower-trust actor after authorization. | 特权安装器/辅助程序在授权后读取低信任主体可写的 manifest、脚本、包、链接、目录或修复状态。 | [DESKTOP-MOBILE-AND-LOCAL-IPC.md:60](/Users/daitongmin/.codex/skills/security-audit/DESKTOP-MOBILE-AND-LOCAL-IPC.md:60) |
| Local file ownership and TOCTOU | 本地文件所有权与 TOCTOU 缺陷 | The app checks a file/path then follows replacement, symlink, mount, or case/normalization changes during a privileged read/write. | 应用检查文件/路径后，特权读写实际使用时发生替换、符号链接、挂载或大小写/规范化变化。 | [DESKTOP-MOBILE-AND-LOCAL-IPC.md:63](/Users/daitongmin/.codex/skills/security-audit/DESKTOP-MOBILE-AND-LOCAL-IPC.md:63) |
| Credential-store and local-secret boundary mismatch | 凭据存储与本地秘密边界不一致 | A keychain/keystore item, token file, backup, log, clipboard, notification preview, or local config is readable by another app/profile/user with less authority. | 其他低权限应用、profile 或用户可读取钥匙串、令牌文件、备份、日志、剪贴板或配置中的秘密。 | [DESKTOP-MOBILE-AND-LOCAL-IPC.md:66](/Users/daitongmin/.codex/skills/security-audit/DESKTOP-MOBILE-AND-LOCAL-IPC.md:66) |
| Account switch, logout, and device restore leakage | 账户切换、退出与设备恢复泄露 | Cached data, background tasks, widgets, notifications, local databases, webview storage, or biometric approvals survive logout/account change and appear under a later account. | 缓存、后台任务、通知、本地数据库、WebView 存储或生物认证批准在换号/退出后留存并出现在后续账户。 | [DESKTOP-MOBILE-AND-LOCAL-IPC.md:71](/Users/daitongmin/.codex/skills/security-audit/DESKTOP-MOBILE-AND-LOCAL-IPC.md:71) |
| Pending-action and user-presence confusion | 待执行动作与用户在场确认混淆 | Notification, widget, shortcut, share sheet, biometric prompt, or deferred operation authorizes a different action than displayed, executes after expiry, or uses another profile's pending state. | 通知、快捷方式、生物认证或延迟任务授权的动作与展示不同、过期后执行，或使用其他 profile 的待处理状态。 | [DESKTOP-MOBILE-AND-LOCAL-IPC.md:74](/Users/daitongmin/.codex/skills/security-audit/DESKTOP-MOBILE-AND-LOCAL-IPC.md:74) |

类别索引共 162 项（九种普通类 + 十个专项文件中的类别）。不包含组标题和公共纪律块；这些不是固定数量的 Agent。

## 附录 C. schema 关键字与内部术语

这些是描述数据契约的关键字，不是需要向 MySQL 导入的 finding 属性。S7 是针对本 schema 使用子集编写的解释器，不应当作支持所有 JSON Schema 版本/关键字的通用实现。

| 关键字 | 作用 | 对当前契约的影响 |
| --- | --- | --- |
| `type` | 限制值类型 | 支持 object、array、string、integer、number、boolean、null；具体字段按自己的定义匹配。 |
| `properties` | 声明对象属性 | 三种 verdict 各有一组字段。 |
| `required` | 声明必须存在的属性名 | 必需数组存在不一定意味着数组非空，另看 minItems。 |
| `additionalProperties` | 限制未列出的属性 | findings 分支与嵌套对象通常 false；新增采集字段要外置。 |
| `oneOf` | 恰好匹配一个分支 | confirmed/NV/rejected 不能混搭。 |
| `const` | 固定值 | 例如 verdict=confirmed。 |
| `enum` | 允许值清单 | trace kind、条件 kind、severity、confidence。 |
| `items` | 数组元素契约 | trace/evidence/conditions 的元素结构。 |
| `minItems` | 数组最少元素数 | trace/evidence/payloads/instructions 至少一项；conditions 没有此要求。 |
| `uniqueItems` | 内容唯一性 | 某些数组要求不重复；对象键顺序不改变内容相等性。 |
| `minLength` | 最小字符长度 | 多数文字至少一字符；不能替代可见性检查。 |
| `minimum` | 数值下限 | 源码 line 必须≥1。 |
| `pattern` | 正则格式 | fingerprint 的允许字符。 |
| `visibleContent` | 本解释器支持的自定义字符串约束 | 禁止仅空白/不可见内容并检查 Unicode scalar；不是通用标准关键字。 |
| `description` | schema 中的解释文字 | 与 finding 实际 `description` 属性是不同层次。 |
| `$comment` | schema 注释 | 不属于业务发现数据。 |
| `canonical_refs` | 覆盖单元的源派生身份 | 与 display label 分离；NFC 和精确编码。 |
| `canonical key` | 校验器内部唯一性比较表示 | 不应误认为 coverage_id 或数据库主键。 |
| `promotion` | 把受控 scratch 最小文件经可信父端检查后保留 | 与 verdict 从 NV 升 confirmed 是两种不同晋升语义。 |
| `native interface` | 目标自己的 API/CLI/库调用/文件/消息/IPC 等接口 | 不能默认所有重现都必须有 HTTP endpoint。 |

## 附录 D. 阅读顺序

| 如果你现在想回答 | 先看 |
| --- | --- |
| 每一步做什么、谁负责 | 第 2–4 节。 |
| 有哪些文件，谁写、何时写 | 第 5 节。 |
| 原有字段全名、类型和作用 | 第 6–12 节。 |
| 做了什么假设、如何分析、如何验证 | 第 13–14 节；区别已规定与实际采集。 |
| 校验器是不是真在检测漏洞 | 第 15 节。 |
| 怎样保存外显调查路径、假设变化 | 第 16 节。 |
| 下一步怎么映射 MySQL | 第 17 节；当前还没有 DDL。 |
| 如何分析并改良 skill，避免错误结论 | 第 18–19 节。 |
| 原始类别/关键字定义在哪里 | 附录 B–C；版本依据在附录 A。 |

