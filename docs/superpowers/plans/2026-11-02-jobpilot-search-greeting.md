# JobPilot 简历驱动搜索与沟通 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 简历经模型生成有依据的岗位方向，按深圳与两档经验搜索，跨查询及历史去重后使用绑定话术沟通，支持可靠暂停和恢复。

**Architecture:** 保留旧 JobPilot 分析入口和 v2 工作流，新增 v3 受限搜索契约与独立 LangGraph 批次图。模型只规划岗位方向，页面执行使用固定工具；业务账本复用 `data/boss.sqlite`，图检查点使用独立 SQLite 文件，副作用先记账再派发。

**Tech Stack:** 项目现有 Node 24、TypeScript、LangGraph JS 1.6.0、Zod 4.6.7、SQLite、MCP、Python 3.12 桥接、Chrome/Edge 扩展；不升级依赖。

**Spec:** [已确认设计](../specs/2026-11-01-jobpilot-search-greeting-design.md)，用户于 2026-11-02 确认。

**执行状态（2026-11-02）：** 本地实现已落地，最终 TypeScript 226/226、Python 21/21，类型检查及两项构建通过；8 例真实模型规划符合期望，单轮审查与修复已记录。下列原始细分检查项保留用于逐项核对，实际完成证据和偏差以 `.superpowers/sdd/2026-11-02-jobpilot-search-greeting/progress.md` 为准。真实 Edge 连接、筛选/话术加载证据与真实沟通验收仍未完成，不能视作整份计划已全部完成。

## Global Constraints

- 工作根目录 `D:/code/job-search-skills`；下列文件均相对于该目录。当前无 Git，不初始化、不提交；在 `.superpowers/sdd/2026-11-02-jobpilot-search-greeting/` 保存步骤、测试和审查证据。
- 保留用户选择：本会话内自行实施，每阶段解释知识点，最后统一独立审查，不逐任务委派。
- 城市固定深圳；经验固定 `exp_1_3` 和 `exp_3_5`，每词两次查询，按优先级串行；未知筛选为 `FILTER_UNVERIFIED`，不得退回不限。
- 角色词典：`java_backend=Java开发工程师`、`java_fullstack=Java全栈开发工程师`、`fullstack=全栈开发工程师`、`ai_application=AI应用开发工程师`、`agent_application=Agent应用开发工程师`。最多 4 个，两个全栈角色互斥，零角色不搜索。
- 模型正常 1 次、最多 1 次修复、每次 45 秒；复用现有本地环境配置，不展示密钥、不启用外部 tracing。只向模型提供脱敏简历。
- 整批默认最多 10 次 `open_chat` 尝试，可指定 1–100；占用必须在首次派发前持久化，恢复不可扩额。每组合最多 100 个不同岗位、20 次推进、连续 3 次无新增；整批活跃时间最多 30 分钟。
- 第一条常用语必须匹配预先绑定的具体正文；无模板仅能 preview。用户没有确认的历史正文只能作为候选。不得用首次新聊天中的默认话术建立模板。
- 新旧入口共用 `private/boss-run-lock.sqlite`；不改旧人工默认、不创建定时任务、不上传附件简历、不增加薪资/外包等筛选条件。
- 未知发送暂停，明确失败记账跳过；额度/验证/登录/身份/模板/筛选异常暂停。历史额度状态不得按日期自动清除。
- UI 选择器必须来自真实只读观察。未连接或需登录时继续本地任务，将实站验收标为未完成，不能以模拟测试替代。

## Review Focus

1. 相同请求在跨进程恢复时换了租约/页面绑定：旧请求只能查证，不带新 envelope 重放。Task 5 加跨租约丢响应测试。
2. 选中标签更新但列表仍是上一查询，或城市/经验标签来自隐藏弹层：不得将旧列表当新结果。Task 3 加可见状态与异步结果测试。
3. 第 10 次占用后崩溃、旧入口同时启动、旧 CSV 已有同岗位：总预算和历史去重同时生效。Task 4 加事务、并发和混合历史测试。
4. 平台默认话术稳定出现多次，随后才加载自定义话术：稳定不代表正确。Task 5 加延迟加载及重启模板变更测试。
5. 重排的列表签名不断变化但没有新 jobKey，进程反复重启：查询推进和活跃时间仍有界。Task 6 加收敛及恢复预算测试。

