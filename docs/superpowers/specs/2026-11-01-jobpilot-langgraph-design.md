# JobPilot：基于 LangGraph 的求职辅助 Agent 设计方案

日期：2026-11-01。状态：用户已确认设计；V1 代码、CLI 和自动验证已实现，独立审查的重要问题已修复。人工语义复核、用户学习验收与 V1.1 仍未完成，详见 ../../jobpilot/acceptance.md。

## 1. 目标与已达成的共识

用户求职方向是 Java 全栈 + AI 应用，希望尽快完成真实的 LangGraph 项目，写入简历，同时通过改造学习相关知识。用户已认可上一轮推荐：在 job-search-skills 中增加单 Agent、受限岗位工具、人工审核和持久化恢复。

首版交付一个可在本机运行、无需登录招聘网站即可演示的求职决策 Agent。输入简历文本、求职偏好和岗位资料，输出带来源依据的匹配分析、能力缺口和可审核沟通草稿。Agent 根据资料决定是否调用工具补充岗位详情。范围控制、次数限制和人工审核由程序执行。

首版成功意味着：真实模型参与决策；实际执行工具调用；至少两条不同决策路径可复现；审核暂停能跨进程恢复；结果有证据；异常能明确收敛；用户能够解释设计和关键代码。安装依赖、画出图或只用固定模型回答，不算首版完成。

## 2. 方案比较与选择

| 方案 | 优点 | 代价 | 结论 |
| --- | --- | --- | --- |
| 固定 AI 分析流水线 | 最容易跑通 | 缺少模型选择工具的实际需求 | 用作第一个学习阶段 |
| 单 Agent + 工具 + 固定审核流程 | 有真实决策，规模可控，便于验证 | 要处理工具循环和恢复 | 用户认可的推荐方向 |
| 多 Agent / 重写 OpenClaw / 同时增加 Java 服务 | 可扩展范围大 | 增加协调、部署和学习成本 | 后续有业务需要再做 |

语言沿用 TypeScript、Node 24，使用 LangGraph JS；这是基于现有项目和交付速度的设计选择。首版不新增 Python 服务或 Spring Boot 服务。Java 全栈定位由已有 Java 项目支撑，本项目证明 AI 编排能力。日后若接入 Java，由 Spring Boot 管理业务任务和用户，Agent 服务负责执行，二者通过接口交互；首版不提前建设该架构。

## 3. 当前项目依据与复用边界

- package.json：现有 TypeScript、MCP SDK、Playwright、Vitest；尚无 LangGraph 依赖。
- src/boss-extension/workflow.ts：手写搜索、打开职位、沟通与结果确认循环。新 Agent 不直接改写或调用这一发送循环。
- src/boss-extension/client.ts：MCP 握手、页面绑定、动作执行和运行租约可以在真实接入阶段复用。
- src/boss-extension/store.ts、src/storage/：现有 SQLite 业务记录可借鉴，不与 Agent checkpoint 混为一谈。
- extensions/boss-page/、integrations/mcp-bosszp/：已有浏览器扩展与本机桥接。open_job 并不等同于已完成完整 JD 文本读取，需单独补充和验证正文契约。
- 现有浏览器流程限制固定搜索范围，不能承诺直接支持任意城市关键词。
- AGENTS.md：默认人工发送；本次设计不会调用发送、上传简历或联系招聘方。
- 当前目录不是 Git 仓库。本轮仅保存设计，不自动初始化 Git，也无法提交文档。未来公开仓库要单独整理可公开源码和脱敏样例。

## 4. 版本边界

### V1：必交付，可用于首版简历经历

- 本地单用户 CLI；简历输入 UTF-8 txt/md，岗位输入 JSON；不做 PDF/OCR/Word 解析。
- 1 份简历、1 份偏好配置、每批最多 10 个岗位；按岗位串行执行。
- 真实模型的受限工具决策、匹配分析、结构化草稿。
- 本地岗位工具：列表资料与详情分开，列表不偷偷包含完整详情，确保工具调用有实际意义。
- 人工审核：接受、要求修改、拒绝；拒绝也形成结果记录。
- 持久化 checkpoint、跨进程恢复、日志、报告导出、固定样例评估。
- 内置完全虚构的演示简历和岗位；真实资料单独存放。

### V1.1：真实 MCP 接入，独立验收

