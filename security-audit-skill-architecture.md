# Security Audit Skill 专业架构说明

## 1. 总体架构

```mermaid
flowchart TB
    U[用户审计请求] --> P

    subgraph HOST[宿主 Agent 平台]
        P[父 Agent / Parent<br/>审计编排与共享状态唯一写入者]
        TT[子 Agent 调度能力<br/>创建独立模型上下文]
        FT[文件与代码工具<br/>读取、搜索、命令执行]
        SB[OS 强隔离沙箱<br/>离线、只读目标、限额执行]
        P --> TT
        TT --> FT
        TT --> SB
    end

    subgraph RECON[阶段 1：侦察层]
        R1[Agent 1a<br/>产品、技术栈、入口、构建]
        R2[Agent 1b<br/>身份、权限、信任边界]
        R3[Agent 1c<br/>输入、传播路径、敏感 Sink]
        R4[Agent 1d<br/>本地验证与部署可见性]
    end

    TT --> R1
    TT --> R2
    TT --> R3
    TT --> R4
    R1 --> A[architecture.md<br/>安全架构摘要]
    R2 --> A
    R3 --> A
    R4 --> A
    R1 --> L[coverage-ledger.json<br/>确定性覆盖状态机]
    R2 --> L
    R3 --> L
    R4 --> L

    subgraph HUNT[阶段 2：漏洞发现层]
        H1[Hunter A<br/>指定模块与攻击类别]
        H2[Hunter B<br/>指定模块与攻击类别]
        HN[Hunter N<br/>指定模块与攻击类别]
        CC[Coverage Critic<br/>查找遗漏与错误关闭的覆盖单元]
    end

    P --> H1
    P --> H2
    P --> HN
    A --> H1
    A --> H2
    A --> HN
    L --> H1
    L --> H2
    L --> HN
    H1 --> C[候选漏洞<br/>稳定 Fingerprint + 结构化证据]
    H2 --> C
    HN --> C
    L --> CC
    CC -->|新增或重新分配覆盖单元| L

    subgraph VERIFY[阶段 3–5：独立验证层]
        V1[Candidate Verifier<br/>尝试反驳每个候选]
        JS[findings.json<br/>confirmed / needs_validation / rejected]
        V2[Final Record Verifier<br/>复核最终记录与严重性]
    end

    C --> V1
    V1 --> JS
    JS --> V2
    V2 -->|验证或经独立复核后替换| JS

    subgraph VALIDATORS[形式校验层]
        SC[report-schema.json<br/>Finding 数据契约]
        VF[validate-findings.cjs<br/>漏洞记录校验器]
        VL[validate-coverage-ledger.cjs<br/>覆盖状态校验器]
    end

    SC --> VF
    JS --> VF
    L --> VL
    VF -->|通过| REPORTS
    VL -->|通过| REPORTS

    subgraph REPORTS[阶段 6：报告层]
        RP[REPORT.md<br/>总体安全报告]
        FD[FINDINGS-DETAIL.md<br/>中高危详细证据]
        NV[NEEDS-VALIDATION.md<br/>待确认事实与安全验证计划]
    end
```

## 2. 各架构层职责

