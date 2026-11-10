# 第二周：从普通 Python 函数到 LangGraph

本周目标：能解释状态字段从哪里来、节点更新什么、下一步为什么走这条边。使用已安装的 LangGraph，无需安装新依赖，不调用模型、浏览器或真实投递账本。

## 1. 先运行两个分支

```powershell
Set-Location D:\code\job-search-skills
# 默认样例有一条深圳岗位缺正文
.\scripts\jobpilot.cmd learn-graph
# 原有样例有两条深圳岗位，正文都在 details 中
.\scripts\jobpilot.cmd learn-graph --jobs .\examples\jobpilot\jobs.json
```

第一条打印：`load_jobs → filter_jobs → mark_missing → save_report`，状态 needs_info。
第二条打印：`load_jobs → filter_jobs → save_report`，状态 completed。

报告位于 `output/jobpilot/week2/<唯一ID>/report.json` 和 `report.md`。终端会打印完整路径。needs_info 表示本次报告有待补资料，程序正常退出0；它不是等待进程，也不是 LangGraph interrupt。补好原输入后重新运行，会产生一份新报告。

可继续使用第一周 `learn` 对比；`demo` 是另一张业务图，不是本周教学图；真实岗位搜索仍用已有 `preview`，本周命令不会搜索网站。

## 2. 本周文件

| 文件 | 用途 |
| --- | --- |
| python/jobpilot/week2.py | 状态、4个节点、2个路由函数、组图和运行入口 |
| python/jobpilot/week1.py | 复用 read_jobs 与 filter_jobs，无需重写文件读取和去重 |
| python/jobpilot/cli.py | 将 learn-graph 转交给本周入口 |
| tests/python/test_week2.py | 验证完整/缺正文分支、错误退出、空列表、未知城市和离线运行 |

## 3. State：节点共享的数据

打开 week2.py 的 LearningState。TypedDict 说明字典中有哪些键与类型；total=False 表示某些键可在后续步骤产生，不会自动赋值，也不会在运行时校验。

| 字段 | 谁产生 | 谁读取 | 含义 |
| --- | --- | --- | --- |
| source、city、root | CLI | 读取、筛选、输出节点 | 输入路径、目标城市、报告根目录 |
| jobs | load_jobs | filter_jobs | 校验后的全部输入岗位 |
| report | filter_jobs，最后由 save_report 扩充 | save_report | 统计、符合城市的岗位、城市未知项 |
| ready_jobs | filter_jobs | save_report | 去重后城市符合且有正文的岗位 |
| needs_description | filter_jobs | 条件边、mark_missing、save_report | 城市符合但缺正文的岗位 |
| notices | filter_jobs 初始化，mark_missing 填入 | save_report | 可读的正文补充任务 |
| error | load_jobs | route_after_load、CLI | 读取或校验错误 |
| visited_nodes | 每个节点 | 下一节点、报告 | 实际节点执行顺序 |
| status、report_path | 输出节点；读取失败时也写status | CLI | 最终状态、报告位置 |

注意三种不同的 jobs：state.jobs 是全部输入；state.report.jobs 是城市符合的去重结果；state.ready_jobs 进一步要求正文齐全。正文齐全不代表简历匹配。

节点返回的是局部更新，例如 `return {"jobs": jobs}`。LangGraph 合并该字段，保留未返回的 source/city/root。没有自定义 reducer 时，同名字段默认覆盖。代码用 `state['visited_nodes'] + ['filter_jobs']` 构造新列表，显式保留之前的轨迹；不是框架自动追加。

## 4. Node：普通业务函数

### load_jobs_node

读取 source，复用第一周 read_jobs，得到标准格式岗位。顺便校验目标城市。失败时返回 error 和 failed 状态；后面的路由让图结束。

### filter_jobs_node

复用第一周的城市筛选和判重，再用普通 for/if 将目标城市岗位分成 ready_jobs 和 needs_description。异地岗位不会因为缺正文而进入正文补充清单；城市未知项保持在 report.needs_info 中。

### mark_missing_node

将 needs_description 转成“请补充岗位正文：标题（链接或ID）”。不补写、不调用模型猜测正文，不修改原文件。

### save_report_node

将分类、统计、补充清单、执行轨迹写为 JSON 和 Markdown。有正文或城市待补项时状态为 needs_info，否则 completed。零候选也可 completed，含义是处理完成，不是找到合适工作。

## 5. Edge：把函数连起来

build_learning_graph 注册节点时传函数对象，不加调用括号：

```python
graph.add_node("load_jobs", load_jobs_node)
graph.add_edge(START, "load_jobs")
```

START/END 是入口和出口标记，不是业务函数。

路由函数不执行工作，只返回分支标签：

```python
def route_after_filter(state: LearningState):
    return "missing" if state["needs_description"] else "ready"

graph.add_conditional_edges(
    "filter_jobs",
    route_after_filter,
    {"missing": "mark_missing", "ready": "save_report"}
)
```

分支标签 missing/ready 和节点名是两回事，由字典建立对应关系。普通固定边则不做判断。

```text
START → load_jobs
           ├─错误 → END（CLI报错，退出1）
           └─成功 → filter_jobs
                       ├─缺正文 → mark_missing ─┐
                       └─正文齐全───────────────┤
                                           save_report → END
```

`compile()` 组装可执行图，尚未读取岗位。`stream(initial_state, stream_mode='updates')` 才开始运行，每次返回刚完成节点的局部更新。CLI 用这些事件打印节点名称；不把终端输出当作状态来源。

## 6. 边界与错误

- 输入和去重规则沿用第一周：title 必填，文本字段类型必须正确；缺城市保持未知，不默认深圳；完整链接精确判重，没有链接则按ID；身份全缺失保留并标记。
- 读取异常、坏JSON、字段错误：错误信息进入error，图不执行筛选和报告，CLI退出1。
- 写报告失败：CLI报告文件错误并退出1；文件写入不是事务，遇磁盘/权限故障可能留下部分目录，不保证原子写入。
- 图只处理一个批次，不做并行、循环、多Agent或恢复；没有模型调用、网页操作和发送入口。
- 第一周数据格式完全兼容，真实preview报告也可以作为--jobs输入；列表搜索通常没有正文，所以进入待补充分支是正常结果。

## 7. 七天练习

1. 运行两条命令，在报告里找到 visited_nodes，画出执行顺序。
2. 读 LearningState，预测执行读取节点后哪些字段已存在。
3. 读 load_jobs_node，解释为何只返回jobs也不会丢失city。
4. 读 filter_jobs_node，对照第一周：业务函数没变，谁负责执行顺序变了。
5. 复制虚构样例，给 learn-ai 增加 description。运行后mark_missing应消失；城市未知项仍让状态保持needs_info。
6. 把未知城市岗位补成深圳且加正文。状态应变completed；删掉title则应清楚报错。
7. 自己新增一个统计字段，例如正文齐全数；解释由哪个节点产生、哪个节点读取，并检查报告。

不要用“能跑”替代“理解”：应能回答路由为何不修改状态、正文齐全与城市已知有何区别、needs_info为何仍正常退出。

```powershell
.\.venv-jobpilot\Scripts\python.exe -m unittest discover -s tests/python -p test_week2.py -v
# 全部Python回归
.\.venv-jobpilot\Scripts\python.exe -m unittest discover -s tests/python -v
```

参考：[LangGraph Graph API](https://docs.langchain.com/oss/python/langgraph/graph-api)。
