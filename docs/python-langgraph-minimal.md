# Python LangGraph：先跑通一条求职闭环

目标是能用 Python 解释并修改一个完整工作流。当前主业务图已经改为 Python LangGraph，浏览器扩展是被调用的工具。第一版不引入 checkpoint、interrupt、多 Agent 或无限翻页。

## 1. 先运行，不接浏览器

在 `D:\code\job-search-skills` 打开 PowerShell。本机环境已装好；新机器需要 Python 3.12，执行一次：

```powershell
.\scripts\setup-jobpilot.ps1
# 找不到 Python 3.12 时手动指定解释器
# .\scripts\setup-jobpilot.ps1 -Python 'C:\path\to\Python312\python.exe'
```

依赖安装到项目内 `.venv-jobpilot`；`requirements-python.lock` 是 Windows / Python 3.12 的固定版本依赖。主框架版本是 LangGraph 1.2.19。安装需要网络，安装后的 demo 不需要网络、浏览器或模型配置。

先跑两节点例子，再跑完整闭环：

```powershell
.\.venv-jobpilot\Scripts\python.exe .\examples\python\01_state_nodes.py
.\scripts\jobpilot.cmd demo
# 兼容入口，同样运行 Python
.\scripts\boss.cmd jobpilot demo
```

demo 依次打印 `analyze_resume`、`search_jobs`、`select_job`、`contact_once`、`record_result`。最后的 `simulated: true` 表示模拟联系。报告写入 `output/jobpilot/python/<run_id>.json`，演示账本放临时目录，不读写真实投递历史。

## 2. 第一阶段：函数、字典、State、Node、Edge

先读 `examples/python/01_state_nodes.py`，再读 `python/jobpilot/graph.py`。

| Python / LangGraph | 用 Java 思维理解 |
| --- | --- |
| `state["resume"]` | 类似 `map.get("resume")` |
| `roles.append(...)` | 类似 `list.add(...)` |
| `def analyze_resume(state)` | 接收流程数据的普通业务方法 |
| `return {"roles": roles}` | 返回需要更新的字段，框架合入状态 |
| `TypedDict` | 描述字典有哪些键和类型；不自动创建字段，也不是运行时校验器 |
| `add_node` | 注册一个业务步骤 |
| `add_edge` | 指定下一步 |
| `compile` | 组装成可执行图 |
| `invoke` / `stream` | 一次执行到结果 / 执行时逐步读取更新 |

这张图有五个业务节点：

```text
START → analyze_resume → search_jobs → select_job → contact_once → record_result → END
```

实际有三个条件分支：分析无方向或失败就记录退出；搜索失败就记录退出；没有候选或处于 preview 时跳过联系。筛选节点还会跳过历史已处理岗位及不符合经验的岗位，每轮只选一个。

练习：在两节点例子里给模拟简历增加或删除 `Java`、`RAG`，观察输出变化；然后去图中找 `add_conditional_edges`，解释为什么 preview 不走联系节点。

## 3. 第二阶段：接入模型和工具

`graph.py` 只编排顺序；模型和浏览器细节放在其他文件中：

| 文件 | 职责 |
| --- | --- |
| `python/jobpilot/model.py` | 真实模式调用一次模型，返回最多三个有简历原文依据的岗位方向 |
| `python/jobpilot/tools.py` | `DemoTools` 模拟岗位；`LiveTools` 搜索、核对岗位和常用语、联系一次 |
| `python/jobpilot/bridge.py` | Python MCP SDK 直接连接现有本地浏览器桥 |
| `python/jobpilot/ledger.py` | SQLite 记录尝试、结果和去重；沿用真实历史 |
| `python/jobpilot/cli.py` | 装配依赖，选择模式，逐步打印节点结果 |

这就是依赖注入：`build_graph(planner, tools, ledger)` 接收不同实现，同一张图既能演示也能接真实工具。demo 中规则判断只是教学替身；真实模式会把简历交给模型分析，不冒充已经调用模型。

模型只决定有限岗位方向，不能改城市、经验、发送上限或常用语。模型输出要经过字段、角色范围和原文证据校验。当前是受控 AI 工作流，可作为 Agent 项目的最小版本；没有实现开放式自主规划或模型任意调用工具。

简历使用 UTF-8 文本文件。真实模式读取本地 `.env` 的 `JOBPILOT_MODEL`、`JOBPILOT_BASE_URL`、`JOBPILOT_API_KEY`；BASE_URL 应包含服务需要的 `/v1` 前缀，客户端会追加 `/chat/completions`。不要把密钥写进代码或文档。

```powershell
# 替换成你真实的 UTF-8 简历文本路径；不发送消息
.\scripts\jobpilot.cmd preview --resume .\private\resume.txt
```

真实搜索还依赖既有本地 MCP 服务与 Edge BOSS 扩展。页面需登录、绑定，加载 `boss-dom-0.6.0` 适配器，并提前人工选好深圳及 1–3、3–5 两档经验。只读模式也会实际切换搜索词；每方向每档读首屏，不做全站搜索。

真实联系使用显式模式，每轮最多一个岗位：

```powershell
.\scripts\jobpilot.cmd run --resume .\private\resume.txt --confirm-send
```

仅当已人工确认历史额度停止属于过期日期且希望重新核验时，加 `--retry-historical-quota`；它不会清除账本中的停止记录，也不会绕过当前页面额度提示。存在未处理停止或未知动作会继续阻止发送。若已有多条常用语快照，可用 `--template-id` 指定已保存的第一条快照；最终仍会核对当前页面第一条正文及哈希，变化就停止。

这里的“投递”目前是打招呼，不自动上传简历附件。程序在打开新沟通前保存意图；发送结果未知则保留记录、不自动补发。之前用户确认跳过的未知岗位仍然跳过。

## 4. 第三阶段：验证闭环，再学恢复

```powershell
.\.venv-jobpilot\Scripts\python.exe -m unittest discover -s tests/python -v
```

测试覆盖实际 LangGraph 节点顺序、preview 分支、失败记录、模型输出约束、共用账本去重、发送上限、并发锁、原请求结果查询、第一常用语变化和未知发送不重试。

本次最终 Python 测试为 18 项通过；统一审查发现的“占位前额度异常未持久化”已补回归并修复。图开始执行后的业务失败会进入记录节点；缺少模型配置、启动连接失败等发生在图启动前的错误，目前只输出错误码并以非零状态退出，不生成完整 JSON 报告。启动失败报告统一化留待后续完善。

SQLite 账本记录“这个岗位是否已经尝试联系”，不是 LangGraph checkpoint。以后再加 checkpoint 保存执行进度；恢复图不等于允许再次发送同一条消息。

推荐学习顺序：两节点例子 → 五节点主图 → 模型调用 → 工具接口和条件分支 → 账本去重 → checkpoint / interrupt。当前 Python 版没有迁移旧 TS 的批量分页、自动恢复和人工审核流程；旧 TS 在 `src/jobpilot/`，显式旧入口为 `boss.cmd jobpilot-ts`，不要与 Python 同时运行。

本次验收区分三件事：离线五节点闭环已运行；真实模型已返回 Java 全栈及 AI 应用方向；真实浏览器发送尚未验收，只读检查被旧任务锁保护拦截。无需先解决浏览器问题，前两阶段的学习可以独立开始。

框架参考：[LangGraph Python Graph API 官方文档](https://docs.langchain.com/oss/python/langgraph/graph-api)。
