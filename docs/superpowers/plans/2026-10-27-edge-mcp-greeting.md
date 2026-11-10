# Edge MCP 常用语招呼接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有 TypeScript＋SQLite 求职程序接入当前 Edge 的 Playwright MCP 扩展，完成可核验、可停止、不会自动补发的常用语招呼流程。

**Architecture:** 保留 runner/greeting/store，新增本地 stdio MCP 客户端和 McpBossPages 适配器。连接、只读准备、单次写操作、结果核验分开；SQLite 保存意图、结果和独立额度停止记录。生产入口只连接现有 Edge，旧 DOM 浏览器实现仅用于本地回归。

**Tech Stack:** Node 24、TypeScript 7.0.2、node:sqlite、@playwright/mcp 0.0.83、现有 Playwright 1.64.1、Vitest 5.0.5；新增官方 @modelcontextprotocol/sdk 1.25.2（安装后以协议集成测试验证兼容性）。

**Spec:** [已确认设计](D:/code/job-search-skills/docs/superpowers/specs/2026-10-27-edge-mcp-greeting-design.md)

## Global Constraints

- 工作目录 D:/code/job-search-skills；不是 Git 仓库，不初始化 Git、不创建工作树；每任务完成后更新本地 ledger，代替提交。
- “不用独立浏览器，不迁移登录凭据，不引入 LangChain、LangGraph、Python Agent、Docker 或多模态模型。核心无需模型 Key。”
- “第一版不自动回复、发送附件、交换联系方式、切换账号或创建定时任务。”
- private/profile.json 的 manual_only 保持；开发和只读验收可执行，真实单岗位或批量发送需要当次具体授权，不复用被新约定覆盖的旧授权。
- “截图仅异常或验收必要时本地保存，按匿名账号/任务隔离，单任务最多 20 张，保留最近 10 个任务的本程序诊断文件。”
- MCP 参数固定 --extension --browser msedge --no-webmcp --image-responses omit；用户选择实际 Edge profile 后绑定，不猜测 Default/Profile 1。无扩展连接时禁止回退专用浏览器。
- 无发送/开聊自动重试；读取最多重试 2 次，单动作超时 15000 ms，无新增扫描最多 3 次，连续读取错误最多 3 次，岗位间隔默认 5000 ms，沿用现有配置。
- 额度按账号独立保存，collect/跨日期不得清除；显式 --resume 也必须完成只读阻断检查，不承诺额度恢复。
- 所有新增命令使用 scripts/boss.cmd，避免 PowerShell 执行策略和系统 Node 16；不修改全局配置、用户简历和既有 CSV。

## Review Focus

1. 多个 Edge profile、同域同标题标签页和标签页顺序变化：身份不明零发送，不能只缓存标签索引（Task 3、4）。
2. 模板含反引号、引号、换行、Unicode 或看似指令的文字：原文作为数据，无代码执行/内容改写（Task 1、4）。
3. Ctrl+C 或 MCP 断连恰好发生在开聊/提交期间：不发下一请求、不重试，保留待核验意图（Task 4、5）。
4. 升级时已有数据库、损坏运行锁或无法归属账号的旧额度记录：保留记录，拒绝误清除和并行写入（Task 2）。
5. 已有搜索结果、异步列表更新、零结果及同会话多职位：当前查询验证和跨职位会话去重有效（Task 3、5）。

---

## 当前代码与文件责任

已存在：src/cli.ts、runner.ts、greeting.ts、domain.ts、config.ts、run-lock.ts、diagnostics.ts；src/storage/{schema,store,history}.ts；src/browser/{session,boss-pages,selectors}.ts。旧 CLI 仍调用 launchBossPages，finally 关闭浏览器；实站不得使用该入口，直到 Task 6 切换完成。

新增文件及边界：

