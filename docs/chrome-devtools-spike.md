# Chrome DevTools MCP 连接试验（2026-10-27）

## 范围

用户同意测试官方 Chrome DevTools MCP 自动连接当前 Chrome。用户已启用远程调试，并在 Chrome 自身对话框允许连接。

- Chrome 本机版本：156.0.8078.48。
- chrome-devtools-mcp：1.12.0，安装在 private/devtools-spike，ignore-scripts。
- 连接参数：autoConnect、stable；禁用 usage statistics、performance CrUX 和不需要的性能/网络/内存工具。
- 脚本：scripts/devtools-inspect.mjs。仅诊断用途，尚未接入生产 runner。
- 不使用 mcp-bosszp 的登录或 API，不提取 Cookie，不关闭/新建/导航用户页面。

## 实际结果

1. MCP initialize 和 tools/list 成功。
2. 首次列表输出的新版格式包含标题和括号内 URL，测试脚本按旧版裸 URL 格式解析导致误报无 BOSS。修正解析后重新连接；第二次授权成功。
3. list_pages 返回 4 个页面，其中明确识别到 pageId=4，https://www.zhipin.com/web/geek/jobs。
4. 对 pageId=4 调用 evaluate_script，仅请求 location.origin+pathname、输入框 placeholder/type、document.title，waitForStableDom=false。
5. 返回 isError=true：Execution context was destroyed, most likely because of a navigation.
6. 同一连接再次 list_pages：仍返回 4 个页面，但没有匹配 BOSS 域名的页面。此脚本只输出 BOSS 条目，没有保存其余页面 URL，因此无法确认原 pageId=4 最终 URL。
7. 用户确认当前现象为“变成空白页或标签关闭”。此回答不能区分空白与关闭。
8. 结束此次 MCP 连接，没有自动重连。

## 结论与限制

已证实官方 MCP 能连接当前浏览器并列出已登录的 BOSS 职位标签。尚未证实可以读取 BOSS DOM，更没有完成搜索、打开职位、点击立即沟通或发送常用语。

本次没有调用 click、fill、press_key、navigate_page、close_page 等页面写操作。页面执行环境被销毁的具体原因尚未确认：可能是页面跳转、页面脚本行为或浏览器/控制协议交互问题。不能仅凭错误文案断言 BOSS 风控、验证码、封禁或 Chrome 缺陷。

下一次调查应先完善单连接的页面生命周期记录：保留目标页面 ID、脱敏后的 URL、导航/关闭/崩溃事件；区分首次挂接与脚本读取分别触发的变化。用户恢复页面后再观察，不应靠重复换 MCP 和反复请求授权推断原因。遇到网站明确安全验证，应交由用户处理，不做绕过。

当前 TypeScript＋SQLite 主流程及 manual_only 默认配置未改；没有发送招呼。

## 第二次诊断：2026-10-27，2026-10-28 核对中断后的记录

本次给 Puppeteer 的协议 logger 加了只读事件记录，没有发送额外 CDP 命令。诊断结束后校验文件与预期补丁完全一致，恢复了原始 BrowserManager.js；诊断脚本保留供复查。协议日志为 private/devtools-spike/protocol-9848.jsonl。

以下时间均为北京时间：

- 16:08:44 连接已恢复的职位页面成功，主页面目标哈希 2cb59361157b；同时自动附加到 BOSS 聊天 shared_worker，目标哈希 880c5524019a、会话哈希 ed911544e50c。
- 首次 list_pages 返回 5 个页面，其中 BOSS 为 pageId=3，职位列表页面。
- 16:10:39.836 收到 Inspector.targetCrashed，会话 ed911544e50c。随后相同 shared_worker 被 detached 和 destroyed。它对应 socket-worker.2.0.5.min.js。
- 16:10:39.973 同一个主页面目标 2cb59361157b 的 URL 更新为 /web/geek/chat。
- 第二次 list_pages 仍返回 5 个页面，BOSS pageId=3 仍存在，显示聊天页。
- 本次在中断前仅执行两次 list_pages，没有调用 evaluate_script 或 take_snapshot。协议日志中也没有 Runtime.evaluate、Runtime.callFunctionOn、Page.navigate、Target.closeTarget、Browser.close 或 Input.* 出站命令。
- 2026-10-28 检查时，旧诊断客户端与对应 MCP 服务已经不在运行。查询 16:05–16:15 的 Windows Application 日志未获得 Chrome 1000/1001/1002 错误记录；该阴性结果不能排除 Chrome 子进程异常。

