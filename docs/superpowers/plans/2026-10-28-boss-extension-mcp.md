# BOSS Extension MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让现有项目通过改造版 mcp-bosszp 和 Chrome 扩展操作用户已打开的 BOSS 页面，并能准确报告每次失败停在哪一步。

**Architecture:** 保留 TypeScript＋SQLite 调度与记录；新增 MV3 扩展，通过 Native Messaging 连接本地 Python/FastMCP 服务。Python 提供固定业务工具与持久化动作日志，TypeScript 通过本机 Streamable HTTP 调用；不再经过 Playwright MCP relay 或 CDP。按只读诊断、搜索返回、单次沟通三个关口验收。

**Tech Stack:** 现有 Node 24、TypeScript、SQLite、MCP SDK 1.25.2、Vitest；Python 3.12、FastMCP 2.13.0；Chrome Manifest V3、Native Messaging。Python 传递依赖在实施时基于现有虚拟环境审核并锁定，不使用 latest。

**Spec:** [已审阅设计](../specs/2026-10-28-boss-extension-mcp-design.md)。用户已选择方案 A，并于 2026-10-28 要求实施计划；本文尚未执行。

## Global Constraints

- 2026-10-29 用户覆盖原账号设计：新扩展流程使用当前 Chrome 已连接页面，不要求账号 ID/姓名指纹/本机账号确认。下文旧账号核验步骤由此条替代。页面绑定、后置条件、项目级去重和历史额度停止保留；不能声称可检测账号切换。旧适配器和历史数据不迁移、不清空。

- 固定搜索“AI应用开发工程师”，城市“深圳”；用户自行登录并打开普通 Chrome 的 BOSS 页面。
- 不新建浏览器、不登录、不创建或关闭用户标签；“退出”是返回职位列表。
- 不使用 chrome.debugger、远程调试端口、隐藏浏览器或远程下载脚本；无任意 CSS/JS/URL 工具。
- 不修改在线简历、不上传附件、不交换联系方式、不自动回复其他消息；无大模型或 API key。
- 原始 upstream/mcp-bosszp 保持只读，维护版独立目录，保留 MIT 许可和来源提交 df9ba573829ded5cdd05abcfe5f055fb89e0befa。
- SQLite 业务库仍由 TypeScript 写入；Python 和扩展分别保存动作执行状态。未知写结果不重发。
- 当前 manual_only 默认与历史额度记录不擅自删除，不因日期变化推定额度恢复。第三阶段最多一次真实联系，不自动进入批量。
- 首版只读稳定性基线：同一绑定会话至少 10 次串行读取，覆盖至少 60 秒；每次核对 tab/document、页面类别和搜索框。
- 首版只读重试最多一次，单 DOM 动作 10 秒，消息结果观察 15 秒；停止、失联或超时不能被解释为发送失败可重试。
- 发现文件、动作日志和诊断包放 private/；不记录凭证、Cookie、整页 HTML、完整简历或其他会话内容。
- 根目录不是 Git 仓库。不初始化 Git、不执行提交；每任务用测试结果和变更清单作检查点。

## Review Focus

1. 点击成功但响应丢失或进程退出：必须标记 uncertain，重连查询旧 requestId，不能再次点击。任务 4、8 覆盖。
2. 扩展 worker 重启、重复连接、绑定页发生 SPA/整页导航：不能误把新文档当旧目标；保留现场。任务 3、4 覆盖。
3. 账号只有显示名、无历史会话可预读模板、常用语第一条被修改：能力缺口提前报告，联系授权与模板授权分开。任务 5、7 覆盖。
4. 聊天弹出多个标签、虚拟列表重排、搜索框受前端状态管理：只认稳定身份和后置条件，不依赖行号或盲目回退。任务 6 覆盖。
5. Windows 路径含空格/中文、旧发现文件、异常 stdout、消息分片或超限：可安装、可卸载、可定位且不误连。任务 1、2 覆盖。

## 交付与文件结构

这些模块共同构成一个最小连接闭环，按本计划顺序实施，不拆成并行开发的独立项目。