| 文件 | 职责 |
|---|---|
| src/mcp/client.ts | SDK stdio 生命周期、工具能力检查、超时与错误；不处理岗位业务 |
| src/mcp/result.ts | 解码固定版本工具结果，拒绝歧义和错误响应 |
| src/browser/mcp-boss-pages.ts | 实现 BossPages，持有本轮账号/标签页/会话绑定 |
| src/browser/mcp-scripts.ts | 固定的页面读取和单动作脚本；不接受任意脚本配置 |
| src/browser/edge-binding.ts | profile、标签页、稳定账号证据的本地绑定与校验 |
| src/storage/migrations.ts | 版本化迁移、独立额度表及平台默认招呼事件 |
| src/authorization.ts | 本轮发送范围校验；不修改 profile 默认模式 |
| tests/mcp-client.test.ts、mcp-pages.test.ts、diagnostics.test.ts、authorization.test.ts | 新模块的行为测试 |
| tests/fixtures/mcp-server.mjs、lock-worker.mjs | 可控协议服务与真实多进程互斥测试入口 |
| docs/edge-mcp-acceptance.md | 实站证据清单及已验证/未验证结论，不存私人聊天正文 |

路径均相对工作目录；现有 browser/selectors.ts 里的 fixture 属性不是实站证据。必要时增加 src/browser/mcp-selectors.ts，把真实适配与 fixture 清楚分开。

## 执行命令和检查口径

在 PowerShell 的项目根目录执行：

```powershell
.\scripts\boss.cmd test tests/mcp-client.test.ts
.\scripts\boss.cmd typecheck
.\scripts\boss.cmd build
```

定向测试替换文件名。每个任务：写有行为断言的测试 → 看到预期失败 → 实现 → 测试通过 → typecheck → ledger 记录。不要仅用导入失败作为业务行为验证。只在任务间接口改变时扩展相关回归；最终全套只运行一遍，除非出现失败或后续改动。

### Task 1: 可控的 MCP 客户端

**Files:** Create src/mcp/client.ts、src/mcp/result.ts、tests/mcp-client.test.ts、tests/fixtures/mcp-server.mjs；Modify package.json、package-lock.json、config/playwright-edge.mcp.json、scripts/check-edge-mcp.mjs。

**Interfaces:**

```ts
type McpOptions = { root:string; profileDirName?:string; timeoutMs:number };
interface McpPort {
  tools(): Promise<Array<{name:string;inputSchema:Record<string,unknown>}>>;
  call(name:string,args:Record<string,unknown>,signal:AbortSignal):Promise<unknown>;
  close():Promise<void>;
}
connectMcp(options:McpOptions, signal:AbortSignal):Promise<McpPort>;
decodeToolResult(raw:unknown):unknown;
```

- [ ] **1. 写失败测试。** 可控 stdio 服务按 SDK 格式响应 initialize/list/call，能返回 isError、畸形内容、延迟响应和主动断连。测试断言：

```ts
expect(server.callsAfterAbort).toHaveLength(0);
expect(server.callCountForTimedOutWrite).toBe(1);
expect(server.receivedToolNames).not.toContain('browser_close');
expect(server.receivedToolNames).not.toContain('browser_tabs:close');
```

每个属性由测试 fixture 捕获实际请求产生，不能是常量。补充工具缺失、未知工具、错误结果、混入快照的结果块不能假装业务成功；同一 close 调两次不出错，断连后 call 拒绝。

- [ ] **2. 运行 tests/mcp-client.test.ts，确认客户端尚缺失或行为不满足，然后保留业务断言。**
- [ ] **3. 新增固定版本 SDK 依赖并实现接口。** 使用官方 Client/StdioClientTransport；绝对路径通过 process.execPath 与项目 root 构造，Windows 子进程隐藏窗口，stdio 不写无关日志。SDK 若不能满足隐藏窗口要求，用其 Transport 接口封装 windowsHide:true 的自有子进程，不修改全局 MCP 配置。启动参数不得带 --caps vision 或 --headless。
- [ ] **4. 核对实际 tools/list。** 本地 0.0.83 README 声明代码工具为 browser_run_code_unsafe，参数 code 或 filename；不能使用猜测的 browser_run_code。保存脱敏能力契约 fixture；至少校验 browser_snapshot、browser_tabs 和代码工具的所需参数结构。工具不兼容时报明确错误，无 fallback。只允许适配器使用的固定工具集合，禁止上传文件、关闭窗口和页面注册工具。
- [ ] **5. 实现结果解码。** 对固定版本实际返回的 structuredContent/文本结果做明确解析；拒绝 isError、多份冲突结果、无预期结构。固定脚本返回带 schemaVersion:1 的业务 JSON，运行时验证所需字段；快照正文不当作 JSON 成功结果。
- [ ] **6. 测试和 typecheck 通过；运行现有零浏览器操作握手脚本。** ledger 记录仅验证协议，未连接 Edge；close 只关闭本程序客户端和子进程，不发送 browser_close。

