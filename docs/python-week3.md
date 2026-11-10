# 第三周：模型、消息与有证据的结构化分析

## 运行

```powershell
Set-Location D:\code\job-search-skills
# 使用仓库内虚构简历、两个虚构岗位，最多2次真实模型请求
.\scripts\jobpilot.cmd learn-model --limit 2
# 离线自动测试：注入测试响应，不消耗API费用
.\.venv-jobpilot\Scripts\python.exe -m unittest discover -s tests/python -p test_week3.py -v
```

命令使用已有 .env 的 JOBPILOT_MODEL、JOBPILOT_BASE_URL、JOBPILOT_API_KEY，环境变量优先。默认limit=1，因此默认两个样例中第二个会标为deferred，整批partial并退出1。这是明确报告未处理完，不是假装整批完成。

没有模型配置时返回 MODEL_CONFIG_REQUIRED；不自动改用模拟结果。请求使用兼容 /chat/completions 接口，开启 JSON object 输出；供应商不支持该参数、网络超时或返回格式错误都会记录失败，不自动重试。每次请求超时45秒，最多4000输出token。

自选资料：

```powershell
.\scripts\jobpilot.cmd learn-model --resume .\private\resume.txt --jobs .\private\jobs.json --limit 3
```

此命令会把简历和待分析的JD发送给配置的模型服务。代码只替换常见邮箱和大陆手机号，不是通用脱敏；使用真实资料前请人工脱敏。报告保留证据摘录，不保存完整简历或模型原始响应，仍属于私人材料。没有浏览器、打招呼或简历投递操作。

## 流程和模块

```text
START → load_inputs
           ├─输入错误 → END
           └─成功 → analyze_jobs → save_report → END
```

| 模块 | 文件/函数 | 学什么 |
| --- | --- | --- |
| 类型合同 | week3_model.py：Requirement、Analysis | Pydantic BaseModel、Field、Literal、ConfigDict |
| 提示词和消息 | SYSTEM_PROMPT、create_analyzer | system规定任务；user装载JSON资料；一次请求输出要求与比较结果 |
| HTTP模型接口 | create_analyzer内部analyze | 请求参数、超时、JSON解码、错误脱敏 |
| 证据校验 | validate_analysis | 校验类型、必填字段、引用是否出现在来源、未知项是否有追问 |
| 图状态 | week3.py：AnalysisState | 在TypedDict里增加简历、分析结果、调用次数 |
| 读取节点 | load_inputs | 复用第一周读取/筛选，简历和每岗JD限制20000字 |
| 分析节点 | analyze_batch | 遍历候选、调用模型、校验、分类、捕获单岗失败 |
| 报告节点 | save_analysis | 保存匹配/缺口/待确认和失败原因 |
| 构图与入口 | build_analysis_graph、run_model_learning | 注入真实或测试analyzer；stream逐节点输出 |

模型接口单独放一个文件，图只需要知道 `analyzer(resume, description)` 返回字典。这就是依赖注入：测试可替换外部服务，仍执行真实状态图、校验和报告逻辑。

## 从 TypedDict 到 Pydantic

第二周的TypedDict描述图状态，但不会自动校验值。第三周的Pydantic用于不可信的模型响应：

```python
class Requirement(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    status: Literal['matched', 'gap', 'unknown']
    # 其余字段见源码

analysis = Analysis.model_validate(data)
```

strict避免隐式类型转换，extra='forbid'拒绝未知字段，Literal限定三个结论值。Schema会通过model_json_schema生成并放入system提示词，但提示词本身不是保证，所以响应后仍必须model_validate。

## 三种判断不能混淆

| 判断 | 意义 | 证据要求 |
| --- | --- | --- |
| matched | 有经历支持该项要求 | JD引用 + 简历引用 |
| gap | 简历明确说明不具备该要求 | JD引用 + 简历中的明确缺口引用 |
| unknown | 未提及、证据不够或无法判断 | JD引用 + 待确认问题，简历引用为空 |

例如JD要求模型训练，简历写“尚无模型训练经验”可判gap；简历根本没说训练，应判unknown，不能推断不会。

每条job_quote必须是JD中的连续原文，matched/gap的resume_quote必须是简历中的连续原文；引用基于发给模型的同一份脱敏文本验证。同一原句可以支持两个不同要求，但同名要求与同一引用重复出现会被拒绝。

**限制：原文存在不证明原文支持结论。** 否定语义、要求遗漏、引用是否足够充分，仍要人工核对，报告固定标记review_required=true。Schema校验不是“模型判断正确率”的证明。

## 分类和错误

- 城市未知：unknown_city单列，不调用模型。
- 缺正文：needs_info，提示补正文，不占模型额度。
- 超过本轮limit（1至10）：deferred，不偷偷调用剩余岗位；调用失败也占本轮一次次数。
- 单岗有效要求为空：needs_info，提示人工检查，不能判全部匹配。
- 接口失败：MODEL_CALL_FAILED；类型或字段错误：MODEL_OUTPUT_INVALID；引用不在原文：JOB_EVIDENCE_INVALID / RESUME_EVIDENCE_INVALID。
- 一个岗位失败不丢掉其他岗位结果。整批无失败且全部处理完成为completed（仍可能有has_gaps岗位）；有待确认项为needs_info；有失败或尚未处理完为partial；全部失败为failed。
- CLI的failed/partial退出1，completed/needs_info退出0。输入错误在图的load_inputs后结束，不生成成功报告。

每次报告独立保存在 output/jobpilot/week3/<唯一ID>/report.json 和 report.md。文件写入不是事务，磁盘错误可能留下部分目录。

## 练习

1. 先看消息里的role与content，再看一份真实输出，分清JSON字符串与Python字典。
2. 看Requirement，尝试在测试响应中增加未知字段或拼错status，观察校验失败。
3. 将resume_quote改成不存在的项目经历，观察证据校验拦截。
4. 看analyze_batch：为什么缺正文跳过调用，失败却不能退回调用次数？
5. 用虚构材料分别表达“做过”“没做过”“没提及”，对照三种结论并人工审核理由。
6. 读测试里的httpx.MockTransport：替换的是网络边界，请求构造与响应处理仍跑生产代码。
7. 自己解释“字段合法、原文存在、语义正确”为什么是三种不同检查。

参考：[Pydantic 模型文档](https://docs.pydantic.dev/latest/concepts/models/)。

## 本轮验收（2026-11-03）

Python全部40项测试通过，其中第三周10项。真实接口最终两次请求均通过结构与原文校验，输出needs_info报告，CLI退出0；没有真实招聘页面操作。早期实测出现过引用/结构不合规并被拒绝；通过一次不保证后续输出稳定。真实样例中的gap分支未出现，由离线测试中的明确缺少模型训练经验覆盖。
