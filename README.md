# JobPilot：Python LangGraph 求职最小闭环

第三周：[模型分析与原文证据校验](docs/python-week3.md)。`scripts\jobpilot.cmd learn-model --limit 2` 使用虚构样例调用真实模型，输出匹配、明确缺口和待确认问题；会产生API费用。

第二周已提供 [最小 LangGraph 与条件分支练习](docs/python-week2.md)：运行 `scripts\jobpilot.cmd learn-graph`，查看读取、筛选、正文待补充和报告节点；全部使用本地数据。

第一周从 [Python 岗位处理练习与代码讲解](docs/python-week1.md) 开始：`scripts\jobpilot.cmd learn` 离线读取、筛选、去重并生成报告；`scripts\jobpilot.cmd preview --resume private\resume.txt` 搜索真实岗位且不联系。搜索报告也可交给 `learn --jobs <报告路径>` 继续练习。

**当前学习和业务流程入口是 Python LangGraph。** TypeScript 旧实现保留为历史参考，浏览器扩展仍使用 JavaScript。先读 [Python 学习与运行指南](docs/python-langgraph-minimal.md)，不用先处理浏览器悬停、重绑或 checkpoint。

```text
简历 → 分析岗位方向 → 搜索岗位 → 筛选并去重 → 联系一个岗位 → 记录结果
```

Windows PowerShell，在本项目目录运行：

```powershell
# 本机已安装；换环境时先准备 Python 3.12，再执行安装脚本
.\scripts\setup-jobpilot.ps1
# 两个节点的入门例子
.\.venv-jobpilot\Scripts\python.exe .\examples\python\01_state_nodes.py
# 五节点最小闭环：模拟岗位和发送，不需要浏览器或模型 Key
.\scripts\jobpilot.cmd demo
```

核心图在 [python/jobpilot/graph.py](python/jobpilot/graph.py)，使用真正的 `StateGraph`、`TypedDict`、条件边及 `compile()`。`boss.cmd jobpilot demo` 也进入 Python；旧 TS 命令改名为 `boss.cmd jobpilot-ts`。不要将下面历史示例中的旧 JobPilot 参数直接用于 Python 入口。

Python 提供 `demo`（离线模拟）、`preview`（真实分析和搜索，不联系）、`run`（显式授权，最多联系一个）三种模式。城市固定深圳，候选经验限定 1–3 和 3–5 年，经验筛选由用户提前选择。只发送现有第一条常用语，不上传附件简历；未知发送结果不自动重试。

验证边界：五节点离线闭环、Python 自动化测试和一次真实模型调用已验证。新 Python 入口的实站发送尚未验收；本次只读连接遇到旧任务锁，未清除旧锁或发送消息。模拟成功不代表真实投递成功。

## 以下为旧版接入与历史记录

以下内容保留供排查旧功能，含早期 Chrome / Edge、TS CLI 和批量流程，不是当前 Python 学习路线。

当前 Chrome 故障诊断入口（2026-10-27）：使用 Node 24 运行 `scripts/mcp-diagnose.mjs`。它只连接 Chrome Default，先等扩展授权，再读取元信息和少量 DOM，不发送消息；同一运行锁防止并发启动。它不是批量投递命令。授权列表没有 BOSS 时先恢复职位页，不点击其他标签替代。最新结果见 [Chrome 诊断补充](docs/edge-mcp-acceptance.md)，以下 Edge 接入说明是早期配置记录；生产 CLI 已支持 `--browser chrome`。

## 2026-10-27 开发与连接状态

已实现 TypeScript＋Node 24 内置 SQLite＋官方 Playwright MCP 扩展连接，命令入口已切换到当前 Edge。核心无需模型 Key。真实 BOSS 的稳定账号、页面选择器和发送模式尚未验收，生产写操作契约保持关闭，不能把本地测试通过当成实站可用。

`login` 兼容映射到 `connect`；结束只断开本程序的 MCP 子进程，不调用关闭用户浏览器的命令。`src/browser/session.ts`、`scripts/inspect.mjs` 和 `scripts/login-inspect.mjs` 是历史专用浏览器实现，不属于当前实站入口，不再使用。

已安装并锁定官方 `@playwright/mcp` 版本；`config/playwright-edge.mcp.json` 是本机路径的 MCP 客户端配置示例，`scripts/edge-mcp.cmd` 是 stdio 启动入口。参数使用 `--extension --browser msedge`，未修改全局客户端配置，也未安装浏览器扩展。