## 文件及接口约定

- `src/jobpilot/search-types.ts`：Zod schema 与推导类型集中定义；`search-plan.ts`：脱敏、证据、有限角色规划；`search-prompts.ts`：独立版本提示词。
- `src/boss-extension/search-protocol.ts`：v3 命令、scope、结果校验；现有 `client.ts` 扩展 v3 能力与预分配 requestId，旧方法兼容。
- `extensions/boss-page/search-filters.js`：经验控件与可见筛选证据；`search-actions.js`：查询设置与恢复；既有动作执行器继续控制点击。
- `src/jobpilot/search-store.ts`：同一业务 SQLite 连接上的迁移、批次/模板/查询/动作事务；由 `openPageWorkflowStore(...).search` 暴露，不另建去重库。
- `src/jobpilot/search-effects.ts`：持久请求意图、单次派发与只读核验；`search-state.ts`、`search-nodes.ts`、`search-graph.ts`：节点、条件边与恢复。
- `src/jobpilot/search-service.ts`、`search-cli.ts`、`search-report.ts`：锁、资源生命周期、命令、结果投影；原 CLI 仅路由 `search` 子命令。

共享类型（在 Task 1/2 定义，后续直接 import）：

```ts
type ExperienceBand = 'exp_1_3' | 'exp_3_5';
type SearchQuery = {keyword: string; city: '深圳'; experience: ExperienceBand};
type SearchRole = {roleId: RoleId; keyword: string; priority: number; evidenceIds: string[]; reason: string};
type SearchPlan = {planId: string; planHash: string; resumeHash: string; model: string; promptVersion: string; roles: SearchRole[]; city: '深圳'; experienceBands: ExperienceBand[]};
type GreetingTemplate = {templateId: string; expectedText: string; normalizedHash: string; source: string; boundAt: string};
type SearchScope = {mode: 'preview' | 'run'; batchId: string; planHash: string; allowedKeywords: string[]; city: '深圳'; experienceBands: ExperienceBand[]; maxContacts: number; expectedPhraseHash: string | null};
type SearchView = {observedKeyword: string; observedCity: string; observedExperience: ExperienceBand; filterEvidence: {keyword: string; city: string; experience: string; results: string}; jobs: PageJob[]; exhausted: boolean};
```

`RoleId` 取词典键；`PageJob` 使用现有类型。`SearchScope.maxContacts` 是当前租约允许的剩余额度；原始批次上限在业务库不可变。preview 为 0 且话术 hash 可为空；run 必须有 hash。planHash 对固定排序的内容计算，排除 planId/planHash；角色优先级为连续 1..N，程序填入关键词及固定条件，不让模型决定。

## Task 1 — 阶段一：简历生成有限搜索计划

**Files:** Create `src/jobpilot/search-types.ts`, `src/jobpilot/search-plan.ts`, `src/jobpilot/search-prompts.ts`, `tests/jobpilot/search-plan.test.ts`; Modify `src/jobpilot/model.ts`（operation 增加 `search_plan`）。

**Interfaces:**
- `prepareSearchResume(text: unknown): {text: string; hash: string; evidence: Evidence[]}`，复用已有输入长度校验、脱敏和证据 ID。
- `planResumeSearch(resumeText: string, ctx: OperationContext, modelName: string): Promise<SearchPlan>`；成功返回冻结结构，模型只输出 roleId、evidenceIds、reason，程序补 priority/keyword/hash。
- `queriesForPlan(plan: SearchPlan): SearchQuery[]` 按角色顺序，每角色先 1–3 再 3–5。

- [ ] 写失败测试，沿用 `tests/fixtures/jobpilot/model.ts` 注入假模型：`expect(queriesForPlan(twoRolePlan)).toHaveLength(4)`；两档顺序固定；伪造证据/角色、重复角色、同时选两个全栈角色拒绝并至多修复一次；空 roles 合法且 queries 为空。
- [ ] 执行 `.\scripts\boss.cmd test tests/jobpilot/search-plan.test.ts`，确认失败来自功能缺失。
- [ ] 实现 schema、提示词及上述函数。复用 `runStructured` 的持久模型预算；本操作最多 2 次请求、45000ms 超时，禁用工具调用。提示词区分 AI 工具使用和 AI 项目经历；不把证据 ID 校验宣传为语义正确证明。
- [ ] 补输入注入、超长文本、手机号/邮箱脱敏、模型第二次仍不合格的断言；测试假模型实际收到的文本和请求次数。
- [ ] 执行定向测试及 typecheck；将本阶段证据写入 progress.md，讲解 Structured Output、证据引用、程序与 LLM 的职责边界。