| 架构层 | 组件 | 主要职责 | 是否直接检测漏洞 |
|---|---|---|---|
| 宿主平台层 | 父 Agent | 解析请求、选择审计模式、分配任务、维护预算和共享文件、汇总结论 | 间接 |
| 宿主平台层 | 子 Agent 调度能力 | 创建相互隔离的大模型上下文，并传入不同角色、范围和提示词 | 否 |
| 宿主平台层 | 文件与代码工具 | 读取源码、搜索符号和调用链、执行本地命令 | 提供检测基础 |
| 执行安全层 | OS 沙箱 | 隔离目标代码，禁止外网，限制资源，只允许写入指定 scratch | 否，负责安全执行 |
| 侦察层 | Agent 1a | 识别产品、技术栈、入口点、子系统、构建和测试方式 | 不产生正式漏洞 |
| 侦察层 | Agent 1b | 识别 principals、认证、授权、租户隔离、权限变化和信任边界 | 不产生正式漏洞 |
| 侦察层 | Agent 1c | 枚举低信任输入、数据转换、派生副本和安全敏感 sink | 不产生正式漏洞 |
| 侦察层 | Agent 1d | 判断哪些结论能本地验证、哪些依赖部署事实，以及沙箱能力是否足够 | 不产生正式漏洞 |
| 覆盖层 | Coverage Ledger | 用“入口 × 边界 × 子系统 × 攻击类别”表示审计范围和状态 | 否，证明检查覆盖 |
| 漏洞发现层 | Hunter Agent | 在指定 coverage unit 中深度追踪源码，产生候选漏洞或关闭覆盖单元 | 是 |
| 覆盖审查层 | Coverage Critic | 检查是否遗漏入口、平行路径、生命周期、攻击类别或历史问题 | 不直接确认漏洞 |
| 候选验证层 | Candidate Verifier | 由未参与发现的 Agent 重新阅读源码并尝试反驳候选 | 是，负责定性 |
| 记录复核层 | Final Record Verifier | 复核 trace、条件、影响、严重性、复现和修复建议 | 是，负责最终质量 |
| 形式校验层 | 两个 JavaScript Validator | 检查 JSON 结构、状态机、证据归属、ID、路径和严重性约束 | 否，不分析目标代码 |
| 报告层 | Markdown 报告 | 从验证后的结构化记录生成面向人的正式输出 | 否 |

## 3. 侦察 Agent 的具体实现方式

侦察 Agent 不是独立的安全软件，也不调用专用安全扫描 API。它是在 `RECONNAISSANCE.md` 中定义的四组固定提示词，由父 Agent 通过宿主平台的子 Agent 调度能力执行。

```mermaid
sequenceDiagram
    participant P as 父 Agent
    participant T as 子 Agent 调度能力
    participant R as 侦察 Agent（独立模型上下文）
    participant F as 本地文件/搜索工具
    participant S as 共享审计状态

    P->>T: 创建 research Agent，传入仓库路径和固定侦察提示词
    T->>R: 初始化独立上下文
    R->>F: 读取源码、配置、测试、构建文件
    F-->>R: 返回文件内容和搜索结果
    R->>R: 提取源码事实、信任边界和 file:line 引用
    R-->>P: 返回结构化侦察结果，不直接写共享文件
    P->>S: 汇总写入 architecture.md
    P->>S: 创建并更新 coverage-ledger.json
```

四个侦察角色的定义重点如下：

```text
Agent 1a：回答“系统是什么、从哪里进入、怎样在本地运行”。
Agent 1b：回答“谁拥有什么权限、哪些控制保护哪些资源”。
Agent 1c：回答“低信任数据从哪里进入、经过哪里、最终影响什么”。
Agent 1d：回答“哪些结论可以安全复现、哪些依赖源码之外的事实”。
```

它们的作用最终体现在：

1. `architecture.md` 为后续 Hunter 提供统一安全模型。
2. `coverage-ledger.json` 把侦察结果转换为可分配、可追踪、可验证的安全检查任务。
3. companion attack-class 选择根据侦察发现的真实边界决定，而不是只根据语言或依赖名称决定。

## 4. 漏洞发现与验证数据流

```mermaid
flowchart LR
    CU[Coverage Unit] --> HP[Hunter Prompt<br/>架构 + 范围 + 攻击知识 + 输出契约]
    HP --> SR[源码阅读与调用链追踪]
    SR --> LC{是否需要本地验证}
    LC -->|否| SE[源码证据]
    LC -->|是且沙箱完备| EX[项目测试 / Harness / Sanitizer / Fuzzer]
    LC -->|沙箱或外部事实缺失| NV[needs_validation 候选]
    EX --> OE[最小 Observed Result]
    SE --> CG[Candidate Gate]
    OE --> CG
    CG -->|完整边界与结果| PC[proposed confirmed]
    CG -->|决定性事实缺失| NV
    CG -->|无真实边界影响| HD[Hardening 或无 Finding]
    PC --> IV[独立 Verifier]
    NV --> IV
    IV --> CF[confirmed]
    IV --> VN[needs_validation]
    IV --> RJ[rejected]
```

正式确认一个漏洞至少需要：

