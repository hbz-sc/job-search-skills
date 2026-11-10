# 当前 Chrome 页面求职流程实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在用户已登录并连接的普通 Chrome BOSS 页面完成固定关键词搜索、职位详情、第一条常用语发送与返回，最终支持受控串行循环。

**Architecture:** 延续已验证的 TypeScript → 本机 FastMCP → Native Messaging → Chrome 扩展。新增当前页面工作流，复用连接、日志与 SQLite 技术，不把会话 ID 填成旧 Account.key。业务操作限固定工具，扩展自行定位 DOM；无任意脚本/选择器接口。

**Tech Stack:** 现有 TypeScript、Node SQLite、MCP SDK、Python/FastMCP、MV3 扩展；不增加 LLM、API key、LangChain、Playwright MCP 或 CDP。

**Spec:** [原设计及 2026-10-29 当前页面模式修订](../specs/2026-10-28-boss-extension-mcp-design.md)。本计划替代旧计划尚未完成的账号相关任务和后续工作流部分；已完成的只读实现保留。

## Global Constraints

- 固定关键词 `AI应用开发工程师`，城市 `深圳`。用户负责登录，程序仅操作扩展明确连接的标签；不识别账号、不建立本机账号别名、不声称能够检测同页切换账号。
- 保留 sessionId/tabId/frameId/documentId 验证。网页登录失效、验证弹窗、额度提示、未知发送结果立即停止后续动作。
- 不创建专用浏览器、不关闭用户标签、不用 history.back 盲目返回；搜索恢复靠记录的范围和已验证页面入口。
- 第一条常用语按原文使用，不生成、不改写；选择即发送则不再补发，仅填入时才发送一次。
- 不上传简历、不交换联系方式、不回复其他会话、不创建定时任务。
- 代码实施与实际发送授权分开。当前 manual_only 和历史额度记录保留，不因移除账号识别或日期变化而恢复发送。
- 本轮交付完整本地代码和模拟验证；真实验收按搜索、单次联系、循环分阶段进行。未发送不能记成功。
- 现有根目录无 Git 仓库，记录变更/测试检查点，不初始化 Git 或提交。实施沿用本会话顺序执行方式。

## Approaches 与选择

沿用用户已选择的扩展业务 MCP。实现选择：为当前页面新增工作流与项目级记录表，保留旧适配器和旧账号型发送流程；比把所有旧 Account 接口改成可选更容易隔离回归。不是新增一套登录或浏览器连接。

项目级去重会保守跳过任何已有历史联系记录；不支持按不同登录账号独立重新投递。这个取舍符合不做账号识别的要求。

## Review Focus

1. 发送点击已经发生但响应丢失：持久化 uncertain，不重发、不继续下一职位（任务 1、4）。
2. 正常搜索跳转被当作掉线，或意外导航被当作正常：按 requestId 关联目标变更，旧文档命令失效（任务 2）。
3. 常用语选择既可能填入也可能直接发出，旧同文消息可能误判成功：保存发送前基线、核对本次新消息（任务 4）。
4. 取消账号 ID 后遗漏旧去重/额度记录：跨旧账号记录保守读取，不清空历史（任务 3）。
5. 列表重排/分页回到旧内容导致死循环：稳定职位键、进度指纹、无新增停止（任务 5）。

## 任务 1：补齐受限写动作协议和可定位执行

**Files:** 修改 contracts/boss-extension-v1.schema.json、src/boss-extension/{protocol,client}.ts、integrations/mcp-bosszp/boss_bridge/{server,tools,journal}.py、extensions/boss-page/{controller,content,background}.js；新增 extensions/boss-page/journal.js；测试 boss-extension-executor.test.ts、test_bridge.py、test_journal.py。

**Interfaces:** `start_run({runId,binding,scope}) -> {leaseId}`、`renew_run({runId,leaseId})`；scope 为 `search_only | greet_once | batch`，固定城市关键词、first_saved_phrase 策略及 maxContacts。业务命令包含 runId/requestId/binding/deadline/leaseId；运行内不允许扩大范围。复用 ActionResult 阶段。

