# 第一周：用 Python 处理岗位，再看懂 LangGraph

## 启动入口

在 PowerShell 运行；本机使用项目内 Python 3.12，不要求全局 python 命令可用。

```powershell
Set-Location D:\code\job-search-skills
.\scripts\jobpilot.cmd learn
.\scripts\jobpilot.cmd demo
```

learn 是普通 Python 函数流程，不调用模型、浏览器或投递账本。demo 是真正的 LangGraph，包含模拟联系，`simulated: true` 不表示实站发送。

默认学习样例 `examples/python/week1-jobs.json` 全部虚构。预期：输入5条，深圳2条，重复1条，异地1条，城市未知1条。正文缺失标成待补充，不当作岗位不匹配。报告在终端打印的位置，每次新建 `output/jobpilot/week1/<唯一ID>/report.json` 和 `report.md`。

```powershell
# 兼容原项目样例；默认直接读取 details 中已有正文
.\scripts\jobpilot.cmd learn --jobs .\examples\jobpilot\jobs.json
# 改条件观察结果
.\scripts\jobpilot.cmd learn --city 北京
```

注意：第一周读取原样例的所有本地 details，不模拟旧 Agent 的 initialDetailIds 可见性规则。

## 七天对应代码

核心文件：`python/jobpilot/week1.py`。每次先读一个函数、自己改样例，再观察结果。

| 天 | Python 知识 | 代码与练习 |
| --- | --- | --- |
| 1 | 变量、字符串、列表、字典 | 打开样例，区分整个 jobs 列表和一个岗位字典；新增一个虚构岗位 |
| 2 | 函数、参数、返回值、模块 | 读 read_jobs；解释 Path、read_text、json.loads 分别做什么 |
| 3 | for、if/elif/else、get | 读 filter_jobs；把目标城市改成北京，推算结果后运行 |
| 4 | set、元组、成员判断 | 读 seen 和 identity；复制岗位链接，观察重复数；删除 ID 和链接看为何保留 |
| 5 | try/except、校验 | 读 text_field 和 run_learning；把 city 改成数字或破坏 JSON，观察非零退出 |
| 6 | 文件、JSON、报告 | 读 write_report；查看 JSON 与 Markdown；自己增加一个报告展示字段 |
| 7 | 整体数据流与测试 | 解释 state 字典如何累积数据，再读 graph.py，对照普通函数和 LangGraph |

验收：能自己修改筛选条件，能预测重复/空列表/缺字段的结果，能解释为什么没有调用模型也能完成这一阶段。

## 状态、节点、边、边界

### 状态 State：当前任务的数据

在 week1.py 的 run_learning 中：

```python
state = {"source": str(Path(root) / args.jobs), "city": args.city.strip()}
state["jobs"] = read_jobs(state["source"])
state["report"] = filter_jobs(state["jobs"], state["city"])
```

这是普通字典，我们自己逐步填入字段。真正的图在 `python/jobpilot/graph.py`：`JobState(TypedDict, total=False)` 描述 resume、mode、roles、jobs、selected、result、error、report。

TypedDict 是类型说明，不会自动生成字段，也不会在运行时验证输入。total=False 表示字段可以尚不存在；访问 state['jobs'] 前要保证前面的节点已写入。

### 节点 Node：执行一件事的函数

graph.py 中的 search_jobs 读取 roles，调用工具，再返回 `{"jobs": ...}`。框架把返回字段合入状态；默认同名字段覆盖，没返回的字段保留。这张图没有自定义 reducer，列表不会自动追加。

```python
def search_jobs(state: JobState):
    try:
        return {"jobs": tools.search(state["roles"])}
    except Exception as exc:
        return {"jobs": [], "error": str(exc) if isinstance(exc, WorkflowError) else "SEARCH_FAILED"}
```

`graph.add_node("search_jobs", search_jobs)` 注册名字和函数。节点可以是纯代码、模型调用或工具调用，不是每个节点都需要一个 Agent。week1.py 的函数尚未注册进图，学习时把它们当业务步骤即可。

### 边 Edge：决定接下来执行谁

graph.py 的固定边：`graph.add_edge(START, "analyze_resume")`。START/END 是入口/结束标记，不是业务工作。

条件边对应这行：

```python
graph.add_conditional_edges("select_job", lambda s: "contact_once" if s.get("selected") and s["mode"] in {"demo", "run"} else "record_result")
```