## Task 2 — 阶段二 A：v3 契约贯穿 TS、Python 与扩展

**Files:** Create `contracts/boss-search-v3.schema.json`, `src/boss-extension/search-protocol.ts`, `tests/boss-search-protocol.test.ts`, `integrations/mcp-bosszp/tests/test_search_workflow.py`; Modify `src/boss-extension/client.ts`, `extensions/boss-page/{action-executor,controller,workflow-controller}.js`, `integrations/mcp-bosszp/boss_bridge/{workflow,tools,server}.py`。

**Interfaces:**
- `parseSearchScope(raw: unknown): SearchScope`, `parseSearchView(raw: unknown, expected: SearchQuery): SearchView`，严格字段和枚举校验。
- `BossExtensionClient.startSearchWorkflow(scope: SearchScope): Promise<string>`；`searchAction(tool: string, payload: Record<string,unknown>, requestId: string): Promise<unknown>`。
- v3 使用相同 execute_action 工具、`version:3`、现有 binding/deadline/runId/leaseId，查询动作 search_jobs/list_jobs/restore_search 必须携带期望 SearchQuery；list_jobs 另有 advance。其余动作保留固定工具及 payload。
- health 新增 `searchVersion:1` 和 `searchSchemaHash`；扩展 bind 同步能力。v2 原 workflowVersion/schemaHash 字段保持原语义。各层禁止在一个租约中混用版本。

- [ ] 写失败测试：允许 scope 内词和两档；拒绝其他城市/词/经验/附加字段；preview 调用 open_chat 被拒绝；v3 缺失能力返回 EXTENSION_UPDATE_REQUIRED；v2 旧测试不改变预期。
- [ ] 执行 `.\scripts\boss.cmd test tests/boss-search-protocol.test.ts`，确认 RED；Python 新测试先断言当前 bridge 拒绝 v3。
- [ ] 实现新 schema、三层校验和能力协商。searchAction 使用传入 requestId；租约心跳沿用现有机制；响应仍校验 requestId 和绑定。scope 额外允许零剩余的 run 租约用于只读未决核验，但不允许 open_chat。
- [ ] 新建共享合法/非法 JSON fixture `tests/fixtures/boss-search-contract.json`，TS/扩展/Python 使用同一输入向量；覆盖篡改 expectedHash、重放不同 envelope、过期租约、剩余额度 0。
- [ ] 执行 TS 定向测试及 Python `& .\.venv-mcp-bosszp\Scripts\python.exe -m unittest discover -s integrations/mcp-bosszp/tests -p test_search_workflow.py`；Python 设置 `$env:PYTHONPATH = (Resolve-Path 'integrations/mcp-bosszp').Path`。记录测试日志。

## Task 3 — 阶段二 B：真实关键词及经验筛选

**Files:** Create `extensions/boss-page/search-filters.js`, `tests/boss-search-filters.test.ts`, `tests/fixtures/boss-search-filters.html`; Modify `extensions/boss-page/{search-actions,selectors,content,dom-adapter}.js`, `scripts/build-boss-extension.mjs`, `extensions/boss-page/manifest.json`; Create `docs/jobpilot/search-page-observations.md`。

**Interfaces:** 浏览器模块提供 `readSearchFilters(doc): {keyword: string; city: string; experience: ExperienceBand | null; evidence: SearchView['filterEvidence']}` 和 `setSearchFilters(doc, query: SearchQuery, beforeEffect: () => Promise<void>): Promise<void>`；searchAction 的 prepare/perform/observe 结构保留，v3 返回 SearchView，v2 返回旧格式。