| 路径 | 责任 |
|---|---|
| contracts/boss-extension-v1.schema.json、contracts/examples/*.json | 跨语言工具、命令、结果与事件契约；示例作一致性测试 |
| extensions/boss-page/manifest.json、popup.html、popup.js | 最小权限和用户连接/停止入口 |
| extensions/boss-page/background.js、binding.js、journal.js | Native port、绑定、生命周期、持久化去重 |
| extensions/boss-page/content.js、dom-adapter.js、selectors.js | 固定页面操作、前置/后置检查、选择器版本 |
| integrations/mcp-bosszp/pyproject.toml、requirements.lock、LICENSE、UPSTREAM.md | 独立维护版及依赖来源 |
| integrations/mcp-bosszp/boss_bridge/{main,native,server,session,journal,diagnostics,tools}.py | 协议帧、MCP、会话认证、执行状态和业务路由 |
| integrations/mcp-bosszp/tests/test_*.py | Python 标准库 unittest 测试，避免额外测试框架 |
| src/boss-extension/{protocol,client,pages,diagnostics}.ts | 业务 MCP 客户端、BossPages 适配和诊断汇总 |
| scripts/{build-boss-extension.mjs,boss-bridge.cmd,register-boss-bridge.ps1,unregister-boss-bridge.ps1} | 扩展产物与本地 host 注册，作用域仅本项目当前用户 |
| tests/boss-extension-*.test.ts、tests/fixtures/boss-extension/* | Vitest 协议、状态机、DOM 和本地集成测试 |
| docs/boss-extension-setup.md、docs/boss-extension-acceptance.md | 安装/回退说明和分阶段真实验收记录 |

需要修改现有 src/domain.ts、authorization.ts、runner.ts、greeting.ts、storage/{schema,migrations,store}.ts、cli.ts、package.json、scripts/runner.mjs、.gitignore；保留旧适配器，新模式不会启动旧服务。存量测试不删除或放宽。

## 共用接口与测试入口

协议采用 v1：`Binding = {sessionId, tabId, frameId:0, documentId}`；`ActionContext = {runId, attemptId?, requestId, binding, accountKey?, deadline, leaseId?}`。时间为 UTC ISO 字符串，deadline 在各组件本地转换为剩余时间，过期拒绝。

`ActionResult<T> = {requestId, phase, value?:T, error?:{code,message}, evidenceIds:string[]}`；phase 为 issued/accepted/validated/executing/observed/rejected/failed/uncertain。issued 只表示客户端准备，accepted 才表示服务持久化收到。执行阶段不允许倒退。

契约中逐项定义以下 payload/result：inspect_session→SessionView；search_jobs({city,keyword})→SearchView；list_jobs({advance:false|true})→JobPage；open_job({jobKey})→JobView；restore_search({scope})→SearchView；open_chat({jobKey})→ChatView；inspect_chat({conversationKey,templateHash?})→ChatView；read_first_phrase({conversationKey})→Phrase；choose_first_phrase({conversationKey,expectedHash})→Selection；submit_filled_phrase({conversationKey,expectedHash})→Selection；inspect_send_result({conversationKey,expectedHash})→SendView；get_action_result({requestId})→ActionResult；stop_run({runId})→StopReceipt；get_diagnostics({runId})→DiagnosticSummary。Job/Conversation 兼容 domain.ts；Phrase 含原文及 hash；Selection 为 filled/submitted/unknown；SendView 为 confirmed/unconfirmed。SessionView 必须含 binding、pageKind、identityCapability、可核验账号、搜索框状态、阻断提示及适配器版本。

另外定义控制工具 `start_run({runId,binding,scope})` 和 `renew_run({runId,leaseId})`，供客户端维持租约；scope 包含只读/搜索/单次联系、账号、关键词/城市/筛选和常用语策略。租约 30 秒，每 5 秒续租；由 host 和扩展各自的单调时钟计算到期。续租不得扩大 scope 或让过期租约复活。

所有业务工具服务端验证固定 schema，禁止多余字段；接口中的 jobKey/conversationKey 只能引用当前绑定中已核验对象。Host/扩展持有 run scope 副本，不能仅相信 TypeScript 已检查。

测试命令：

- TypeScript：`.\scripts\boss.cmd test tests/boss-extension-<name>.test.ts`。
- Python：`& '.\.venv-mcp-bosszp\Scripts\python.exe' -m unittest discover -s integrations/mcp-bosszp/tests -p 'test_<name>.py' -v`。执行前检查该解释器；缺失则用既有 Python 3.12 创建项目虚拟环境，不改全局安装。
- 最终：`.\scripts\boss.cmd typecheck`、`.\scripts\boss.cmd build`、`.\scripts\boss.cmd test`，再运行全部 Python 测试。
- 本地 DOM 集成测试可使用项目已有 Playwright 启动测试浏览器，但只访问 localhost 夹具、不接入用户 Chrome/BOSS；它不是生产连接方式。

### Task 1：跨语言协议及 Native Messaging 帧

**Files:** 创建 contracts/、src/boss-extension/protocol.ts、integrations/mcp-bosszp/ 的依赖/许可文件及 boss_bridge/native.py；测试 tests/boss-extension-protocol.test.ts、test_native.py。

**Interfaces:** `encode_native(value:dict)->bytes`；`read_native(stream:BinaryIO)->dict|None`；TS `parseResult<T>(raw:unknown):ActionResult<T>`。共同 schema 为协议唯一约束源，Python/JS 的校验器必须通过同组有效/无效样例。

- [ ] 写失败测试：分片读取仍恢复一条消息；粘连帧分开读取；EOF 与截断帧区分；非法 JSON、超过 1,000,000 字节及任意 selector/script 字段拒绝；`expect(parseResult({phase:'success'})).toThrow()`。
- [ ] 运行 protocol 和 native 测试，确认因缺少实现失败。
- [ ] 实现固定 4 字节原生字节序长度帧及完整读取；出站同样限长，事件分批发送。原文 Unicode 不损坏；stdout 严禁普通日志。记录上游来源和实际锁定依赖。
- [ ] 重跑测试通过，记录依赖/权限变化；不要运行上游 QR/API 登录逻辑。

### Task 2：本地服务启动、发现、认证与可卸载注册

**Files:** 创建 boss_bridge/{main,server,session}.py、scripts/boss-bridge.cmd、register-boss-bridge.ps1、unregister-boss-bridge.ps1；测试 test_server.py、test_registration.py。

**Interfaces:** `serve_native()->None` 为唯一入口；`publish_discovery(session:Session)->Path` 原子发布仅当前用户访问的 discovery；`authenticate(request,session)->None`；`claim_host_lock()->HostLock`。发现文件含 protocolVersion/sessionId/port/token/pid，不含网页数据。MCP 初始化后 inspect_session 还需核对 sessionId。

- [ ] 写失败测试：正确 token 可初始化，错误/过期 token、异源 Origin、不匹配 Host/会话拒绝；未 ready 不发布；第二 host 返回 busy；端口被占用不接管；断开 native 输入后停止 HTTP；带空格中文路径可启动且 stdout 仅有合法帧。
- [ ] 运行 server/registration 测试，确认失败。
- [ ] 实现同进程 native 读循环与 ASGI/FastMCP 服务生命周期、127.0.0.1 系统分配端口和 Windows 单实例锁。HTTP token 由 host 每会话生成；ACL 限当前 Windows 用户。无 Origin 的本机 SDK 请求允许，但仍严格验证 token/Host。关闭仅删除本会话 discovery。
- [ ] 实现注册脚本的 dry-run/apply/uninstall：固定 host 名 `com.jobsearch.boss_bridge`，HKCU Google Chrome NativeMessagingHosts 精确键；清单 allowed_origins 固定扩展 ID。若键已有不同所有者则报冲突，不覆盖。测试使用临时注册名并清理自身键；此任务不实际注册生产键。
- [ ] 重跑测试通过；验证发现文件和日志不泄露 token。依赖 FastMCP API 以安装版本源码为准。

### Task 3：扩展绑定、事件及只读页面能力

**Files:** 创建 extensions/boss-page/ 全部基础模块、scripts/build-boss-extension.mjs；测试 boss-extension-binding.test.ts、boss-extension-dom.test.ts、fixtures/boss-extension/。

**Interfaces:** `bindActiveTab(tab:ChromeTab):Promise<Binding>`；`validateSender(sender:MessageSender,binding:Binding):boolean`；`inspectSession():SessionView`；`readJobs():JobPage`；`recordLifecycle(event:LifecycleEvent):Promise<void>`。background 管绑定，content 只处理当前文档的固定命令。

- [ ] 写失败测试：非 BOSS/子框架/伪造 documentId 消息拒绝；用户切换 tab 不换目标；document 变化使旧绑定失效；worker 重启恢复日志但不恢复写租约；SPA 导航重新核对页面；重名账号不能产生 stable accountKey。
- [ ] 运行 binding/dom 测试，确认失败。
- [ ] 实现固定 public manifest key、MV3 popup、nativeMessaging/storage/webNavigation 和 `https://www.zhipin.com/*` 权限；内容脚本仅批准路径工作。未知页面仍报告元数据但不操作。无 externally_connectable、网页控制消息、cookies/debugger 权限。构建把版本化扩展文件输出到 dist/boss-extension，校验 manifest 权限和资源完整性。
- [ ] 实现只读选择器候选、数量/可见性/页面类型报告。真实选择器未核验时 capability=false，不能将夹具通过视为 BOSS 契约已通过。扩展日志用 storage.local 有界保留，native 断连后仍记录绑定页事件。
- [ ] 重跑测试和扩展构建通过；产物不含私钥、令牌、远程脚本，不安装扩展。

### Task 4：可追踪执行器、租约及写操作去重

**Files:** 创建 boss_bridge/{journal,tools,diagnostics}.py、src/boss-extension/diagnostics.ts；修改 background.js、journal.js、content.js；测试 test_journal.py、boss-extension-executor.test.ts、boss-extension-diagnostics.test.ts。

**Interfaces:** Python `dispatch(command:Command)->ActionResult`、`get_result(request_id:str)->ActionResult`；扩展 `execute(command:Command):Promise<ActionResult>`、`stopRun(runId:string):Promise<StopReceipt>`。journal 必须先持久化 executing 才派发 DOM 写动作。get_result 不执行动作。

- [ ] 写失败测试：相同 ID 同 payload 只点击一次，相同 ID 不同 payload 拒绝；点击后丢响应→uncertain；服务/worker 重启后不重放；日志丢失→unknown/uncertain；超时、停止或租约失效后 clickCount 不增长；30 秒租约配合 5 秒续租容忍一次普通调度延迟，但到期立即拒绝新动作。
- [ ] 写诊断测试：在 MCP→native→background→content 各边界断开，summary 指向最后持久化阶段；URL query/fragment、token、其他会话文本不进入包；无关联导航只能标记 uncorrelated，不能写成用户操作或主页面崩溃。
- [ ] 运行对应测试确认失败；实现单动作调度、两层 journal、事件合并和脱敏。Python 日志独立 private/boss-extension/actions.sqlite；扩展 storage journal 写入失败时拒绝动作，不无限删除未决记录。
- [ ] 重跑全部本任务测试通过，检查每个故障都有 requestId 和可解释的最后边界。

### Task 5：TypeScript 业务客户端与第一阶段真实验收

**Files:** 创建 src/boss-extension/client.ts；修改 src/cli.ts、scripts/runner.mjs、package.json、.gitignore；新增 docs/boss-extension-setup.md、acceptance.md；测试 boss-extension-client.test.ts、test_integration.py。

**Interfaces:** `BossExtensionClient.connect(discoveryPath:string):Promise<BossExtensionClient>`；`call<K extends ToolName>(name:K,context:ActionContext,payload:ToolArgs[K]):Promise<ActionResult<ToolResults[K]>>`；`close():Promise<void>` 先 stop_run/撤销租约再断开。CLI `extension doctor --samples 10 --duration-ms 60000` 仅调用只读工具。

- [ ] 写失败测试：旧 discovery 握手不一致停止；服务器退出保留最后边界；工具缺失/schema 不匹配不启用写；读重试最多一次且绑定改变不重试；客户端结束不发送关闭页面命令。集成通过真实 MCP SDK+host+模拟 native peer，覆盖初始化、只读和断连。
- [ ] 运行 client/integration 测试确认失败；实现 SDK StreamableHTTPClientTransport、认证、工具白名单、5 秒续租和清理，旧 Playwright/DevTools 启动路径不参与该命令。
- [ ] 重跑测试通过，完成本地注册与加载说明，包括执行策略受限时只对当前安装进程生效的操作方式；不改用户全局策略。实施获批后使用注册脚本，只让用户完成 Chrome“加载已解压扩展”及“连接此页面”这两个必要 UI 步骤。
- [ ] 在真实 BOSS 做 >=60 秒/10 次只读验收；输出 capability 报告与诊断包路径，确认账号稳定标识来源。若只有姓名、搜索框无法唯一定位、页面意外改变或连接不稳定，则停在阶段一，报告缺口；不通过后续写操作试探原因。

### Task 6：搜索、详情、列表进度和返回

**Files:** 创建 src/boss-extension/pages.ts；修改 dom-adapter.js、selectors.js、tools.py、domain.ts、cli.ts；测试 boss-extension-search.test.ts。

**Interfaces:** `ExtensionBossPages implements BossPages`；保留已用 BossPages 方法。新增只读能力 `inspectCapabilities()` 和受限详情读取 `openJob(job:Job):Promise<Job>`。RunConfig 的 connection 新增独立 `{kind:'boss-extension';discoveryPath:string}` 分支，旧 EdgeConnection 使用点穷尽分支检查。`list_jobs({advance:true})` 只通过列表控件滚动/分页，不任意导航。

- [ ] 写失败测试：受控输入框最终关键词正确、城市非深圳拒绝、搜索无后置变化报 DOM_ACTION_UNSUPPORTED；虚拟列表重排使用 jobKey 去重；同页返回核验职位入口与搜索范围；单个可信聊天新页可关联、多个候选报 TARGET_AMBIGUOUS；恢复不得调用 history.back/tab.close/browser.close。
- [ ] 运行 search 测试确认失败；实现固定搜索、详情、稳定 ID 及 SearchScope 恢复。新文档由 background 根据来源标签、动作窗口和页面身份重新绑定；原绑定仍不可执行旧命令。不能用任意新开的 BOSS 页替代目标。
- [ ] 重跑测试通过；CLI `extension search-test` 固定深圳/AI应用开发工程师，读取一个详情并返回。真实执行该命令，确认没有 open_chat 调用、列表页保留、范围正确；通过后才开放第三阶段实现验收。

### Task 7：调整联系授权与常用语首次读取顺序

**Files:** 修改 domain.ts、authorization.ts、runner.ts、greeting.ts、storage/{schema,migrations,store}.ts；测试 boss-extension-authorization.test.ts、boss-extension-migration.test.ts、现有 runner/greeting 测试。

**Interfaces:** 授权增加可辨别策略 `phrasePolicy:{kind:'pinned';hash:string}|{kind:'first_saved_phrase'}`；`assertContactAuthorized(auth,account,config,filtersHash):void` 与 `assertPhraseAuthorized(auth,pinnedHash,phrase):void` 分开。BossPages 新增 `readFirstPhrase(c:Conversation):Promise<Template>`，`inspectChat(c,t?:Template)` 可在未知模板时先核对会话。Store 增加 `reserveContact(runId,accountKey,job):Attempt`、`pinAttemptTemplate(attemptId,t):void`、`pinRunTemplate(runId,t):void`；新增 attempt.template_policy，template_hash 允许 NULL，但 NULL 不等于空字符串哈希。

- [ ] 写失败测试：无历史会话时先检查一次联系授权→reserveContact→openChat→核对身份→读取第一条→固定哈希→选择；授权不匹配或待确认旧记录存在时 openChatCount=0；空菜单有 platform_greeting 记录但 confirmed=0；第一条变化停止；旧 pinned 授权行为保持。
- [ ] 写迁移测试：旧业务库备份后迁移，已有 attempt/hash/quota 原样；NULL 模板的 contact 未决记录仍阻止重复联系，不能因 reconcile 无模板跳过阻断；失败迁移回滚，不覆盖原库。
- [ ] 运行测试确认失败；实现授权策略和事务迁移，只允许新扩展模式使用延后读取策略。联系前也必须检查未决动作；结果未知时通过原 requestId/目标只读证据核对，不用 open_chat“恢复”。第一条原文保持不改写，哈希规则明确并测试换行；不能将旧 normalize 的 trim 结果替换用户实际发送文本。
- [ ] 重跑新旧核心测试通过；默认 manual_only、历史 quota latch 和单次范围限制依然有效。

### Task 8：选择第一条、发送验证和安全停止

**Files:** 修改 dom-adapter.js、selectors.js、pages.ts、greeting.ts、cli.ts；测试 boss-extension-greeting.test.ts、boss-extension-stop.test.ts。

**Interfaces:** 使用共用 choose_first_phrase/submit_filled_phrase/inspect_send_result 契约；`readFirstPhrase` 只打开菜单和读取，不选择条目。只有 `filled` 后可以执行 submit；unknown 返回 unconfirmed，阻止后续职位。

- [ ] 写失败测试：选择即发送时 submitCount=0；仅填入时 submitCount=1；unknown 时不补 Enter；模板哈希/招聘者/职位/账号变化均点击前拒绝；pending/失败图标/旧消息相同文字不能当本次成功；平台默认招呼与用户常用语分开；已有联系跳过；验证/登录/额度出现立即停止；返回列表失败仍保存已确认发送，不重发。
- [ ] 写故障测试：点击执行后 Ctrl+C/native 断开/消息观察 15 秒超时，保持 uncertain 并撤销后续动作；停止确认不能谎称撤销已发生点击。
- [ ] 运行测试确认失败；实现每步重新定位、唯一/可见元素检查、目标聊天的发送前基线和发送后新消息状态核对。适配契约无法区分效果时关闭发送能力，不靠假定解除。
- [ ] 重跑测试通过。CLI `extension greet-once` 强制 maxJobs=1、固定关键词城市，沿用本轮授权路径；不自动开启 until-quota，不输出凭证。

### Task 9：全链路验收与交付

**Files:** 完善 docs/boss-extension-setup.md、docs/boss-extension-acceptance.md、README.md；必要时修复前述实现与测试。

**Interfaces:** 验收记录包含组件版本、运行范围、runId、阶段结果、诊断路径、未验证能力；不把单次结果写成长期稳定承诺。

- [ ] 执行 typecheck/build/全量 Vitest/全量 Python unittest；记录实际数量与结果，不沿用旧测试数字。运行本地协议断连、重复请求、失效文档等故障集，确认没有遗漏的未知写动作。
- [ ] 检查真实阶段一、二证据仍适用于当前构建。若关键代码改动使其失效，重验受影响阶段；遇网站要求可信输入、身份不可核验或额度阻断就停止，报告具体边界，不能暗中改用 CDP。
- [ ] 满足当前授权与账号核验后运行一次 greet-once：搜索→详情→立即沟通→第一条常用语→本方新消息发送状态→返回。用户未决记录/历史额度未核验时不尝试发送。记录平台招呼与常用语各自结果；成功最多一条，不继续循环。
- [ ] 检查停止后浏览器和原页面仍保留、服务仅在扩展连接期间运行、没有计划任务。验证卸载 dry-run 仅列本项目注册键/文件；不清理用户浏览器配置或业务数据。
- [ ] 汇总修改、测试、真实验收结果与剩余限制供用户查看。若真实环境未能通过，交付可复现命令及诊断结论，明确“未完成真实发送”，不以本地夹具通过代替。

## 计划自查

已对应设计的三阶段、组件边界、账号/模板启动顺序、单实例/租约/去重、导航关联、隐私、安装回退与不关闭浏览器约束。补充 start_run/renew_run 是把设计中的续租落实为固定控制工具；它们不能增加运行权限。五项 Review Focus 均已落在任务测试中。当前只交付计划，未安装新服务或扩展、未修改业务代码、未发送消息。

## 执行方式

建议本会话顺序实施：三个组件共享协议和动作状态，顺序完成接口再验收比同时改动更便于定位问题。计划审阅后使用 executing-plans；每完成一个任务记录测试检查点，真实浏览器验收按三个关口推进，不反复创建 Welcome 授权页。