- 适配已连接 BOSS 页面，读取列表与完整 JD；导航仍遵循现有绑定和范围检查。
- 验证详情正文来源、职位身份、导航恢复、会话失效处理。
- 真实采集与分析解耦：先将读取结果保存为不可变本地批次，再运行 V1。Agent 不持有长期浏览器会话，也不在审核等待期间维持租约。
- MCP 接入失败时可手工导入 JD；明确显示输入来源，不能把导入成功称为实站采集成功。
- 只有本阶段通过真实只读验收，才把“接入 MCP 真实岗位读取”写入新增项目成果。

### 后续可选

简单审核页面、Java 业务层、更多岗位源、批量并行、长期偏好记忆。首版不含多 Agent、向量数据库、RAG、微服务、用户体系、自动投递和定时任务。岗位材料短小且直接提供，暂时没有引入向量检索的必要。

## 5. 输入与输出契约

### 输入

- ResumeDocument：文本、内容哈希、按段落生成的稳定 evidenceId。
- Preferences：目标岗位、城市、用户明确设置的硬约束和偏好；未填写的薪资、工作制度等不自动变成硬约束。
- JobSummary：jobId、title、company、可选 city/salary/url、来源和采集时间。
- JobDetail：jobId、description、可选 requirements、来源和采集时间、正文哈希、段落 evidenceId。
- Batch：batchId、resumeHash、preferencesHash、jobIds、sourceMode、schemaVersion。

文件按 schema 校验，岗位 ID 不得重复；岗位不存在返回 not_found。首版限制简历 20,000 字符、单岗位详情 20,000 字符、修改意见 2,000 字符，超限明确报错，不静默截断。真实输入进入模型前移除电话、邮箱、证件等不必要标识；只发送分析所需文本。演示默认使用虚构材料。

### 输出

- recommendation：recommended / consider / not_recommended / insufficient_information。
- requirements：要求、must/preferred/unspecified、对应 JD evidenceId。
- matches：岗位要求、对应简历 evidenceId、支持理由。
- gaps：未找到对应证据的要求；写“简历未体现”，不能直接断言用户不会。
- unknowns：缺失或相互矛盾的信息。
- rationale：简短结论依据，不要求模型输出内部思维链。
- draft：草稿正文和所依据的经历 ID；不支持的项目、年限、指标不得写入。
- review：接受/拒绝/待审核、版本号和审核时间。
- provenance：模型、提示词版本、输入哈希、来源模式、执行 ID。

首版不设计百分制综合评分，以免制造无依据的精确度。推荐等级由模型给出并经程序约束：缺少正文时不能输出强推荐；明确违反用户硬约束时标记不推荐；未知不能视为满足。

## 6. Agent 与图设计

单 Agent 指只有一个负责选择工具和下一步的决策角色。简历提取、匹配分析和草稿生成是固定业务节点，并非多个自治 Agent。

| 节点 | 类型 | 作用与后续 |
| --- | --- | --- |
| load_inputs | 程序 | 校验输入、载入冻结快照，失败立即结束 |
| extract_profile | 模型 + 校验 | 提取经历证据；同批次仅执行一次，后续岗位复用已保存结果 |
| decide | 模型，原生 tool calling | 选择 get_job_detail 或 finish_research |
| execute_tool | 程序 | 校验工具名和参数、执行查询、返回结构化 observation，再回 decide |
| analyze | 模型 + 校验 | 输出匹配结论与证据；无充分信息时仅输出缺口 |
| draft | 模型 + 校验 | recommended/consider 才生成草稿；其余直接记录结果 |
| human_review | interrupt | 暂停并返回结论、草稿、版本和审核选项 |
| revise | 模型 + 校验 | 根据意见修改草稿，版本递增，再回 human_review |
| save_result | 程序 | 幂等保存接受/拒绝/无需草稿的结果，然后结束 |

decide 的工具接口只包含 get_job_detail({jobId}) 和 finish_research({reason})；finish_research 是结束信息收集的控制工具，不进行外部操作。list_jobs 由批次入口确定性调用，用户给定的岗位集合冻结后，模型不能自行扩大搜索范围。多工具调用一次只允许一个；违规输出作为可修正错误回给模型并计入预算。

已有完整正文时，不再允许重复读取同版本详情；模型应选择 finish_research。缺失正文时允许请求详情；读取成功则返回原文和证据 ID；无法获取时明确返回 not_found/unavailable。若模型过早结束，analyze 只能输出 insufficient_information 或有明确局限的结果，不捏造资料。

受控 Agent 的演示重点：两个岗位摘要分别含完整信息和缺失正文时，工具调用路径不同；拿到详情后，模型根据新增事实改变结论。

