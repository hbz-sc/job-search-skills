# 整个项目怎样工作：从命令到实战

## 2026-11-04：方案 A 的新入口

代码已增加独立的实战入口，不再需要用带默认样例的学习命令做实战。

```powershell
Set-Location D:\code\job-search-skills
.\scripts\jobpilot.cmd check-model
.\scripts\jobpilot.cmd analyze --resume .\private\你的简历.txt --jobs .\private\真实岗位.json --limit 3
```

第二条中的文件名是占位说明，请替换为实际资料路径。check-model 发起一次小型模型请求，不发送简历和岗位；analyze 最多分析指定数量的合格岗位，两条命令都可能产生 API 费用。analyze 不会自动再做一次诊断。旧的 private/real-practice-20261103/jobs.json 是人工摘要，新实战入口会要求补充完整正文。

2026-11-04 本轮实测：旧配置返回 MODEL_AUTH_FAILED（HTTP 401）；用户提供新 Key 并明确授权更新后，已更新本地 .env，check-model 诊断成功。环境变量优先于 .env，check-model 会显示配置来源而不显示 Key。请在本地维护凭据。没有有效 Key 时，仍可使用 learn / learn-graph 离线学习。

### 真实岗位文件

每条岗位需要 title、company、city、url、capturedAt、description、description_kind。jobId 和 salary 可空。下面只是字段格式示意，不是真实岗位，不可用于实战验收：

```json
{
  "jobs": [{
    "jobId": "来源中的岗位编号",
    "title": "页面岗位名称",
    "company": "页面公司名称",
    "city": "深圳",
    "salary": "",
    "url": "https://example.com/jobs/123",
    "capturedAt": "2026-11-04T10:00:00+08:00",
    "description_kind": "original_full",
    "listing_status": "unverified",
    "description": "此处放自己已核验的完整岗位正文，不放摘要"
  }]
}
```

description_kind 只能是 original_full（完整原文）或 summary（摘要）；程序不能自动证明完整性。摘要列为待补资料，不调用模型。listing_status 为 observed_open（采集时页面显示在招）、closed（已关闭）或 unverified（未核实，默认）；已关闭项跳过。缺字段列出具体问题，其他合格岗位继续；非法 JSON 或字段类型错误会停止整批。

### 你能看到的进度

```text
实战模式；简历：...；岗位：...
[load_inputs] 执行结束
正在分析 1/3：岗位名称；请求 1/3
本项结果：matched；耗时 ... 秒
...
已分析 ...；信息不足 ...；失败 ...；未执行 ...
[报告] .../report.json
[阅读版] .../report.md
```

请求使用 45 秒网络操作超时，不是整批的总时限。401/403/404/429 会停止后续请求并保留已有结果；单项超时、服务端错误或证据错误记录后继续。没有自动重试。已分析与信息不足可能交叉，例如模型完成分析但仍有 unknown 要求。Ctrl+C 返回 130，本阶段不保证中断后报告保存或断点续跑。

### 对应代码怎样读

1. `cli.py:main`：把 check-model / analyze 命令交给 `practice.py`。
2. `model_connection.py:load_model_config` / `validate_model_config`：读取配置并检查连接边界；`request_json` 做一次真实 HTTP 请求；`error_info` 把固定错误码转成可操作提示。
3. `practice_inputs.py:read_practice_jobs`：把实战 JSON 转成规范岗位字典，保留来源，列出缺失项。
4. `week3.py:AnalysisState`：状态，就是节点之间传递的字典；包含简历、筛选结果、分析结果、调用次数和报告路径。
5. `week3.py:load_inputs` → `analyze_batch` → `save_analysis`：三个节点分别读资料、逐岗分析、保存报告。
6. `week3_model.py:validate_analysis`：模型输出进入程序的边界；校验结构、JD引用、简历引用及未知项追问。
7. `practice.py:print_progress` / `stream_analysis`：显示逐岗事件和最终状态，不负责推断匹配。

实际构图调用是：

```python
graph = build_analysis_graph(
    analyzer, job_reader=read_practice_jobs, progress=print_progress
)
```