新结论：这次明确捕获到聊天后台 shared_worker 崩溃，主页面没有在已记录时段内被销毁，而是变为聊天页。没有复现并解释上次 evaluate_script 导致执行环境销毁、随后页面变空白的完整现象。不能把 shared_worker 崩溃直接当作上次空白页的根因，也不能仅凭事件先后断言是 MCP 引起了崩溃或页面跳转；人工操作、页面自身行为与浏览器兼容性等因素尚未区分。

后续应在用户保持页面不操作的条件下，用同一连接比较“只附加并列举”与“单次只读 DOM”阶段，绑定目标 ID 并记录导航请求来源。先复现，再决定修复点；不删除登录状态，不规避网站验证，也不进行打招呼写操作。

## 2026-10-28 完整流程尝试与代码检查

用户明确授权试走完整流程一次，并在新 Chrome 原生授权框允许连接。

实际调用顺序：

1. list_pages：一个页面，pageId=1，/web/geek/chat。
2. take_snapshot(1)：读取成功，但 RootWebArea 已为 /web/geek/resume；快照包含账号示例用户和“职位”链接 uid=1_4。
3. click(1,1_4)：返回 Element with uid 1_4 no longer exists on the page。
4. take_snapshot(1)：RootWebArea 为 chrome://new-tab-page/。
5. list_pages：一个 Chrome 内部页，没有 BOSS 标签。

用户明确表示期间未操作页面，必须纳入后续排查，不能归因于用户误点。本次未调用 evaluate_script、navigate_page、close_page 或任何键盘工具。依赖的 click 实现先执行 getElementByUid，再调用 locator.click；当前报错产生于 getElementByUid 内部的元素解析阶段，因此没有执行到该次鼠标点击。这并不排除连接、读取或第三方代码产生其他副作用。

静态检查：TextSnapshot.create 使用 accessibility.snapshot；McpPage 元素失效处理仅抛错；已连接浏览器的关闭路径执行 disconnect。没有在已检查的快照、元素失效和连接清理路径中发现主动 goBack/goto/关闭用户标签的调用。源码中的导航工具确实具有这些能力，但本次未调用它们。此次运行未开启底层 CDP 事件记录，因此不能断言已经排除整个调用链的导航副作用。

确认并修复了本地测试脚本的缺陷：旧脚本仅缓存 BOSS 的 pageId，不在后续操作前检查 URL；相同 ID 的页面发生跳转后仍会尝试使用旧快照元素。现已抽出 scripts/devtools-inspect-guard.mjs，每次页面工具调用前重新列举目标并核对域名；写操作还核对快照 URL 和元素 UID；读取期间 URL 改变则拒绝采用该快照。每次写操作前即失效旧快照，避免超时后拿同一个元素盲目重试。增加了脱敏的工具调用和目标检查日志，不记录消息正文或凭证。

验证：node --test tests/devtools-inspect-guard.test.mjs，5/5 通过；两个脚本 node --check 通过。测试涵盖页面变新标签、BOSS 内部路由变化、读取期间导航、标题伪装 URL 和稳定页面单次点击。此修复只防止在错误页面继续操作，不是已证明能解决页面自行变化的根因。

本次连接已结束，没有搜索成功、没有立即沟通、没有发送常用语。检查当时未发现命令行标识为 Playwright、Chrome DevTools MCP 或 boss/job-search 的残留 Node/Python 进程；这不能排除浏览器扩展或其他来源的影响。当前仍需用包含具体导航事件的记录区分页面脚本、Chrome/控制依赖与其他浏览器组件。