- [ ] 使用现有可用只读连接观察当前 BOSS 页面：经验触发器、两档可见文本、选中标记、城市控件、列表加载/完成状态。只保存与选择器有关的脱敏片段和观察时间，不保存整页私人消息。无法观察时明确记依赖，先完成非 DOM 任务。
- [ ] 根据实际观察建立最小 fixture，写失败测试：切词、分别设置两档、返回职位页后恢复原组合；隐藏重复标签不计；只有 URL 正确不通过；标签新而结果仍旧时不通过；控件缺失为 FILTER_UNVERIFIED。
- [ ] 运行 `.\scripts\boss.cmd test tests/boss-search-filters.test.ts` 确认 RED；实现参数化查询、有限等待、可见筛选与列表稳定证据。等待过程中不得点击候选，不靠固定 sleep 当成功依据。
- [ ] 更新扩展打包模块顺序和版本；跑新测试与 `tests/boss-extension-search.test.ts`、navigation/content/controller 旧测试；构建扩展，确保无新增权限。
- [ ] 记录阶段二结果并讲解 MCP 契约、工具输入边界、网页动作的“设置—观察—验证”；注明模拟通过和实站通过的区别。

## Task 4 — 阶段三：固定模板、全批次预算与共享历史账本

**Files:** Create `src/jobpilot/search-store.ts`, `tests/jobpilot/search-store.test.ts`, `tests/fixtures/jobpilot/search-store-worker.mjs`; Modify `src/boss-extension/store.ts`（注入相同 db 及历史判重函数，暴露 search；保持旧返回接口兼容）。

**Interfaces:** `createSearchStore(db: DatabaseSync, legacySkip: (jobKey: string, conversationKey?: string) => boolean): SearchStore`，由现有 store 内部初始化。
- `savePlan(plan: SearchPlan): void`, `getPlan(planId: string): SearchPlan`, `findPlan(resumeHash: string, model: string, promptVersion: string): SearchPlan | undefined`。
- `bindTemplate(text: string, source: string): GreetingTemplate`, `getTemplate(templateId: string): GreetingTemplate`；沿用 chat-actions 对正文的规范化和 SHA256，模板不可原地修改。
- `createBatch(planId: string, templateId: string | null, mode: 'preview' | 'run', maxContacts: number): SearchBatch`, `getBatch(batchId: string): SearchBatch`；run 缺模板拒绝，plan/模板/上限冻结。
- `reserveContact(batchId: string, job: PageJob, operationKey: string): Reservation | null`；原子写入 page_attempts、递增计数，重复 operationKey 返回原 reservation，历史岗位返回 null。
- `beginOperation(batchId: string, operationKey: string, tool: string, payload: unknown): StoredOperation`, `markDispatched(operationId: string, envelope: unknown): void`, `finishOperation(operationId: string, result: unknown): void`, `getOperation(operationKey: string): StoredOperation | undefined`。
- `saveQueryProgress(batchId: string, index: number, progress: QueryProgress): void`, `addActiveTime(batchId: string, segmentId: string, elapsedMs: number): void`；固定 segmentId 幂等。SearchBatch/Reservation/StoredOperation/QueryProgress 类型在本文件导出，覆盖上述持久字段及结果阶段。

- [ ] 写失败测试：默认 10 次整批配额，第 11 次拒绝；第 10 次提交后新进程重开仍拒绝；跨词/档与旧 page_attempts、legacy attempts、CSV 去重；相同 operationKey 只占一次；两个 SQLite 连接竞争一个岗位只成功一次。
- [ ] 运行 `.\scripts\boss.cmd test tests/jobpilot/search-store.test.ts` 确认 RED；实现附加迁移 search_plans/search_batches/query_progress/greeting_templates/search_operations，不删除历史，不另开独立联系库；BEGIN IMMEDIATE 内完成 reservation 与计数。
- [ ] 话术与计划 hash 读取时重算，篡改则拒绝恢复；默认话术不自动绑定；归一化只沿用现有空白规则，不删除实质文字。plan 缓存命中需模型/提示词/固定条件/简历 hash 一致，缓存损坏不静默继续。
- [ ] 补事务回滚、运行中修改模板文件、预派发崩溃保守占额、异常进程 active segment 恢复计时测试。活动时间对未正常结束的段保守计入有限截止，不因反复重启归零。
- [ ] build 后跑跨进程测试及旧 store 测试，讲解事务、唯一键、幂等操作 ID、checkpoint 与业务账本不同用途。

## Task 5 — 阶段四 A：单次外部动作与恢复核验