build_analysis_graph 内的普通边 `START → load_inputs`、`analyze_jobs → save_report → END` 决定顺序；load_inputs 后的条件边检查 error，有错误直接 END，否则进入 analyze_jobs。逐岗循环在 analyze_batch 内，不是每个岗位一个固定节点。读取函数、分析器、进度回调通过参数传入，测试因此可以换成离线实现；实战使用真实 HTTP 分析器。

报告中的 completed 只代表应执行分析完成；needs_info 表示有信息待确认（包括零可分析项）；partial 包括部分失败或预算未处理完；failed 表示失败。completed/needs_info 退出0，partial/failed退出1，参数错误退出2。读取失败可能没有报告，开始批次后的可处理模型错误会写入报告。

本阶段不调用 BOSS；BOSS 搜索到完整 JD 的衔接仍属于下一阶段。

### 本轮实战发现的两个兼容问题

1. 默认思考可能把输出预算用完，正文为空。实测后，程序只针对配置中的百炼 deepseek-v4.1-flash-1017 关闭思考；其他模型不注入该扩展参数。若服务仍返回 finish_reason=length，报告 MODEL_OUTPUT_TRUNCATED，不把截断 JSON 当作完整结果。
2. 完整 JD 的职责、要求和加分项可超过20项。Analysis 现在允许最多40项，保留所有返回项和原文证据校验，禁止通过裁掉要求来制造成功。

