# JobPilot V1

单用户、本机运行的 LangGraph 求职辅助 Agent。分析简历与岗位资料，按需调用岗位详情工具，生成有来源依据的建议和沟通草稿，暂停等待人工审核。审核不发送任何招聘消息。

## 快速开始

在 D:/code/job-search-skills 打开 PowerShell，使用 Node 24。已有脚本会优先使用 Codex bundled Node；其他电脑可将 BOSS_NODE 设置为自己的 Node 24 可执行文件。

```powershell
.\scripts\boss.cmd build
.\scripts\boss.cmd jobpilot --help
.\scripts\boss.cmd jobpilot demo
```

真实模型从本地 .env 读取 JOBPILOT_MODEL、JOBPILOT_BASE_URL、JOBPILOT_API_KEY。兼容接口必须支持原生工具调用和 JSON 输出；没有配置时不会偷偷使用固定回答。当前本机配置已在用户授权下复用既有模型，不应复制或分享 .env。

demo 使用 examples/jobpilot 中的虚构简历和两个虚构岗位，返回 batchId、threadId、状态与草稿版本。完整岗位无需查询详情；另一个岗位的完整正文仅在调用工具后进入模型上下文。

```powershell
.\scripts\boss.cmd jobpilot status --batch <batchId>
.\scripts\boss.cmd jobpilot export --batch <batchId>
.\scripts\boss.cmd jobpilot review --thread <threadId> --version 1 --review-id ([guid]::NewGuid().ToString()) --decision revise --feedback '缩短到两句话，保留项目依据'
.\scripts\boss.cmd jobpilot review --thread <threadId> --version 2 --review-id ([guid]::NewGuid().ToString()) --decision approve
```

`<...>` 是占位符，替换为上一条命令输出的实际值。审核修改最多两轮；拒绝用 `--decision reject`。同一个请求重试须使用同一个 review-id 和相同参数；不要重试时生成新 ID。版本过期会被拒绝。

审核等待期间可以退出程序。重新执行 status、export 或 review 即可查看/恢复；resume 用于继续意外中断的执行，不会自动接受草稿。

导出位置：output/jobpilot/<batchId>/report.json 和 report.md。JSON 包含结构化要求、匹配、缺口、引用 ID、审核和运行信息；Markdown 便于阅读。需要原始证据时，在该批次冻结输入中按证据 ID 查阅。审核通过表示接受草稿，不表示已经发送。

## 自己的输入

```powershell
.\scripts\boss.cmd jobpilot analyze --resume 'private/我的简历.txt' --jobs 'private/岗位.json' --preferences 'private/偏好.json'
```

参考 examples/jobpilot 的文件格式。简历支持 txt/md；正文限制 20,000 字符，岗位最多 10 个。岗位 summary 不含完整正文；details 保存可查询正文；initialDetailIds 控制一开始已知哪些正文。

真实资料会提交给你配置的模型服务分析；程序会移除常见电话、邮箱和证件格式，但该规则不是通用隐私识别器。建议先人工脱敏。私人输入、数据库、报告保持 Git 忽略；默认不启用外部 tracing。

## 状态与存储

- waiting_review：图已暂停，等待审核输入。
- completed：结果生成流程完成，查看 review 字段区分接受或拒绝。
- partial：已有有效分析，但后续步骤失败或达到预算。
- failed：未得到有效分析；error 是可记录的错误类别。
- queued/running：尚未开始或执行中。

data/jobpilot/checkpoints.sqlite 保存 LangGraph 图状态；app.sqlite 保存任务、业务结果、审核去重和预算。private/jobpilot/inputs 保存冻结输入。请勿为“重新尝试”随意删库，否则无法恢复旧任务。修改原始输入不会改变已创建任务；新的输入应创建新批次。

## 验证

```powershell
.\scripts\boss.cmd typecheck
.\scripts\boss.cmd build
.\scripts\boss.cmd test tests/jobpilot
.\scripts\boss.cmd test
```

跨进程测试会使用 dist，因此先 build。自动测试仅用虚构输入和注入的测试模型，不联系招聘网站。真实模型 smoke 和评估脚本分别是 scripts/jobpilot-model-smoke.mjs、scripts/jobpilot-evaluate.mjs，使用与 boss.cmd 相同的 Node 24 运行，会产生模型调用费用。

## 范围

V1 的分析工具源是本地资料。新增 `jobpilot search` 使用简历规划搜索方向，通过 v3 MCP 页面工具编排搜索与沟通；实现和验收状态见 [搜索使用与学习指南](search-greeting-guide.md) 及 [搜索验收记录](search-greeting-acceptance.md)。真实网页验收未完成时，不能把本地样例演示写成实站投递已验收。Java 服务与网页界面尚未实现。

相关文档：[学习手册](learning-guide.md)、[演示步骤](demo.md)、[验收记录](acceptance.md)、[实施日志](implementation-log.md)。