- [ ] 写失败测试：同 requestId 重复只执行一次，变更 payload 拒绝；两层执行记录写入失败不点击；重启/断连/超时后不重放；停止后点击数不增加。
- [ ] 运行测试确认失败，再实现 host 与扩展的串行调度、执行前持久化、30 秒租约/5 秒续租；过期不能复活。
- [ ] 校验工具 schema 和协议能力，旧只读客户端与新版动作客户端各自明确协商，不能简单把 writeEnabled:false 检查删掉。
- [ ] 补齐每动作 requestId、阶段、耗时、候选数量、目标绑定、错误代码。令牌、整页内容、其他会话正文不进入诊断。
- [ ] 运行 `.\scripts\boss.cmd test tests/boss-extension-executor.test.ts` 和 Python bridge/journal 测试，通过后记录检查点。

## 任务 2：搜索、职位详情与正常页面跳转

**Files:** 新增 extensions/boss-page/{selectors,search-actions}.js、src/boss-extension/workflow.ts；修改 dom-adapter.js、controller.js、client.ts、cli.ts、tools.py；测试 boss-extension-search.test.ts、boss-extension-controller.test.ts。

**Interfaces:** `search_jobs({city:'深圳',keyword:'AI应用开发工程师'}) -> SearchView`、`list_jobs({advance:boolean}) -> JobPage`、`open_job({jobKey}) -> JobView`、`restore_search({scope:SearchScope}) -> SearchView`。SearchScope 含固定关键词/城市和列表进度；JobView 含稳定职位键、公司、岗位、当前详情证据。

- [ ] 写失败测试：受控输入框正确触发搜索、错误城市停止、零/多个搜索框拒绝；点击无效果有明确错误；SPA/新文档预期变化可关联，旧绑定不能继续执行。
- [ ] 先运行失败，再实现固定 DOM 操作和后置状态读取。正常导航生成新 binding，由同一连接同步给客户端；不因每次搜索而要求用户重新连接。
- [ ] 新标签仅在当前动作、openerTabId 和 BOSS 目标均符合且只有一个候选时关联；歧义停止，不能接管任意 BOSS 标签。原列表页保留，返回时优先切回已验证列表页。
- [ ] 下一版删除可选账号头部/姓名哈希探测，移除硬编码“只读”状态，按实际能力显示。将所有扩展改动合并构建，减少反复让用户刷新扩展。
- [ ] 运行 `.\scripts\boss.cmd test tests/boss-extension-search.test.ts tests/boss-extension-controller.test.ts`；通过后构建并验收拟新增命令 `extension search-test`：搜索、读一条详情、回到结果列表，open_chat 调用数必须为 0。

## 任务 3：不依赖账号的项目记录与运行范围

**Files:** 新增 src/boss-extension/{store,run-policy}.ts；修改 src/storage/{schema,migrations}.ts；测试 boss-extension-store.test.ts、boss-extension-policy.test.ts。

**Interfaces:** `openPageWorkflowStore(file)`，提供 `beginRun(scope)`、`reserveContact(runId,job)`、`pinPhrase(attemptId,phrase)`、`updateAttempt(id,result)`、`shouldSkip(jobKey,conversationKey?)`、`getBlockers()`。新表 page_runs/page_attempts/page_stops 使用项目作用域；旧表原样保留，不伪造账号键。模板初始可为 NULL，表示尚未读取。

- [ ] 写失败测试：保留旧 attempts/quota；旧任一账号已有职位记录跳过；未决联系阻止新联系；先 reserve 后 open_chat；NULL 模板仍为未决；迁移失败事务回滚，原库有备份。
- [ ] 写策略测试：manual_only 不得 open_chat；search_only 不得联系；greet_once 最多联系一个；旧额度停止没有明确解除证据时继续阻断。取消账号识别不自动解除历史停止。
- [ ] 运行失败后实现新表和旧记录只读兼容读取，复用既有单运行锁，避免旧/新执行器同时发送。
- [ ] 运行 `.\scripts\boss.cmd test tests/boss-extension-store.test.ts tests/boss-extension-policy.test.ts` 通过，检查未修改 private/profile.json 的默认发送模式。