兼容性参考：[阿里云 DeepSeek API](https://docs.bailian.console.aliyun.com/zh/model-studio/deepseek-api)。本轮是否成功以实际报告为准，诊断成功不能替代岗位分析验收。

本轮最终报告：`output/jobpilot/week3/d5c0ff0b55b44981a64a019033500927/report.md`。3次请求，2个岗位完成分析并有待确认项，1个岗位因简历引用校验失败被拒绝，整体 partial。真实验收尚未全部通过，不会靠删除失败项或重复请求来宣称成功。人工复核说明在 `private/real-practice-20261104/review.md`，其中指出部分“matched”的引用不足以证明复合要求全部满足。

## 先认清三个层次

1. learn：第一周，用本地岗位文件练Python读取、筛选、去重；不调用模型。
2. learn-graph：第二周，用LangGraph执行相同业务并演示缺正文分支；不调用模型。
3. learn-model：第三周，用模型把本地JD与本地简历比较。模型是真实的，输入是不是实际资料取决于--resume和--jobs。不传参数时仍是examples里的虚构资料。

已有preview是另一条真实网站搜索入口。它连接BOSS扩展、读取简历规划方向、搜索岗位列表，不发送消息；当前尚未自动把每条岗位完整正文接入learn-model。因此“第三周完成”指资料分析阶段完成，不代表整个自动求职流程已打通。

## 你当前执行的命令

```text
PowerShell
  → scripts/jobpilot.cmd（选择项目Python并切换工作目录）
  → python -m jobpilot
  → python/jobpilot/__main__.py
  → cli.py 的 main（根据第一个词选择流程）
  → week3.py 的 run_model_learning
  → 读取 .env，创建模型接口
  → 构造 LangGraph并运行
```

## 分析图的数据流

```text
输入文件：简历.txt + 岗位.json
  ↓ load_inputs
读取、校验、常见联系方式替换、按城市筛选、去重
  ↓ analyze_jobs
每个有正文的岗位：
  组装system规则和user资料 → HTTP发给模型 → 返回JSON
  → Pydantic检查字段类型 → 核对JD和简历引用
  → 分类为有证据匹配/明确缺口/信息不足
  ↓ save_report
写 report.json + report.md
  ↓ END
返回PowerShell提示符
```

State装数据，Node做工作，Edge决定顺序；模型是其中一个节点调用的服务，不是LangGraph本身。

### load_inputs：准备数据

源码：python/jobpilot/week3.py。

```python
filtered = filter_jobs(read_jobs(state['source']), state['city'].strip())
return {'resume': redact(resume), 'filtered': filtered, 'error': ''}
```

source来自--jobs，resume_path来自--resume。这里读的是文件，不会访问招聘网站。截图中的[load_inputs]完成就停在这个阶段之后，不能据此认为分析完成。

### analyze_batch：真正调用模型

```python
data = analyzer(state['resume'], description)
analysis = validate_analysis(data, state['resume'], description)
```

analyzer在week3_model.py中创建，使用.env中的JOBPILOT_MODEL、JOBPILOT_BASE_URL和JOBPILOT_API_KEY。system消息规定分析规则，user消息装简历和JD，POST到/chat/completions。密钥放请求头，不放提示词。

目前一个岗位一次请求，逐个处理。节点内已增加逐岗开始、结束和耗时输出，整批节点返回后再输出汇总。

### validate_analysis：不能直接相信模型

```python
analysis = Analysis.model_validate(data)
if item.job_quote not in description:
    raise WorkflowError('JOB_EVIDENCE_INVALID')
```

完整实现还校验简历引用、未知项追问、重复项。Pydantic检查结构，字符串检查引用存在；两者都不能证明语义判断正确，最终仍需你复核。

### save_analysis：结果才在这里落盘

report.json供程序读取，report.md供你阅读，都在output/jobpilot/week3/<本次ID>/。没有发送给招聘方。

| 状态 | 含义 |
| --- | --- |
| completed | 所有应处理项完成，不等于适合所有岗位 |
| needs_info | 分析已完成，但有问题需要确认 |
| partial | 有失败项或因limit未处理完 |
| failed | 分析失败，应看错误原因 |

输出报告路径并返回命令提示符，说明命令结束；还要看状态才知道是否全部成功。

## 真正求职需要什么

```text
真实简历
  → 确定方向
  → 招聘网站搜索真实岗位
  → 获取完整JD、公司、地点、薪资和链接
  → 整理为带来源的jobs.json
  → learn-model对照真实简历分析
  → 人工复核要求、缺口、在招状态和用工条件
  → 你决定沟通/投递
```

网站搜索相关代码：model.py规划方向，tools.py的LiveTools.search调用网页工具，bridge.py通过MCP连接本地扩展。业务graph.py负责搜索流程顺序；preview走记录分支，不进入contact_once。

2026-11-03检查时BOSS桥返回BOSS_NOT_CONNECTED，private/boss-run.lock仍存在。需要恢复扩展连接并核验旧任务后，才能进行这条网站搜索流程；不要直接删除锁库。当前实战先使用已核验的公开招聘页面作为来源。

## 历史真实资料尝试（摘要输入，仍可用学习入口）

```powershell
Set-Location D:\code\job-search-skills
.\scripts\jobpilot.cmd learn-model --resume .\private\real-practice-20261103\resume.txt --jobs .\private\real-practice-20261103\jobs.json --limit 1
```

resume.txt取自profile指定的较新Word简历，保留原文件。jobs.json是宏远科创在深圳南山的AI应用开发岗位，带来源链接和整理日期，JD为人工整理摘要。模型报告的JD引用指输入摘要，最终要求以招聘页面为准。岗位是否继续接受投递需招聘方确认。

真实信息存private，报告存output；不提交Git，不自动发消息。每运行一次这条命令会调用真实模型并产生API费用，已有报告可以直接打开，无需重复运行。

## 2026-11-03 历史实战结果

用户截图对应的最新样例报告d1375c2cbdf04bd2bc4856fb707c5037已结束，状态needs_info，两次调用无失败。

本轮真实资料请求失败。诊断接口明确返回HTTP401；不是模型还在运行，也不是已完成分析。当前.env的Key有百炼Key外形，但不代表有效；无环境变量覆盖。没有替换或输出密钥。已增加MODEL_AUTH_FAILED及可操作提示，并用离线HTTP测试覆盖。

需在百炼控制台核验/重新创建对应地域的API Key，更新本地.env的JOBPILOT_API_KEY；AccessKey Secret不能替代该接口的百炼API Key。更新后可用上面的真实资料命令重跑。原始失败报告保留于output/jobpilot/week3/e6c0ce50896648be92a583bc6e45623b。