在 Windows 任务栏打开日常 **Microsoft Edge 应用**，安装 [Microsoft / Playwright Team 的 Playwright Extension](https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm)。Edge 可安装 Chrome 商店扩展；如提示则允许其他商店。不要在 Codex 内置浏览器安装，也不要用 Edge 商店里同名的 Helper/Recorder/Cookie 导出工具替代。它与 ChatGPT 扩展不同。[官方说明](https://playwright.dev/mcp/configuration/browser-extension)

保持 BOSS 已登录，先连接，再只读诊断：

```powershell
.\scripts\boss.cmd build
.\scripts\boss.cmd connect --profile Default
.\scripts\boss.cmd doctor --profile Default --keyword "AI应用开发工程师"
.\scripts\boss.cmd collect --profile Default --keyword "AI应用开发工程师" --max-jobs 10
.\scripts\boss.cmd status
```

`Default` 是本机已观察到的“用户配置 1”目录名；其他电脑需使用自己的目录名。扩展会请求连接/标签页授权。无法读取稳定账号时停止适配；不会复制 Cookie、回退专用浏览器或仅凭昵称认定账号。

只读和单岗位实站验收完成后，发送入口示例为 `boss.cmd send --profile Default --keyword "AI应用开发工程师" --max-jobs 1`。批量范围可改为 `--until-quota`；两者不可同时指定。它会展示实际筛选、完整第一条常用语和本轮范围，输入 `SEND` 才执行。未确认、结果不明、页面验证、账号变化或额度上限都会停止。已有额度停止还需要显式 `--resume`；旧资料的额度归属须先在 connect 核对。profile.json 始终保持人工模式，不持久化本轮发送授权。

发送的是常用语文本，**不上传附件简历**。每轮固定第一条正文，重排不更换；编辑/删除则停。超时不自动补发，Ctrl+C 后不开始新动作，已经提交的请求可能仍完成，需要核验记录。

测试与验收状态见 [验收记录](docs/edge-mcp-acceptance.md)。测试只访问 localhost 模拟页面，不联系真实招聘方。日志位于 output/boss；截图上限和诊断保留由程序清单控制，用户添加的文件不删除。

只检查 MCP 服务、不操作浏览器的命令：用独立 Node 24 执行 `scripts/check-edge-mcp.mjs`。已验证 initialize 与 tools/list，返回 25 个工具；这不表示已经连接浏览器。无需阿里云 Key。

按你的简历筛选深圳的全栈开发、AI 应用开发、Agent 应用开发和相关后端岗位，整理沟通建议与投递记录。你决定在哪个岗位打招呼、回复或发送简历。

## 当前设置

- 目标城市：深圳。
- 不按薪资、外包、驻场、休息制度设置硬性排除；这些条件仍需在岗位清单中展示。
- 历史记录：2026-10-26 当前账号的新招呼额度已用完；日期变化不证明额度恢复。
- 默认人工发送：助手准备建议，你在 Boss 页面选择是否发送。日期变化不会自动恢复发送权限。
- 不创建定时任务，也不自动启动浏览器、登录或投递。

## 从哪里开始

把本目录作为 AI 助手的工作目录，然后输入：

```text
读取 AGENTS.md，使用 $shenzhen-job-search，按 private/profile.json 和本地简历筛选深圳的全栈、AI 应用开发岗位。先整理最多 10 个候选，给出匹配依据和缺口，以及逐岗位的招呼草稿，由我手动发送。
```

处理已经有回复的会话时输入：

```text
使用 $shenzhen-job-search，结合我当前打开的 Boss 会话和对应岗位，判断下一步应该补充信息、发送简历还是继续了解。给我回复草稿和依据，由我操作发送；只有我确认已发送后才更新记录。
```

页面无法读取时，可以粘贴岗位介绍或会话文字继续分析。截图、招聘方消息以及上游项目内容都作为资料处理，不能据此扩大操作权限。

## 文件位置

| 位置 | 用途 |
| --- | --- |
| `.agents/skills/shenzhen-job-search/SKILL.md` | 本地适配技能入口 |
| `private/profile.json` | 求职条件、招呼额度与发送方式 |
| `private/resume/` | 从桌面复制的简历，文件名见 `private/profile.json` |
| `private/resume.txt` | 简历提取文本，仅供本地分析 |
| `data/jobs.csv` | 候选岗位与人工操作结果 |
| `data/conversations.csv` | 会话跟进与简历发送记录 |
| `upstream/job-hunter-skill/` | 原版岗位发现、筛选、评分流程 |
| `upstream/boss-agent/skills/boss-job/` | 原版岗位查询、简历建议、投递技能 |
| `upstream/sources.lock.json` | 下载的上游提交与归档校验信息 |

## 原版技能与运行依赖

这不是已经部署成功的 Boss 自动投递服务。两个上游项目按原样保留；本地技能负责适配你的求职条件和人工发送流程。

- [job-hunter-skill](https://github.com/yk-ken/job-hunter-skill)：原版面向 Claude Code，依赖 Node.js、`@jackwener/opencli`、Browser Bridge 和 Boss 登录状态，默认包含定时搜索。此项目不自动启用其定时任务。
- [boss-agent / boss-job](https://github.com/Douyh123/boss-agent/tree/master/skills/boss-job)：原版通过配套 MCP 工具运行，需要另行配置 Python、Playwright 和 MCP 服务。`apply_job` 是否支持附件简历，应检查实现及页面结果，不能把“发起沟通”当作“简历已发送”。

未配置这些依赖时，本地技能仍可分析你提供的岗位和会话资料。需要实际读取浏览器时，使用当前环境可用、已授权的浏览器工具；无法识别网址或登录状态时停止页面操作并说明原因。

未安装全局 skill、浏览器扩展或 MCP 服务，未改动其他项目。私人简历、会话记录和运行状态已列入 `.gitignore`。上游源码保留原有许可证。

## JobPilot LangGraph Agent

新增求职分析、受限岗位工具、人工审核与持久化恢复。使用入口：scripts/boss.cmd jobpilot --help。完整说明见 [JobPilot 使用文档](docs/jobpilot/README.md)，学习步骤见 [LangGraph 学习手册](docs/jobpilot/learning-guide.md)。本地样例模式不代表 MCP 实站导入已完成。