### Task 2: 独立额度状态、迁移与可靠互斥

**Files:** Modify src/storage/schema.ts、store.ts、src/run-lock.ts、tests/store.test.ts、tests/lock.test.ts；Create src/storage/migrations.ts、tests/fixtures/lock-worker.mjs。

**Interfaces:** 保留 Store 原方法，新增：

```ts
type QuotaLatch = {accountKey:string;reason:'quota'|'legacy_unverified';evidence:Evidence;createdAt:string};
Store.latchQuota(accountKey:string, reason:QuotaLatch['reason'], evidence:Evidence):void;
Store.getQuota(accountKey:string):QuotaLatch|undefined;
Store.releaseQuota(accountKey:string, evidence:Evidence):void;
Store.recordEvent(accountKey:string, attemptId:string|undefined,
  kind:'platform_greeting'|'resume_requested', evidence:Evidence):void;
Store.pendingCount(accountKey:string):number;
acquireRunLock(file:string):Promise<()=>Promise<void>>; // 签名保留，后端更换
```

- [ ] **1. 写额度回归测试。** 明确执行 send 到 quota → collect 到 exhausted → 再次 send；还测 runId 创建前发现 quota。数据库重开、跨日和另一账号均纳入，断言原账号 latch 仍在、另一账号不被错误解除/污染。旧模板、attempts、CSV 文件字节保持原样。
- [ ] **2. 写多进程互斥测试。** 两个子进程同时尝试同一锁，断言只有一个获得；杀死持锁测试进程后下一次可获得；释放旧进程不得解除新锁。升级遇旧 JSON 锁时保留文件并拒绝不确定情况，不能直接删除。
- [ ] **3. 运行 store/lock 测试，确认旧实现暴露缺陷。**
- [ ] **4. 实现迁移和额度表。** 使用 PRAGMA user_version 的事务迁移，新增 account_stops（accountKey 主键）、attempt_events（追加事件）；保留所有旧表记录。旧数据库无版本先识别现有表；未来不支持版本拒绝启动。迁移失败回滚，写入前用 SQLite backup API 保存一致的本地备份，不复制正在写的 WAL 主文件代替备份。
- [ ] **5. 用独立 SQLite 锁库实现互斥。** 新文件 private/boss-run-lock.sqlite；专用 DatabaseSync 连接设 busy_timeout=0，持有 BEGIN IMMEDIATE 到 release，释放 ROLLBACK+close，幂等。业务 data/boss.sqlite 是另一个文件，不长期锁住业务事务；OS 释放进程句柄实现崩溃恢复，不 unlink 锁库。已有 private/boss-run.lock 如有活动/未知持有者则拒绝，证明旧持有者不存在后可忽略但不删除；迁移时提示关闭旧程序，后续生产入口统一新锁。
- [ ] **6. store/lock 定向测试和 typecheck 通过，ledger 记录迁移版本及旧数据保护结果。**

### Task 3: 当前 Edge 绑定及只读页面适配

**Files:** Create src/browser/edge-binding.ts、mcp-boss-pages.ts、mcp-scripts.ts、mcp-selectors.ts、tests/mcp-pages.test.ts；Modify src/domain.ts、config.ts、tests/config.test.ts、tests/fixtures/pages.ts。

**Interfaces:**

```ts
type EdgeBinding = {profileDirName:string;accountKey:string;displayName:string;identityEvidence:Evidence};
type EdgeConnection = {kind:'extension';profileDirName?:string;preferredUrl?:string};
type PageOptions = {connection:EdgeConnection;binding?:EdgeBinding;
  signal:AbortSignal;timeoutMs:number;allowedOrigin:string};
class McpBossPages implements BossPages {
  constructor(port:McpPort, options:PageOptions);
  // 完整实现已有 BossPages 签名；close() 仅断开 MCP
}
loadBinding(root:string,profileDirName:string):EdgeBinding|undefined;
saveBinding(root:string,binding:EdgeBinding):void;
```

