# 真实岗位分析修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking. 本计划建议由当前代理顺序执行，最后独立审阅。

**Goal:** 让真实简历和有来源的完整岗位正文可以被可靠分析，并让用户看得懂进度、错误和证据报告。

**Architecture:** 新增实战 CLI 和输入校验层，复用第三周 LangGraph、证据校验及报告能力。模型诊断与分析共享配置和错误分类；逐岗进度通过可注入回调输出，不依赖新的 LangGraph API。

**Tech Stack:** Python 3.12、现有 langgraph/httpx/python-dotenv/Pydantic，unittest 与 httpx.MockTransport；不增加依赖。

**Spec:** [2026-11-04-real-job-analysis-repair-design.md](../specs/2026-11-04-real-job-analysis-repair-design.md)

## Global Constraints

- 本次实施范围为方案 A 的第一阶段：本地真实资料分析。
- 不自动联系招聘方、不投递、不改简历、不操作 BOSS 任务锁、不安装或启动网站桥服务。
- 测试允许使用固定样例，实战验收必须使用真实资料；两者明确标记。
- 真实资料留在 private，报告留在 output，均不进入版本控制。
- 维持 limit 为 1—10，默认 1。
- 没有自动重试。每次实际请求（包括失败）占用一次额度；缺字段、排除项、未执行项不占额度。
- completed / needs_info 返回 0；partial / failed 及输入配置错误返回非零。
- 不保存完整简历、密钥或原始模型响应；不宣称联系方式过滤等于完整匿名化。
- 当前目录不是 Git 仓库；不要初始化仓库或假称提交。每项末尾核对修改文件；若实施时已经存在 Git，则只提交该项代码/测试/文档，绝不提交 private、data、output、.env。

## Review Focus

1. 环境变量覆盖 .env：诊断与分析必须使用同一配置，并显示来源；任务 1、4 测试覆盖。
2. 一个岗位缺资料与整个 JSON 结构破损不同：前者不阻断其他岗位，后者零请求退出；任务 2、3 覆盖。
3. 全部岗位关闭、异地或缺资料：零调用且不能声称匹配成功；任务 3 覆盖。
4. 401 出现在已有成功结果之后：保留成功结果并停止后续请求；任务 3 覆盖。
5. 服务端正文、异常、URL 查询串携带秘密：终端和报告只输出允许信息；任务 1、4 覆盖。

## 文件与接口分工

| 文件 | 改动与职责 |
| --- | --- |
| python/jobpilot/model_connection.py（新） | 配置读取、端点校验、安全请求、诊断和错误提示 |
| python/jobpilot/week3_model.py | 保留提示词/Analysis/引用校验，HTTP 调用委托共享层 |
| python/jobpilot/practice_inputs.py（新） | 实战岗位读取、元数据及必填字段校验 |
| python/jobpilot/week3.py | 可选输入策略/进度、批次停止、报告与学习入口标记 |
| python/jobpilot/practice.py（新） | check-model / analyze 的 CLI 参数及输出 |
| python/jobpilot/cli.py | 两个新命令分发和帮助 |
| tests/python/test_model_connection.py（新） | 请求契约、配置、错误及隐私 |
| tests/python/test_practice_inputs.py（新） | 实战输入边界 |
| tests/python/test_week3.py | 原有回归及批次行为 |
| tests/python/test_practice_cli.py（新） | 实战/诊断入口离线集成 |
| docs/project-workflow.md | 操作、边界、状态及代码导航 |

不改动 week1/2 的默认输入约束、业务 graph.py、tools.py、bridge.py、ledger.py。

## Task 1：统一模型连接与错误分类

**Files:** 新建 model_connection.py、test_model_connection.py；修改 week3_model.py 和 test_week3.py 的 HTTP 错误断言。

**Interfaces:**
- `load_model_config(root: Path) -> tuple[dict, dict]`：有效配置和来源映射，映射值为 env / dotenv / missing；空环境变量也覆盖 .env，不静默回退。
- `validate_model_config(config: dict) -> dict`：返回 trim 后三个必需字符串；空值报 MODEL_CONFIG_REQUIRED；无效 URL 报 MODEL_ENDPOINT_INVALID。只接受 HTTPS 或 localhost/127.0.0.1 的 HTTP；拒绝 userinfo、query、fragment，避免误发凭据。
- `request_json(config: dict, messages: list[dict], *, max_tokens: int, transport=None) -> dict`：一次 POST，返回解析后的 JSON 对象；超时沿用 45 秒、禁重定向、无重试、temperature=0、response_format=json_object。
- `check_model(config: dict, *, transport=None) -> dict`：用无私人资料的固定 JSON 回复要求调用 request_json，max_tokens=32；只要求成功且输出是 JSON 对象，返回安全摘要，不输出模型原话。
- `error_info(code: str) -> dict`：返回 code、http_status（已知状态或 None）、固定中文 message。
- `BLOCKING_MODEL_ERRORS: frozenset[str]`：AUTH / ACCESS / NOT_FOUND / RATE_LIMIT 四种代码。
- 现有 `create_analyzer(config, *, transport=None)` 签名不变，委托 request_json，max_tokens=4000。