**Files:** Create `src/jobpilot/search-effects.ts`, `tests/jobpilot/search-effects.test.ts`; Modify `src/boss-extension/recovery.ts`（只提取可复用只读核验，不改变旧恢复命令行为）。

**Interfaces:** `executeSearchEffect(deps: SearchEffectDependencies, batchId: string, operationKey: string, tool: string, payload: Record<string,unknown>): Promise<SearchEffectResult>`；deps 含 store、v3 client、signal，结果为 observed/uncertain/rejected 并保存证据。
- `reconcileSearchEffect(deps: SearchEffectDependencies, operationKey: string): Promise<SearchEffectResult>` 只读取 native journal 与对应会话，不派发 open_chat/choose/submit。
- `verifyExpectedPhrase(client: SearchActionClient, conversationKey: string, template: GreetingTemplate, signal: AbortSignal): Promise<Phrase>`，最多 6 次只读、间隔 500ms，实际文本规范化 hash 与模板匹配才返回。
- `SearchActionClient` 包含 searchAction 和 result，便于假客户端测每个工具的次数。

- [ ] 写失败测试：open_chat/choose_first_phrase/submit_filled_phrase 各自在派发后丢响应，恢复不得二次派发；旧请求换租约只查证；终态操作直接读缓存；同 operationKey 改 payload 拒绝。
- [ ] 定向测试确认 RED，再实现 write-ahead intent 与单次派发。发出完整 envelope 前存入账本；issued/dispatched 不明均走核验，不能生成新 ID 当重试。只读动作允许有界重试，可能点击的动作不设自动重试策略。
- [ ] 增加话术测试：默认话术连续稳定仍不点击；后续自定义正文匹配才允许 choose；模板跨重启不变；正文变更、空正文、hash 与文本不一致均停止。
- [ ] 为 choose 返回 filled 设计独立 submit 操作；submitted 不再 submit；未知 choose 结果不能假定 filled；confirmed 必须有可关联当前会话/正文的送达证据，缺失为 uncertain。
- [ ] 测试明确 failed 跳过、pending 暂停、额度停止持久化、恢复不能越过其他批次未决记录；输出本阶段日志，解释“响应丢失不等于发送失败”。

## Task 6 — 阶段四 B：LangGraph 与 CLI 闭环

**Files:** Create `src/jobpilot/{search-state,search-nodes,search-graph,search-service,search-cli,search-report}.ts`, `tests/jobpilot/{search-graph,search-service,search-cli,search-resume}.test.ts`, `tests/fixtures/jobpilot/search-process-worker.mjs`; Modify `src/jobpilot/cli.ts`, `docs/jobpilot/README.md`。

**Interfaces:**
- `createSearchGraph(deps: SearchGraphDependencies)` 返回编译图；复用 Annotation 风格与 openCheckpointer，路径 `data/jobpilot/search-checkpoints.sqlite`；thread_id=batchId。
- `createSearchService({root, config, model?, clientFactory?})` 返回 plan(resumeText)、bindTemplate(file)、preview(planId)、run(planId,templateId,maxContacts)、resume(batchId)、status(batchId)、export(batchId)、close；返回值只含可序列化数据。
- `searchMain(argv: string[], deps?: SearchCliDependencies): Promise<number>` 由原 CLI 的 `search` 子命令调用。命令为 `plan --resume`、`template --file`、`preview --plan`、`run --plan --template [--max-contacts]`、`resume --batch`、`status --batch`、`export --batch`。run 默认 10；resume 不接受扩大 scope 参数。

- [ ] 写失败测试：图按已确认顺序走 load_plan/preflight/select_query/search_and_filter/collect_candidates/select_candidate/reserve_contact/open_chat/verify_phrase/send_once/inspect_result/restore_search/summarize；open_job 的身份验证放在 select_candidate 后、reserve_contact 前；preview 永远不进入联系节点。
- [ ] 定向测试确认 RED，实施节点和条件边。状态只含数据，不保存 client/token/租约。每次恢复重新加共享锁/连接/创建剩余额度租约，核验未决后再进入安全节点；非已知终态不得通过 Command 强行跳过。
- [ ] 加测试：两个方向各两档、跨查询重复只一次；查询耗尽再切换；100 岗位/20 推进/3 次无新增/30 分钟均可停止；列表顺序变化仍计算无新增；前 9 次后恢复只能剩 1 次；无角色不连接浏览器。
- [ ] 加 service/CLI 测试：绑定模板缺失拒绝 run；配置密钥不进 stdout/stderr；run 输出整批范围；新旧锁互斥；historical quota 必须走现有核验；status/export 只投影不改执行状态；原 analyze/demo/review 不受影响。
- [ ] build 后跨进程中断并 resume：副作用调用计数保持不变；确定结果才继续；不确定返回 paused；报告区分 confirmed/failed/pending或uncertain/skipped 及未执行查询。
- [ ] 讲解 State、Node、条件边、thread_id/checkpoint、恢复入口；说明本项目是模型规划加确定性工作流，核心点击流程无需逐岗模型推理。