## 7. 状态、批次与恢复

一个岗位对应一个 LangGraph thread_id；一个批次包含最多 10 个 thread。批次先运行每个岗位直到结束或等待审核，再处理下一岗位，避免第一个审核暂停阻塞其余岗位。CLI 审核时指定对应 thread_id。

图状态至少包括：schemaVersion、threadId、batchId、jobId、resume/profile 快照、preferences、jobSummary、jobDetail、toolMessages、evidence、analysis、draft、draftVersion、review、decisionTurns、toolAttempts、modelAttempts、revisionCount、errors、inputHashes、promptVersion、budget。

串行节点通常覆盖当前对象；messages 使用明确的消息合并策略；事件按 eventId 去重；不要把所有数组默认追加，否则恢复会制造重复记录。MCP 客户端、数据库连接、API key、AbortSignal 不进可序列化状态。

三类本地存储：

1. data/jobpilot/checkpoints.sqlite：LangGraph 持久化保存器维护的检查点。
2. data/jobpilot/app.sqlite：batches、tasks、results、reviews、model_operations 表；保存业务查询与幂等记录。
3. private/jobpilot/inputs 与 output/jobpilot：冻结输入和生成报告；保持现有忽略规则。

业务表主键：tasks.thread_id；results(thread_id, draft_version)；reviews(review_id)；model_operations(operation_id)。审核请求必须带 reviewId、threadId、draftVersion、decision、可选 feedback；重复相同请求返回原结果，旧版本请求拒绝。

恢复以 checkpoint 为执行进度来源，业务 tasks 状态可以从 checkpoint 对账更新。save_result 使用唯一键 upsert，发生“数据库已写入但 checkpoint 未更新”时可安全重跑。结果表不把审核接受写成已经发送。

human_review 节点只处理中断与返回值；耗费模型调用的生成动作在前一节点完成。恢复时节点可能重新执行，不能在 interrupt 前执行追加记录、发送消息等副作用。已完成模型操作使用由 threadId、node、版本和输入哈希组成的 operationId 缓存结果；崩溃恰好发生于模型响应返回与缓存落盘之间仍可能重复调用，不承诺 exactly-once 或零重复计费。

CLI 为每个 thread 加执行锁，同一 thread 不能并发恢复；修改输入时创建新任务，不默默覆盖旧任务输入。首版 checkpoint schema 变更不做自动迁移：版本不兼容时明确报错并提示用原版本恢复或新建任务。

## 8. 模型、失败处理与预算

模型经 ModelAdapter 注入，使用一个支持工具调用和结构化响应的模型。优先复用用户可用的兼容接口，但不复制 openclaw-boss 的密钥或承诺现有模型必然支持所有 schema。实施前用虚构材料检查单次文本、工具调用、结构化输出；失败时明确提示配置兼容模型，不伪造通过。

配置通过项目环境变量提供：模型名称、接口地址、API key；.env.example 仅写占位。精确 SDK 和 checkpoint SQLite 包版本在实施时核对 Node 24 兼容性并锁定；优先官方保存器，不自行实现复杂 checkpoint 引擎。

默认上限（设计提议，可在配置中下调）：

- 每岗位 decide 最多 3 轮，详情读取最多 2 次尝试；成功同版本不重复读取。
- 每岗位实际模型请求累计最多 12 次，含重试、格式修复和修改；共享简历提取单独最多 2 次。
- 用户要求修改最多 2 轮；达到上限后仍可接受或拒绝当前草稿，不能继续生成。
- 模型单次超时 45 秒；工具单次 15 秒；每岗位累计活跃执行时间最多 180 秒，人工等待不计入，重启不重置预算。
- 临时网络故障最多重试 1 次；鉴权、输入错误、越权工具不做网络重试。结构不合法最多修复 1 次，仍失败则标记错误。
- 每个逻辑操作最多 2 次实际请求，统一调度，避免 SDK 重试与节点重试叠加；请求前持久化预算扣减，崩溃可保守多扣但不自动重置。
- 预算到顶：有已校验分析则保存 partial 结果；否则标记 failed。展示原因，继续批次其他岗位。

错误分为 invalid_input、model_unavailable、invalid_output、tool_unavailable、budget_exceeded、stale_review、incompatible_checkpoint。过程失败不冒充正常“不推荐”；业务推荐和任务状态分别保存。