RunConfig 新增 connection:EdgeConnection，默认仅 {kind:'extension'}，以便 status 和离线测试不依赖浏览器配置。browserDir 字段暂保留为 deprecated 供旧测试编译，生产不再使用，也不迁移其目录。连接前必须从 --profile 或唯一已核实绑定取得实际 profileDirName；缺失/歧义时给出选择提示，不默认连接最近使用的 profile。

- [ ] **1. 编写只读契约测试。** fake McpPort 驱动列表和聊天状态，同时用 localhost 页面 fixture 执行固定脚本，不能只 mock 掉所有选择器。至少断言：标签顺序改变仍选对目标；同 URL 多标签且无法区分时报错；账号不可确认/变更拒绝操作；只有岗位页时可以通过已有聊天入口准备常用语且没有开聊点击；多会话不凭焦点挑一个。
- [ ] **2. 写搜索回归测试。** 旧卡片立即可见、新列表延迟、两个关键词返回相同岗位、显式零结果分别测试。断言 visibleJobs 只返回当前已完成查询的数据；相同结果不能一直等待“卡片必须变化”；零结果返回 []。测试导航到外域后无进一步读取/写入。
- [ ] **3. 运行 tests/mcp-pages.test.ts，确认缺少新适配器和查询关联校验。**
- [ ] **4. 实现绑定和固定读取脚本。** 通过工具列举/选择标签页，索引仅当次有效，选择后重新核对 URL、账号及页面用途。只保存 profile 和账号证据，不保存 cookies/token。生产 origin 固定 https://www.zhipin.com，测试只通过构造参数注入 localhost，不开放任意生产网站配置。此任务尚未实现的写方法显式抛 Stop(layout)，禁止调用旧适配器兜底，Task 4 再替换为真实实现。
- [ ] **5. 以只读方式采集实站定位证据。** 连接扩展需要用户安装/授权时明确列出缺失条件；连接成功后读取列表、已有聊天及常用语结构，确认稳定账号/职位/会话标识来源，更新 mcp-selectors.ts。没有稳定可核对身份则返回 undefined/Stop(identity)，不得复制 fixture 的 data-user-id。用户绑定只确认可验证账号证据，不以确认昵称代替稳定身份。若真实条件缺失，标注该项待验收并继续不依赖它的本地工作。
- [ ] **6. 实现 search/visibleJobs/advanceList/restoreSearch/readInitialTemplate。** 查询完成需要与提交 keyword 关联的实际 UI 状态或浏览器可见请求完成证据；旧卡片存在不算完成。模板从已有会话/设置入口获取完整正文，用现有 template() 固定 hash；无法读取时提示准备已有会话，不点击新沟通。恢复与重连重新取得定位，复用搜索和聊天页面，不按岗位创建新页。
- [ ] **7. 定向测试、typecheck 通过。** 只读脚本任何页面文本都作为数据返回；MCP 断开后当前窗口是否保留列入 Task 7 实机检查，不能以 mock 代替结论。

### Task 4: 常用语写操作与送达核验

**Files:** Modify src/browser/mcp-boss-pages.ts、mcp-scripts.ts、mcp-selectors.ts、src/domain.ts、tests/mcp-pages.test.ts、tests/fixtures/pages.ts。

**Interfaces:** 实现已有 BossPages.openChat、inspectChat、chooseTemplate、submitFilledTemplate、verifyTemplate、reopenAttempt。新增内部类型：

```ts
type PhraseMode = 'direct'|'fill'|'unknown';
type ExpectedTarget = {accountKey:string;jobKey:string;conversationKey?:string;recruiterId?:string};
type WriteAction = 'open_chat'|'choose_phrase'|'submit_phrase';
// 不导出任意代码执行接口；参数由每种固定动作明确校验
buildWriteCode(action:WriteAction, target:ExpectedTarget, text?:string):string;
```