## 任务 4：进入聊天、选择第一条常用语、确认发送

**Files:** 新增 extensions/boss-page/chat-actions.js；修改 workflow.ts、protocol.ts、client.ts、cli.ts、tools.py；测试 boss-extension-greeting.test.ts。

**Interfaces:** `open_chat({jobKey}) -> ChatView`、`read_first_phrase({conversationKey}) -> {text,hash}`、`choose_first_phrase({conversationKey,expectedHash}) -> filled|submitted|unknown`、`submit_filled_phrase({conversationKey,expectedHash})`、`inspect_send_result({conversationKey,expectedHash}) -> confirmed|unconfirmed`。

- [ ] 写失败测试：必须先记录联系尝试、核对职位/公司/招聘者再选常用语；菜单为空停止；第一条原文/哈希改变停止；直接发送时 submitCount=0，仅填入时 submitCount=1，unknown 时不按 Enter。
- [ ] 写发送证据测试：历史同文消息不算本次成功，pending/失败标志不算送达；平台自动招呼与第一条常用语分别记；返回失败仍保留已发送结果，不能重发。
- [ ] 运行失败后实现原文读取与 UTF-8 SHA-256、消息基线、最多 15 秒结果观察。联系人匹配属于目标校验，不是用户账号识别。
- [ ] 运行 `.\scripts\boss.cmd test tests/boss-extension-greeting.test.ts`。拟新增 `extension greet-once` 完整串行流程；当前真实发送须有当次明确授权并处理历史额度停止，不能以测试之名绕过。

## 任务 5：串行循环、断点和停止

**Files:** 修改 workflow.ts、store.ts、cli.ts、扩展 popup.html/js；测试 boss-extension-batch.test.ts。

**Interfaces:** `runWorkflow({mode:'search_only'|'greet_once'|'batch',maxContacts,stopOnQuota:true},signal) -> RunSummary`；提供停止按钮，汇总 discovered/skipped/contacted/confirmed/uncertain/stopReason。

- [ ] 写失败测试：按稳定职位键而非行号推进；已有沟通跳过；列表无新增/结果耗尽停止；达到 maxContacts 或平台额度停止；unknown、断连、登录失效立即中断；重启不自动恢复发送。
- [ ] 运行失败后实现串行队列和 SQLite 检查点；禁止并发联系。循环命令必须明确选择批量范围，不能由一次成功自动切换为批量。
- [ ] 运行 `.\scripts\boss.cmd test tests/boss-extension-batch.test.ts`；本地模拟额度提示验证停止，真实单次成功后才安排批量验收。平台上限以页面提示为准，不硬编码人数、不通过重试探测突破。

## 任务 6：交付验收与故障说明

**Files:** 更新 docs/boss-extension-{setup,acceptance}.md 和执行 ledger。

- [ ] 运行 `.\scripts\boss.cmd typecheck`、`build`、`test`，全部 Python unittest，以及扩展构建；只记录实际结果。
- [ ] 按本会话顺序实施方式完成独立最终审查，修复具体问题；不把本地模拟通过称为真实网站成功。
- [ ] 用户加载最终扩展后沿用同一连接验收；只在确有扩展代码更新或绑定失效时请求刷新/重连，不重复创建授权页。
- [ ] 报告每阶段真实结果；遇问题给出“动作、最后确认边界、错误、是否可能已发送、诊断路径”，不无证据称网站崩溃。
- [ ] 结束后保留用户 Chrome 和 BOSS 标签；没有启动定时任务，也不在会话结束后默默继续发消息。

## 自查与执行顺序

任务 1 → 2 → 3 → 4 → 5 → 6；搜索真实验收通过后再验收联系。上述五类高风险输入均有对应测试。保留固定关键词、第一条常用语、不识别账号的要求；区别账号识别和目标聊天核对。此文件仅为待审阅计划，本轮没有启用写工具或发送消息。