- 明确的低信任主体；
- 可控输入或动作；
- 本应生效的安全控制；
- 完整的源码路径；
- 被跨越的信任边界；
- 受影响的主体或资源；
- 本地受控环境中观察到的最小结果；
- 独立 Agent 的复核。

## 5. 工具与 API 边界

```mermaid
flowchart TB
    SK[Security Audit Skill] --> MD[Markdown 工作流与提示词]
    SK --> JV[本地 JavaScript 校验器]
    MD --> LM[大模型源码分析]
    LM --> PT[宿主平台工具]
    PT --> READ[文件读取与代码搜索]
    PT --> CMD[受控命令执行]
    PT --> SUB[子 Agent 调度]
    CMD -.按仓库现有条件可选.-> NATIVE[项目测试 / Sanitizer / Fuzzer / Emulator]

    X1[CodeQL]:::notused
    X2[Semgrep]:::notused
    X3[Burp / ZAP]:::notused
    X4[Trivy / Snyk]:::notused

    SK -.未内置集成.-> X1
    SK -.未内置集成.-> X2
    SK -.未内置集成.-> X3
    SK -.未内置集成.-> X4

    classDef notused stroke-dasharray: 5 5;
```

结论：该 skill 没有内置第三方安全扫描 API。漏洞发现主要由大模型进行源码语义分析；宿主平台提供文件、命令和子 Agent 能力；项目现有测试或安全工具只在满足离线与沙箱条件时作为可选验证手段；JavaScript 校验器仅检查审计结果的一致性，不负责发现漏洞。

### 假设扩展：加入第三方安全工具后的流程（当前未实现）

> 以下流程是基于现有架构的扩展设计，不属于当前 skill 的真实实现。当前仓库没有工具选择器、调用适配器、结果解析器或告警映射代码。

```mermaid
flowchart TB
    R[Phase 1：侦察 Agent<br/>识别技术栈、攻击面和本地可用工具] --> SEL[父 Agent：工具选择与执行计划<br/>确定工具、范围、命令、资源上限和输出文件]

    SEL --> ADAPTER[新增：安全工具适配层]

    subgraph TOOLS[可选第三方工具]
        SAST[Semgrep / CodeQL<br/>规则与数据流分析]
        DEP[Trivy / Grype / OSV<br/>依赖、镜像和配置扫描]
        SEC[Secret Scanner<br/>凭据泄露线索]
        DYN[Sanitizer / Fuzzer<br/>本地动态验证]
        IAC[IaC / Policy 工具<br/>部署配置与策略验证]
    end

    ADAPTER --> SAST
    ADAPTER --> DEP
    ADAPTER --> SEC
    ADAPTER --> DYN
    ADAPTER --> IAC

    SAST --> RAW[原始工具结果]
    DEP --> RAW
    SEC --> RAW
    DYN --> RAW
    IAC --> RAW

    RAW --> SB[OS 强隔离沙箱中的 Agent scratch]
    SB --> PROMOTE[父 Agent 安全提升<br/>只接收预声明、限长的普通文件]
    PROMOTE --> NORMALIZE[新增：结果解析与标准化层<br/>保留工具、规则、位置、证据和原始严重性]
    NORMALIZE --> MAP[新增：告警映射层<br/>映射到现有 coverage unit 或创建待审查 unit]

    MAP --> H[Hunter Agent<br/>重新阅读源码并验证入口、控制、边界和影响]
    H --> GATE{Candidate Gate}

    GATE -->|仅规则命中或无真实边界影响| DROP[拒绝 / Hardening Note]
    GATE -->|关键部署或运行事实缺失| NV[proposed needs_validation]
    GATE -->|完整源码路径与最小观察结果| CF[proposed confirmed]

    NV --> V[独立 Candidate Verifier]
    CF --> V
    V --> F[findings.json]

    F --> VF[validate-findings.cjs]
    MAP --> L[coverage-ledger.json]
    L --> VL[validate-coverage-ledger.cjs]

    VF --> FV[Final Record Verifier]
    VL --> FV
    FV --> REPORT[最终报告]
```