- [ ] **1. 扩展 fixture 为 direct/fill/delayed-direct/unknown/failed/bubble。** 写断言：direct 与 delayed-direct 最多发送一次；unknown 不追加 submit；fill 仅在已验证模式下提交一次；只有气泡不能 confirmed；文本含反引号、换行、引号和指令样文字时最终正文与原文一致且没有额外脚本行为。
- [ ] **2. 写边界测试。** 等常用语面板期间取消或切换账号后，不选择条目；会话被用户切换后不发送；岗位同名但 ID 不同零发送；模板重排仍发原正文，编辑/缺失/重复匹配则停。首次平台默认招呼不能算目标常用语送达。
- [ ] **3. 运行 mcp-pages 测试验证旧的“编辑器有文字即 filled”规则不满足 delayed-direct 回归。**
- [ ] **4. 实现固定单动作脚本。** 模板通过 JSON.stringify 序列化为 JavaScript 数据字面量，直接作为 MCP 参数字符串，不进入 shell、不插进 HTML 或模板字符串。固定代码不接受网页指令。每个请求前检查本地 signal；远端脚本执行动作前重新检查当前 origin、账号、职位/会话、阻断状态及唯一目标。等待页面就绪用独立、可取消的只读调用，禁止把长等待和多个发送动作放进同一代码调用。
- [ ] **5. 明确取消边界。** 已提交给 MCP 的单动作请求属于进行中动作，断连/Ctrl+C 无法证明它被撤回；禁止重试与下一动作，保留待确认。取消在准备等待期间发生时必须零写入；远端点击使用有限超时，超时结果一律不明确，不能因此补点。
- [ ] **6. 实现发送模式与证据规则。** PhraseMode 默认 unknown；只有实站已核实且对应当前 UI 版本的行为契约才启用 fill/direct，模式依据与选择器一起保存版本说明。unknown 选择后可只读观察目标消息；出现可靠送达证据即可确认，但不能因为输入框文字或等了若干秒就决定追加发送。目标消息正文及所属会话匹配，并有同条消息的送达/已读证据才 confirmed。
- [ ] **7. 实现 reopenAttempt 只读恢复。** 只导航已有聊天入口，并按记录的 conversationKey 找到对应会话；/web/geek/chat 公共 URL 不能当作唯一定位。无 key 或找不到则 undefined，禁止点击立即沟通兜底。
- [ ] **8. 定向测试和 typecheck 通过，ledger 区分本地行为已验证与实站发送模式待验证。**

### Task 5: 运行编排、授权与恢复

**Files:** Modify src/runner.ts、greeting.ts、domain.ts、tests/runner.test.ts、tests/greeting.test.ts；Create src/authorization.ts、tests/authorization.test.ts。

**Interfaces:**

```ts
type RunAuthorization = {accountKey:string;city:string;keywords:string[];
  templateHash:string;filtersHash:string;limit:{kind:'jobs';count:number}|{kind:'platform_quota'};issuedAt:string};
assertAuthorized(auth:RunAuthorization|undefined, account:Account,
  config:RunConfig, template:Template, filtersHash:string):void;
```

run 的现有入参增加 authorization?:RunAuthorization；仅 send 必须具备。授权对象由 CLI 展示范围并得到当次明确决定后创建，不从历史 runs/profile 恢复。filtersHash 为可见筛选规范化文本（不含关键词）的 SHA-256，每次 search 返回 filters 后重新校验。状态新增 StopReason 'authorization'，collect 不要求发送授权。