错误表：401→MODEL_AUTH_FAILED，403→MODEL_ACCESS_DENIED，404→MODEL_NOT_FOUND，429→MODEL_RATE_LIMITED，5xx→MODEL_SERVER_ERROR，其他 HTTP→MODEL_CALL_FAILED，httpx.TimeoutException→MODEL_TIMEOUT，其他 httpx.RequestError→MODEL_CONNECTION_FAILED，响应结构或 JSON 错误→MODEL_OUTPUT_INVALID。保留现有证据错误码。HTTP 提示不把状态码当成唯一原因。

- [x] 编写失败测试。MockTransport 参数化测试上述映射，每次只调用一次；检查请求 Bearer、模型、JSON 模式和禁重定向；check_model 消息不包含简历/JD。对现有测试的 500 和空 choices 断言分别改为 SERVER_ERROR / OUTPUT_INVALID。
- [x] 编写配置与隐私测试：env 覆盖 dotenv；三个空字段失败；带 userinfo/query/fragment 的 URL 拒绝；401 正文和网络异常包含 `SECRET_SENTINEL` 时 error_info 和抛出异常均不包含它。
- [x] 运行 ` .\.venv-jobpilot\Scripts\python.exe -m unittest discover -s tests/python -p test_model_connection.py -v`，确认测试因目标接口未实现而失败。
- [x] 实现上述接口。仅捕获明确请求/解析异常；未知异常仍由图边界转换为 ANALYSIS_FAILED，不传播原始异常。错误通过 WorkflowError 的固定码传递，继续保持该类不承载响应正文。
- [x] 重跑本任务测试及 test_week3.py；确认既有证据校验用例继续通过，核对修改文件。

## Task 2：实战输入及来源保留

**Files:** 新建 practice_inputs.py、test_practice_inputs.py。

**Interfaces:** `read_practice_jobs(path: str | Path) -> list[dict]`，返回兼容 week1.filter_jobs 的字段，另含 capturedAt、description_kind、listing_status、issues（中文字符串列表）。结构错误抛 ValueError，消息只含索引、字段、固定说明，不拼接原始材料。

只接受顶层对象和 jobs 数组；数组项为对象。已有及新增字符串字段出现非字符串类型时为结构错误。缺失字段视为空。非空枚举不合法、日期不合法视为结构错误；缺少日期/正文类型则是单项 issues。listing_status 缺省 unverified。title/company/city/url/capturedAt/description 为空，或 description_kind 不是 original_full，产生 issues。来源 URL 要求 HTTP(S)、有效主机，无 userinfo；日期必须 ISO 8601 且有时区。保留原文与元数据。salary 缺失不阻止分析，报告提示未知。

closed 项保持标记，由任务 3 跳过。filter_jobs 仍按完整 URL、其次 jobId 去重，保留首项；无需新去重算法。

- [x] 编写测试：完整项可分析且元数据不变；分别缺必填字段产生具体 issues；summary 要求补正文；closed/unverified 标记保留。英文测试名建议 `test_provenance_survives_filtering`、`test_missing_fields_are_item_issues`。
- [x] 编写结构边界测试：非法 JSON、非对象顶层、非数组 jobs、非对象 row、整数 description、无时区时间、错误枚举分别抛 ValueError；字段消息包含条目编号。中文/UTF-8 BOM 文件可读。
- [x] 运行 ` .\.venv-jobpilot\Scripts\python.exe -m unittest discover -s tests/python -p test_practice_inputs.py -v` 确认失败。
- [x] 实现 reader，复用可用的字符串规范化/筛选能力，但不先经 week1.read_jobs 丢掉元数据；不访问网络、不证明页面仍在招。
- [x] 重跑输入测试及 test_week1.py / test_week2.py，确认练习输入兼容；核对修改文件。

## Task 3：逐岗执行、停止策略及可复核报告

**Files:** 修改 week3.py、test_week3.py。