岗位正文、简历和工具返回都是资料，不能改变工具允许范围或覆盖系统约束。工具参数只能引用当前岗位 ID；模型不能提交任意 URL、脚本或文件路径。证据校验检查 ID 与引文确实存在；这不等同于自动证明语义正确，仍需要人工评估。

## 9. CLI 与报告契约（拟新增，当前不可执行）

- jobpilot analyze --resume <txt> --jobs <json> --preferences <json>：冻结输入并创建批次，逐岗位执行。
- jobpilot status --batch <id>：列出 completed / waiting_review / partial / failed 与待审核 thread。
- jobpilot review --thread <id> --version <n> --review-id <id> --decision approve|revise|reject [--feedback <text>]：校验后恢复图。
- jobpilot resume --thread <id>：继续被异常中断、可恢复的任务；不能代替审核，也不重置预算。
- jobpilot export --batch <id>：输出 JSON 和 Markdown 报告；包含来源、结论、依据、缺口及审核状态。
- jobpilot demo：只使用虚构样例，启动真实模型演示；没有模型配置时明确报错。

命令最终接入现有脚本方式由实现者确定，上述是行为契约。无模型测试用单独的 test 命令，不能把 mock demo 当作真实演示。

日志记录节点、耗时、工具、重试、状态、输入哈希、模型返回的 token 用量（若有）；不记录 key、完整简历或聊天正文，不要求记录思维链。外部 tracing 默认关闭。V1 不承诺 token 的货币成本估算，模型价格与实际账单另行核实。

## 10. 目录与改造位置

| 位置（拟新增） | 职责 |
| --- | --- |
| src/jobpilot/state.ts、schemas.ts | 状态、输入输出和审核 schema |
| src/jobpilot/graph.ts、nodes/ | 图装配与各业务节点 |
| src/jobpilot/tools/ | 工具 schema、本地岗位源、后续 MCP 导入适配 |
| src/jobpilot/model.ts、prompts/ | 模型接口、版本化提示词 |
| src/jobpilot/checkpointer.ts、store.ts | 图持久化与业务存储 |
| src/jobpilot/service.ts、cli.ts | 创建、查询、恢复、审核、导出 |
| tests/jobpilot/、tests/fixtures/jobpilot/ | 测试、虚构案例、标签 |
| docs/jobpilot/ | 使用说明、学习笔记、验收和演示脚本 |

现有 package.json 增加必要依赖和入口脚本。沿用当前 TypeScript 和 Vitest 配置，只在兼容性需要时调整。V1 不修改既有发送逻辑、不迁移或清空旧业务数据库。真实 MCP 阶段再修改扩展正文提取与对应契约，并针对旧流程跑回归。

## 11. 验收与评估

### 确定性测试，不请求真实模型或招聘网站

1. 完整 JD 可直接分析，缺失正文通过工具补全。
2. 未知岗位、工具超时、重复调用、非法工具和预算耗尽均可收敛。
3. 结构化输出错误只修复一次；不存在的 evidenceId 被拒绝。
4. 缺少岗位正文不能形成强推荐；硬约束冲突不生成误导推荐。
5. 人工修改会生成新版本；两轮上限有效；重复和过期审核请求不会重复推进。
6. 在进程 A 暂停，退出；进程 B 从磁盘恢复同一 thread，之前已完成的分析不重跑。
7. 结果写入后模拟 checkpoint 未更新，恢复不产生重复结果。
8. 一批任务中部分待审核或失败，不妨碍其他岗位执行。
9. 恶意 JD 要求执行脚本、发送消息或忽略用户条件，无法扩大工具权限。
10. 原有项目测试、typecheck 和 build 通过；测试不联系招聘方。

### 真实模型评估

准备 12 份虚构/脱敏 JD：强匹配 3、部分匹配 3、明显不匹配 2、缺少正文但可补全 2、无法补全 1、包含指令干扰 1。每份手工标注关键要求、证据位置、允许的推荐范围和预期工具行为。用 8 份开发，4 份保留验收，避免只优化演示样例。

验收门槛：全套确定性测试通过；12 份真实模型案例均有结果或明确失败状态；审核进程恢复演示成功；引用不存在证据、未经许可调用工具、超过硬预算三类问题必须为 0。推荐结论人工复核一致至少 10/12，低于门槛需记录原因并修正；这个小样本指标只用于本项目验收，不代表生产准确率。统计样本数、模型版本、提示词版本、运行日期、耗时中位数和工具行为，不编造提升比例。