- [ ] **1. 写授权测试。** manual_only 未授权时 openChat/choose/submit 调用数均 0；账号、城市、关键词、模板 hash、筛选 hash 任一不匹配拒绝；maxJobs 与授权 count 一致，platform_quota 不隐含额外任意次数限制。退出后授权不持久化、不复用，profile 文件字节不变。
- [ ] **2. 补真实编排回归。** 用旧数据库模拟 quota→collect→send，检查 latch；runId 前 quota 仍保存；旧 profile 额度首次绑定标为 legacy_unverified，未确认归属前阻止 send。--resume 仅在用户明确恢复且只读检查通过时 releaseQuota，并追加事件；live quota 立即重新 latch。
- [ ] **3. 写恢复/去重测试。** 不同职位同会话只发一次；已存在同模板计 skipped 而非本轮新发成功；崩溃在 opening/sending 时仅恢复已有聊天，无 replay；模板 hash 改变的旧 pending 保留、阻止继续。已有关联消息无法确定来源时不能假装是本轮成功。
- [ ] **4. 运行 runner/greeting/authorization 定向测试看失败。**
- [ ] **5. 更新 runner 和 greeting。** 先识别绑定账号及 quota latch，再准备模板/查询范围并校验授权，之后 reserve → 开聊 → 核验 → 选择常用语 → 可能的一次提交 → 核验。捕获任何 quota（含 runId 前）都独立持久化；账号不可识别时保留本次诊断并阻止发送，不把未知额度归给别的账号。默认招呼追加事件，与常用语结果分开。
- [ ] **6. 调整统计与停止。** 未发成功不递增 confirmed；opened 只在实际进入并识别会话后增加；pendingCount 按绑定账号计算。返回搜索页保持查询/筛选；所有不明确写结果停止本轮。interval 等待收到取消时正常 stopReason=user，不吞掉 pending。
- [ ] **7. 定向测试、typecheck 通过，ledger 记录六项历史 review 问题对应测试的结果。**

### Task 6: CLI 切换、诊断与使用说明

**Files:** Modify src/cli.ts、config.ts、diagnostics.ts、runner.ts、tests/cli.test.ts、tests/config.test.ts、scripts/runner.mjs、scripts/edge-mcp.cmd、config/boss.example.json、README.md；Create tests/diagnostics.test.ts。

**Interfaces:**

- parseArgs 支持 connect/doctor/collect/send/status；login 是 connect 的兼容别名，不保留旧启动逻辑。
- 新参数 --profile <实际目录名>、--account <绑定键>（status 定位）；send 的 --max-jobs N 或 --until-quota 二选一、--resume；保留 --keyword/--city/--config。
- CLI 的 send 先只读准备并展示账号、城市、关键词、网页筛选、完整模板及数量范围；交互输入明确 SEND 后生成 RunAuthorization。非交互缺少当次授权直接拒绝，不把命令名本身当作绕过 manual_only 的依据。自动执行者只在收到人类当次具体发送授权后提供这次输入。run 重读模板时必须匹配该授权 hash，不能重新选择新第一条后静默发送；准备与执行之间筛选变更也停止并重新预览。
- status 不连接浏览器；多账号未指定时逐账号列出，不把全库 pending 当当前账号。

```ts
type DiagnosticContext = {root:string;accountKey?:string;runId:string};
saveDiagnostic(ctx:DiagnosticContext,evidence:Evidence,screenshot?:Uint8Array):Promise<string>;
```

- [ ] **1. 写 CLI 回归测试。** mock 工厂记录选择，connect/login/collect/send 只使用 MCP；任何路径不调用 launchBossPages/context.close；status 不启动 MCP；扩展未安装/未授权/登录失效给出不同可操作消息，不宣称已连接；无范围 send 拒绝，授权输入前写调用为 0。
- [ ] **2. 写诊断测试。** 第 21 张不写；创建第 11 个诊断任务后仅保留最近 10 个程序拥有任务；用户额外文件保留；含 ..、重解析点/符号链接越界的清理目标拒绝；异常中 token/cookie 不进入日志。目录账号键使用 hash，文件正文只收集必要业务证据。
- [ ] **3. 运行 CLI/config/diagnostics 测试看失败。**
- [ ] **4. 替换 CLI 工厂。** 生命周期只关闭 MCP transport/process，删除实站入口对 legacy session 的依赖；旧 inspect/login-inspect 脚本保留但明确标为诊断历史脚本，README 不再推荐。参数中不提供自动切换专用浏览器选项。手动绑定/安装处理集中在 connect，等待用户操作时显示明确原因，可取消。
- [ ] **5. 实现诊断文件清单。** 每次只清理由程序 manifest 登记的文件；清理前 resolve+realpath 校验在 output 指定根内，无跨 shell 删除或递归删除整个未知文件夹。runId 前用独立诊断 UUID；截图从 MCP 正式截图工具获得，不发送给模型或远端服务。
- [ ] **6. 更新 README 和命令示例。** 说明扩展首次授权、profile 选择、connect→doctor→collect→send 顺序及退出保留 Edge；示例 maxJobs=1 是验收用，不擅改用户批量到上限的能力。模型配置仍空；不执行用户全局 MCP 配置修改。文档分清“发常用语”与“上传简历”。
- [ ] **7. 定向测试、typecheck、build 通过，运行编译后的 status，核对 pending 数字与数据库一致，ledger 更新。**