**Interfaces:**
- `load_inputs(state, *, job_reader=read_jobs)`：增加可注入 reader，其余返回结构兼容。
- `analyze_batch(state, analyzer, *, progress=None)`：返回 results / calls / status，新增各项 elapsed_seconds、批次 elapsed_seconds 和 summary。
- `build_analysis_graph(analyzer, *, job_reader=read_jobs, progress=None)`：仍三个节点；通过闭包注入，不能把回调写入状态或报告。
- `progress(event: dict) -> None`：阶段 start / end；字段 index、total、title、calls、limit、elapsed_seconds、status（start 为 running）。在每个实际请求之前和结果记录之后发送，生产回调刷新输出。非请求项不制造“正在调用模型”的事件。
- state 新增可选 mode（learning/practice）、model；报告 writer 兼容旧调用缺少这两个值。

单项优先级：closed→skipped；缺资料/summary→needs_info；正文超长→failed；已全局阻塞→deferred（固定错误码原因）；到预算→deferred；其余调用分析。未知城市仍单列但元数据/缺失原因保留。全局阻塞不把原本缺字段的项改成 deferred。

status 规则：results 中全失败为 failed；存在失败或 deferred 而非全失败为 partial；否则存在 needs_info/未知城市或没有实际成功分析项为 needs_info；其余 completed。summary 包含 analyzed（通过结构/证据校验的项）、needs_info、failed、deferred、skipped、其他城市/重复计数；这些字段有交叉，报告不可宣称互斥总和。结果 matched/has_gaps/needs_info 不等于招聘适合性已确定。

- [x] 增加失败测试 `test_auth_failure_stops_remaining_requests`：3 合格项，第一次401，calls=1，状态依次 failed/deferred/deferred。另测先成功再401保留第一项证据。403/404/429 同样停止。
- [x] 增加 `test_timeout_continues_within_budget`：第一次 MODEL_TIMEOUT 第二次合法答案，calls=2，结果 partial；缺资料不消耗额度，limit=1 后其余合格项 deferred。
- [x] 增加零调用测试：全缺字段、全关闭、全异地、空 jobs 均没有匹配成功宣称；缺正文与完整项混合只调用完整项。保留原有 missing title 学习模式抛错行为。
- [x] 增加进度/报告测试：事件顺序 start/end/start/end，耗时非负；读取生成 JSON/Markdown 检查来源及未核验招聘状态、薪资未知提示；无整份 resume、密钥、原始响应。模型名称来自 state；已处理项在后续请求失败时仍落盘。
- [x] 运行 ` .\.venv-jobpilot\Scripts\python.exe -m unittest discover -s tests/python -p test_week3.py -v` 确认新增用例失败。
- [x] 按接口实现，计时用 time.monotonic；每次实际调用前累加 calls；回调只输出安全字段。保存所有可处理失败的最终报告。输入错误仍在 load_inputs 后直接 END。
- [x] 重跑 test_week3.py，确认旧测试继续通过（任务 1 明确改变的错误分类断言除外）；核对修改文件。

## Task 4：诊断与实战命令

**Files:** 新建 practice.py、test_practice_cli.py；修改 cli.py、week3.py。

**Interfaces:**
- `run_check_model(argv: list[str], root: Path) -> int`：只接受帮助，无资料参数；打印固定费用提示、非敏感配置及来源，调用 check_model 一次，成功0失败1。
- `run_practice(argv: list[str], root: Path) -> int`：--resume/--jobs 必需，--city 深圳，--limit 1—10 默认1；创建 analyzer 和实战 graph，传入 reader/progress/mode/model。只在本地输入和配置校验通过后发起岗位请求。
- `main` 分发 check-model/analyze；绝不转入 LiveTools/contact 或获取 BOSS 锁。
- learn-model 继续可用，启动时打印学习模式；对输入默认或显式指向内置 examples 的情况分别显示样例路径及提示，不称为实战。

- [x] 写入口测试：缺参数 SystemExit=2、未调用模型；有效临时资料+MockTransport 调用1次且退出0；无效配置退出1且无网络；输入破损退出非零；partial退出1、needs_info退出0。禁止调用 BossBridge/LiveTools，用 mock 的 side_effect 强制失败防止误接网站。
- [x] 写诊断测试：网络只一次、无真实资料、env覆盖信息可见、SECRET_SENTINEL 未出现在 stdout/stderr/报告；异常 URL 提示只写固定说明。KeyboardInterrupt 转为退出130及“用户已中断”提示，不承诺中断报告。
- [x] 运行 ` .\.venv-jobpilot\Scripts\python.exe -m unittest discover -s tests/python -p test_practice_cli.py -v` 确认失败。
- [x] 实现入口与 flush=True 的进度输出，显示请求超时为45秒的网络操作超时（不宣称整批45秒必结束）。复用 error_info；不把任意异常转成可打印 repr。帮助文字说明诊断可能产生费用、实战按实际调用计费。
- [x] 重跑入口及 test_cli.py / test_week3.py；运行两条新命令的 --help（不联网）；核对修改文件。