扩展后仍需维持现有证据规则：第三方工具告警只能作为候选线索，不能直接成为 `confirmed`；工具自身的严重性不能直接替代 skill 基于实际影响生成的严重性；两个 JavaScript 校验器仍只验证最终产物结构和内部一致性，不验证扫描器告警是否真实。

## 6. Agent 角色定义位置

| 角色 | Agent 类型 | 定义位置 | 具体定义内容 | 调度与输出 |
|---|---|---|---|---|
| 父 Agent（Parent） | 当前主 Agent / 编排者 | `SKILL.md` 的 `Platform terminology`、`Full audit setup` 和 `Full audit workflow` | 负责模式选择、预算门控、Agent 分配、共享状态写入、候选合并、校验和报告生成 | 由用户请求触发；是共享审计文件的唯一写入者 |
| Agent 1a：Product, stack, and local operation | `research` | `RECONNAISSANCE.md:9` | 识别产品、技术栈、入口、子系统、构建测试命令和本地工具限制 | Parent 在 Phase 1 并行启动；返回带 `file:line` 的源码事实 |
| Agent 1b：Principals, authority, and controls | `research` | `RECONNAISSANCE.md:22` | 识别 principal、认证、授权、租户隔离、权限变化和源码不可见控制 | Parent 在 Phase 1 并行启动；返回信任边界和控制位置 |
| Agent 1c：Entry surfaces, copies, and sinks | `research` | `RECONNAISSANCE.md:35` | 枚举外部输入、数据转换、存储或派生副本以及安全敏感 sink | Parent 在 Phase 1 并行启动；返回入口到 sink 的源码路径 |
| Agent 1d：Local execution and deployment visibility | `research` | `RECONNAISSANCE.md:44` | 判断本地验证方式、禁止执行项、部署不可见事实、沙箱及 artifact promotion 能力 | Parent 在 Phase 1 并行启动；返回可执行性和验证 blocker |
| Hunter Agent | `general` | `HUNTING.md` 的 `Phase 2: Run coverage-led hunting waves` 和 `Required hunter prompt` | 根据分配的 coverage unit、攻击类别和 companion 内容深度追踪源码，返回 covered、candidate 或 blocked | Parent 按 wave 分配；每个 Hunter 只处理自己的 coverage IDs |
| Coverage Critic | `research` | `HUNTING.md:221` 的 `Coverage-critic waves` | 查找未建模入口、平行路径、生命周期遗漏、不合理排除和错误关闭的 unit | 每个 Hunter wave 后由 Parent 启动；输出 missing units 和 reassign IDs |
| Candidate Verifier | `general` | `VALIDATION-AND-REPORTING.md:3` 和 `Candidate-verifier prompt` | 独立尝试反驳候选，重新检查源码和最小复现，判定 confirmed、needs_validation 或 rejected | 每个唯一 fingerprint 使用未参与发现的新 Agent |
| Final Record Verifier | `research` | `VALIDATION-AND-REPORTING.md:120` 的 `Phase 5` | 复核最终结构化记录中的 trace、条件、观察结果、影响、严重性和修复建议 | 对每个最终 confirmed 和 needs_validation 记录执行；material replacement 需要再次独立复核 |

> 这些角色都不是仓库中的 JavaScript 类或独立可执行程序。它们通过 Markdown 中的角色说明、固定提示词、上下文范围和输出契约定义，再由宿主平台的子 Agent 调度能力创建对应的大模型上下文。

## 7. 关键文件对应关系

| 文件 | 架构作用 |
|---|---|
| `SKILL.md` | 总体策略、模式、预算、安全边界和六阶段入口 |
| `RECONNAISSANCE.md` | 定义四类侦察 Agent 及 Coverage Ledger |
| `HUNTING.md` | 定义 Hunter、Coverage Critic、候选输出和证据规则 |
| `VALIDATION-AND-REPORTING.md` | 定义独立验证、最终复核和报告生成 |
| `ATTACK-CLASSES.md` | 通用攻击类别知识库 |
| 各领域 companion `.md` | Web、AI、云、供应链、IPC、内存安全等专项知识 |
| `report-schema.json` | `findings.json` 数据契约 |
| `validate-findings.cjs` | Finding 结构与语义一致性校验 |
| `validate-coverage-ledger.cjs` | Coverage 状态机与证据归属校验 |