### Task 7: 完整回归及实站验收交接

**Files:** Create docs/edge-mcp-acceptance.md；Modify README.md、.superpowers/sdd/2026-10-27-boss-auto-greeting/progress.md；只为修复失败修改相应模块。

**Interfaces:** 使用前六任务公开的 CLI，验收表每项记录 passed/failed/not_run、时间、命令和本地证据路径。测试不得访问真实 BOSS；真实页面验证单独手动触发。

- [ ] **1. 运行完整离线验证。** scripts/boss.cmd test、typecheck、build 全部退出 0；包含旧数据迁移、多进程锁、延期自动发送和取消边界场景。编译不会意味着实站成功。
- [ ] **2. 运行实站 connect/doctor。** 先确认 Playwright 扩展已由用户在当前 Edge 安装并授权；连接正确 profile，读取 BOSS 真实 URL/账号。断开后用户 Edge 和原标签仍在，重新连接仍可识别；记录实际证据，连接失败不得改成专用浏览器。
- [ ] **3. 实站只读 collect 和模板预览。** 深圳/用户关键词、实际筛选、前几个职位信息、第一条完整常用语均可核对；发送调用为零。多个关键词不混入旧列表，账号/会话 ID 来源有可复核证据；缺失则止于对应故障，报告准确条件。
- [ ] **4. 单岗位发送验收前检查当次授权与历史额度。** 当前 manual_only 下没有新具体授权时此项记 not_run，不点击立即沟通。获得明确授权后，展示一个真实岗位与完整常用语，使用 --max-jobs 1 执行；验证正确会话、一次目标消息及可靠送达。未知模式或未知结果保留 pending，不追加发送；未通过就不开放批量实站验收。
- [ ] **5. 批量能力交接。** 本地测试验证 --until-quota、连续去重、无新增结束、Ctrl+C；只有用户另行指定本轮范围时才实站批量。平台额度未实际触发只能报告“停止逻辑已模拟验证”，不能报告“已投到上限”。
- [ ] **6. 汇总证据和遗留条件。** README 不标成“可用”直到明确对应级别；列明协议、模拟流程、实站只读、实站单条、批量各自状态。按照执行技能进行最后独立代码审阅，修复发现后仅重跑受影响检查。

## 依赖与执行建议

Task 1 → Task 3 → Task 4；Task 2 与其业务逻辑独立，但建议依序完成减少同时修改接口。Task 5 依赖 2/3/4，Task 6 依赖 1–5，Task 7 最后。

建议沿用原项目的本会话直接执行方式：由主执行者依序实现，最终独立审阅。任务共享 BossPages/Store/CLI 类型，频繁交接收益有限。此文仅为实施计划；不记录尚未发生的测试通过或真实消息发送。

## 计划自检

- 设计覆盖：连接/生命周期→1/3/6；搜索/模板→3/4；写入核验→4/5；额度/锁/恢复→2/5；诊断→6；实站验收→7。
- 六项旧 review 问题：额度→2/5；适配器取消/账号→4；延迟直发→4；模板准备→3；旧搜索结果→3；锁竞争→2。
- 新接口由所属任务定义，其他任务沿用；旧 BossPages 方法保留，MCP 结果不冒充 Playwright Page。
- 实站选择器/账号证据属于 Task 3 的观察步骤，发送模式属于 Task 4/7 的核验步骤；未知即停，不把 fixture 验证当作实站实现。
- 没有安装、启动、发送或提交操作因为计划保存而自动执行。

## 接入参考

- [Playwright 官方扩展连接说明](https://playwright.dev/mcp/configuration/browser-extension)：Edge 扩展复用现有会话，支持指定 profile。
- [官方 MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)：使用客户端 stdio 传输；锁定版本后以本地类型和协议测试为准。
- 本地 node_modules/@playwright/mcp/README.md 与实际 tools/list：0.0.83 工具名称、参数和能力契约的版本依据。