## Task 5：教学说明与整体回归

**Files:** 修改 docs/project-workflow.md；必要时补充 docs/python-week3.md 的入口说明，不能宣称真实验收已通过。

- [x] 更新说明：安装好的 venv 如何启动；check-model 与 analyze 的区别；真实岗位 JSON 字段；如何本地更新 Key 而不贴到聊天；进度/退出码/报告怎么看。
- [x] 将状态、三个节点、条件分支和输入/模型边界逐一对应到函数；展示可复制的核心调用片段，说明示意代码与实际源码的区别。明确完整正文需人工核验、样例仅教学、BOSS详情采集尚未接入。
- [x] 运行 ` .\.venv-jobpilot\Scripts\python.exe -m unittest discover -s tests/python -v`，全部通过才记录代码验证完成。只在新失败或修改后重复相关测试。
- [x] 核对文档命令与实际 --help、接口一致；检查修改列表没有私人文件、凭据或第三方 upstream 改动。当前工作区无 Git，直接列出本轮变更文件，不做提交。

## Task 6：真实资料验收（外部条件决定能否通过）

**Files:** 创建 private/real-practice-20261104/ 的真实资料和来源说明、output 下实际报告；更新本计划验收记录。已有 Word 简历与旧实战文件保留。

- [ ] 先读取 .agents/skills/shenzhen-job-search/SKILL.md 和 private/profile.json，按当前指定版本提取简历文本；不覆盖用户修订版，不使用历史摘要替代最新资料。
- [ ] 运行 check-model 一次，记录时间、模型、结果/安全错误码。若失败，停止真实模型验收；提示用户本地修复 Key/权限，保留离线完成状态，不循环诊断、不要求在聊天粘贴密钥。
- [ ] 诊断成功后，只读核验3个深圳真实岗位页面，记录来源、带时区时间、正文和在招观察；遵守平台访问限制与内容获取规则，不能用摘要伪造完整正文。无法合法读取完整正文时请用户将可见 JD 保存本地；不因页面可访问就确认仍在招聘。
- [ ] 使用新目录资料运行 ` .\scripts\jobpilot.cmd analyze --resume .\private\real-practice-20261104\resume.txt --jobs .\private\real-practice-20261104\jobs.json --limit 3`，只执行一次批次；失败如实保存，不反复调用刷成功率。
- [ ] 打开实际报告并逐项核对：来源和正文相符、简历引用存在、unknown合理、无虚构经历；记录3项各自结果、请求次数、报告路径与未解决项。若未全数成功，写“真实验收未通过/部分完成”，不写“全部修复”。
- [ ] 实战结束后安排一次独立代码审阅（按选定执行方式），只读代码/测试及必要的脱敏结果，修复重要问题并运行受影响测试；给用户说明变化、验证证据及实际操作命令。

## 当前进度与交付标准

- 用户已授权执行；任务1—5已实施，61项Python测试通过。真实模型鉴权已恢复，真实岗位验收结果见末尾记录。
- 任务 1—5 是离线软件交付；任务 6 是真实验收，两者状态单独报告。
- 第一阶段成功后再进入 BOSS 接入设计，本计划不实施第二阶段。
- 自检：设计的配置、输入、预算、错误、进度、隐私、教学及真实验收均已映射到任务；任务间接口统一，Review Focus 五项均有测试归属。

### 执行结果（2026-11-04）

- 任务1—5完成；最终61项Python测试通过。两个新命令可用；独立审阅无重大问题。
- 用户授权更新本地 Key 后诊断成功。实战发现并修复默认思考耗尽输出预算、原20项容量不足两处问题，详见设计补充与执行账本。
- 任务6已执行但完整验收未通过：最终批次3次请求，2项可供复核、1项简历引用校验失败，状态partial。报告在 output/jobpilot/week3/d5c0ff0b55b44981a64a019033500927/。
- 未裁剪证据、未把失败当作成功、未发送消息或投递。人工复核在 private/real-practice-20261104/review.md。
- 已知次要诊断限制：非401/403/404/429的HTTP错误保留固定分类，但未保存具体HTTP数字状态。