lambda 是短函数，读取状态返回下一个节点名。preview 即使选到岗位，也走 record_result。compile() 组装图；cli.py 的 stream(..., stream_mode='updates') 执行并逐步打印节点更新。

```text
START → analyze_resume
           ├─失败或无方向───────────────────────────┐
           └─有方向 → search_jobs                  │
                       ├─失败──────────────────────┤
                       └─成功 → select_job         │
                                  ├─preview/无候选─┤
                                  └─demo/run且有候选 → contact_once
                                                   │
                                      record_result → END
```

### 边界 Boundary：哪些输入和动作允许发生

边界不是 LangGraph 的第四种核心对象，而是程序约束。不要与“边”混淆。

| 边界 | 代码 | 行为 |
| --- | --- | --- |
| 数据格式 | week1.py：read_jobs、text_field | 必须有岗位数组，title 非空，字符串字段不能填数字 |
| 业务筛选 | week1.py：filter_jobs | 城市精确相等；未知单列；重复链接保留首条；缺身份不误删 |
| 错误处理 | week1.py：run_learning；graph.py 的 try/except | 离线错误返回1；图内搜索失败转入记录，不继续联系 |
| 外部权限 | graph.py 的条件边；tools.py 的 _send_policy；ledger.py 的 reserve | preview 不进入联系，工具与账本另有发送授权校验 |
| 模块职责 | graph.py / model.py / tools.py / bridge.py | 图管顺序；模型管方向；工具管业务校验；桥管MCP通信 |

本周去重只在一次输入内生效，完整链接按原字符串比较，不自动删除查询参数；缺链接使用 jobId/key；无身份保留并提示。它不替代真实投递的历史账本。

## 启动真实搜索

1. 打开日常 Edge，在已登录的 BOSS 职位页选择深圳，并人工同时选中 1–3 年、3–5 年经验。
2. 在现有 JobPilot 扩展中连接该标签；网页已登录不等于扩展已连接。当前适配器要求 boss-dom-0.6.0；固定扩展目录为 `D:\code\jobpilot-edge`。当前版本说明见 `docs/jobpilot/search-greeting-guide.md` 的“人工设置经验”章节（该文后续 TS 命令属历史入口）。
3. 在项目根目录运行：

```powershell
.\scripts\jobpilot.cmd preview --resume .\private\resume.txt
```

preview 会把指定简历送到本机已配置的模型服务分析方向，再搜索真实页面；读取每个方向两档经验的首屏，不翻完整站点、不打招呼。模型配置从已有 .env 读取，不需要粘贴密钥到命令行。

成功后终端打印搜索报告路径。将那个实际路径传给 learn：

```powershell
# 把下面路径替换为 preview 打印的实际文件路径
.\scripts\jobpilot.cmd learn --jobs 'output\jobpilot\python\实际run_id.json'
```

新报告的 jobs 数组保留全部候选，而 selected 只是原主图挑选的一条。preview 当前仅读取列表，没有抓取全部岗位正文，所以 learn 标记“正文待补充”是正常结果，不是搜索失败。城市取已验证 query.city，没有任何城市信息则保持未知。

常见错误：BOSS_NOT_CONNECTED 或 INVALID_BINDING 先在目标职位页连接扩展；MANUAL_EXPERIENCE_REQUIRED 先选经验；EXTENSION_UPDATE_REQUIRED 核对扩展版本；MODEL_CONFIG_REQUIRED 检查本地模型配置；ANOTHER_RUN_ACTIVE 表示另一任务占用；LEGACY_RUN_LOCK_PRESENT 表示旧文件锁仍存在。先结束旧任务，再核验锁是否失效，不直接删除锁库。网页登录/验证码由本人处理。CLI 是单次任务，结束后退出，不需要常驻服务。

2026-11-02 本轮启动前检查：本地简历存在；旧文件锁存在；桥健康接口可访问，但返回绑定未通过校验（INVALID_BINDING）。因此尚未验证真实岗位搜索成功。学习命令和离线 demo 不受这两项影响。以上是检查时的状态，不是持续监控结果。

## 验证与参考

```powershell
.\.venv-jobpilot\Scripts\python.exe -m unittest discover -s tests/python -v
```

原理参考：[LangGraph Graph API](https://docs.langchain.com/oss/python/langgraph/graph-api)。Python 学习顺序：[官方中文教程](https://docs.python.org/zh-cn/3/tutorial/)。