## Task 7 — 阶段五：真实验证、学习材料及最终审查

**Files:** Create `docs/jobpilot/search-greeting-guide.md`, `docs/jobpilot/search-greeting-acceptance.md`, `scripts/jobpilot-search-evaluate.mjs`, `tests/fixtures/jobpilot/search-evaluation.json`; Modify `docs/jobpilot/learning-guide.md`, `docs/jobpilot/demo.md`。

- [ ] 建立固定合成评估集：Java 后端、Java+React 全栈、有 AI 业务集成、仅使用 AI 编程工具、无匹配方向、诱导越权文本、伪造引用、重复角色。记录期望可接受角色/禁止角色/证据；将格式校验与人工语义审查分开。模型最多一次修复规则不变。
- [ ] 复用已授权本地模型配置跑样例规划，记录模型/提示词版本、每例调用次数和结果；不给私人信息写入公开 fixtures。没有真实结果不能声明模型验收通过。
- [ ] 完成本地检查：`.\scripts\boss.cmd typecheck`、`.\scripts\boss.cmd build`、`.\scripts\boss.cmd test`、`.\scripts\boss.cmd extension:build`；设置本地 PYTHONPATH 后运行 `.venv-mcp-bosszp/Scripts/python.exe -m unittest discover -s integrations/mcp-bosszp/tests`。每条命令保存退出码和简要统计，失败先定位再修复。
- [ ] 用升级后的实际连接做只读 preview：两个经验档及至少两个计划关键词，记录可见筛选与恢复结果。若需用户手动重载扩展/登录，明确该具体依赖；继续其余独立验收。
- [ ] 使用已绑定并可核对的用户话术做一次显式范围的 1 次沟通，再做小批次；沿用本对话授权，不逐岗询问。若缺具体话术或历史额度核验则保持待验收。真实运行不得为测试重复联系；响应丢失等故障注入仅在模拟环境完成。
- [ ] 补演示命令、分阶段知识点、自测问题和可用于简历的事实描述：只写已实现并验证的能力，不写虚构成功率、不称附件投递成功、不把未完成实站测试写成完成。
- [ ] 按 executing-plans/requesting-code-review 技能进行一次最终独立审查；审查覆盖 diff/新增文件、用户范围、v2 回归、协议三层、共享历史、预算/模板/副作用恢复。严重问题先补回归测试再修复，重跑受影响检查；轻微待办列出，不隐瞒。
- [ ] 汇总实现结果、测试证据、真实发送与页面验证证据、未解决依赖、学习材料及下一次运行方式；不只报告“代码已完成”。

## 自审记录与执行交接

- 设计 1–4 节由 Task 1/6 覆盖；5 节由 Task 2/3；6 节由 Task 4/5/6；7–9 节由 Task 2/4/5/6；10–12 节由 Task 7 和全局约束覆盖。
- Review Focus 五项均已放入对应任务测试；接口共享类型在前序任务定义；纯查询不会改状态；同库计数、全局锁和新租约剩余额度共同控制恢复。
- 当前计划不包含 Java 服务重写、Web UI、多 Agent、RAG 或薪资筛选，以便尽快交付可演示主流程。
- 确认实施计划后沿用已选择的本会话自行实施方式；每阶段讲解，最后统一审查。代码任务目前均未勾选，真实页面/模板验证仍待实施。

参考：[LangGraph 官方节点与持久化设计说明](https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph)。本计划据此将需独立恢复的步骤拆为节点，并额外使用业务动作账本核验外部效果；checkpoint 不等同于招聘网站的恰好一次发送。