MCP 阶段另加真实只读验收：从当前已连接页面取少量岗位，确认 jobId/公司/标题/正文对应，保存本地输入后释放连接；全过程不调用沟通或发送工具。单独记录现场证据和失败，不以本地测试替代实站验收。

## 12. 实施阶段与学习安排

以下是里程碑与学习顺序，不是尚未批准的逐文件实施计划。设计确认后再生成实施计划。

| 阶段 | 可演示产物 | 学习重点 | 粗估专注时间 |
| --- | --- | --- | --- |
| M0 模型与持久化兼容性 | 虚构输入的模型/工具/schema 检查、磁盘 checkpoint 最小验证 | 模型接口与 LangGraph 的边界 | 0.5 天 |
| M1 最小分析图 | 一个完整 JD 得到有依据的报告 | State、Node、Edge、条件边、状态更新 | 1 天 |
| M2 工具决策循环 | 缺失详情触发实际查询，并在上限内退出 | tool calling、observation、终止条件 | 1 天 |
| M3 人工审核与恢复 | 暂停、修改、拒绝、跨进程恢复 | interrupt、Command、thread_id、幂等 | 1～1.5 天 |
| M4 批次与项目交付 | 固定样例、评估报告、CLI、演示、README | 测试边界、失败状态、效果评估 | 1～2 天 |
| M5 MCP 真实导入（V1.1） | 真实岗位输入 + Agent 分析 | MCP 与工具封装、页面身份和数据契约 | 1～3 天，受页面影响 |

V1 约 4.5～6 个专注开发日，不是保证交付日期；每日仅学习数小时应按实际投入延长。每个阶段采用“解释概念 → 实现一个小能力 → 用户改一个条件 → 观察状态与路径 → 写五句话复盘”的方式。完成标准包含用户能解释自己的代码，不能仅以助手完成代码作为学习完成。

优先削减项：UI、真实网站接入、批次规模、额外岗位源。不得削减真实模型决策、实际工具调用、持久化恢复、证据约束和必要测试，否则会削弱项目核心。

## 13. 面试演示与简历表达

五分钟演示：介绍输入和问题；展示完整 JD 直接分析；展示缺失详情触发工具；查看证据与草稿；暂停后退出进程；重新启动并修改草稿；展示未知资料或工具失败如何终止。

完成 V1 并有证据后可写：

> JobPilot 求职辅助 Agent｜TypeScript、LangGraph、SQLite
> 基于 LangGraph 构建岗位信息补全、简历匹配和沟通草稿生成流程，通过受限工具调用与条件路由实现有界决策；设计基于来源证据的结构化分析、人工审核及持久化 checkpoint，支持任务暂停、修改与跨进程恢复，并用固定案例验证工具异常、预算限制和恢复行为。

完成 V1.1 后追加 MCP 与真实读取成果。没有 Java 服务就不写 Java 项目；没有真实模型就不写智能决策已完成；没有实站验收就不写实时招聘平台集成已完成；不写没有测量依据的准确率和效率提升。

需要能回答：为什么不直接顺序调用函数；Agent 自主决定的范围是什么；LangGraph 与 MCP 分别负责什么；checkpoint 与业务库有什么区别；恢复为什么可能重跑节点；怎么限制循环和成本；简历没有证据时怎么表达；岗位信息不足和技能不匹配为何不能混为一谈。

## 14. 已确定、设计默认与交给实现者的事项

用户已明确：Java 全栈 + AI 求职定位、快速交付、边做边学；认可求职项目单 Agent 方向。

本设计默认：TypeScript 首版、CLI、单用户、单岗位 thread、10 岗位串行批次、V1 本地工具、V1.1 MCP 导入、无自动发送、上述预算和输入上限。用户可在确认设计时调整。

实现者可决定：精确依赖版本、节点函数拆分、错误提示文案、SQLite 索引和非功能性排版。模型配置通过环境提供；不在设计中绑定未经验证的具体模型。若现有模型或 SQLite 保存器不兼容，先报告实际障碍和最小调整，不静默扩成多服务架构。

## 15. 官方学习资料

- [LangGraph JS 概览](https://docs.langchain.com/oss/javascript/langgraph/overview)：图编排的定位。
- [Thinking in LangGraph](https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph)：从业务步骤设计状态与节点。
- [Interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)：中断、Command、恢复及副作用边界。
- [Persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)：checkpointer 与 store；内存保存器不能跨进程恢复。

资料核对日期：2026-11-01。实现时以锁定依赖版本对应的文档和验证结果为准。
