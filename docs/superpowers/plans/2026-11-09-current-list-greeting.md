# Current-list Greeting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Execute the already user-authorized implementation; no repeated design approval.

**Goal:** 从当前列表完成有界真实沟通循环并产生可解释日志。
**Architecture:** 独立v4动作协议复用绑定、租约和持久账本；扩展捕获原列表，Python LangGraph负责业务循环与诊断。首条常用语在首个聊天中读取后绑定，不重置预算。
**Tech Stack:** Python/LangGraph/SQLite、Edge MV3 JavaScript、MCP Python、JSON Schema。
**Spec:** docs/superpowers/specs/2026-11-09-current-list-greeting-design.md（用户“实现方案A”已批准）。

## Global Constraints

最多150次尝试；50次推进、连续3次无新增停止；保持原列表条件；1–3和3–5年混合顺序遍历；未知不重发；不上传简历；原始令牌不进日志。无Git，不创建提交，保留既有用户改动。

## Shared Interfaces

v4 context沿用v3 runId/requestId/leaseId/binding/deadline。scope: `{mode: preview|run,batchId,maxContacts}`，preview为0，run为1..150（恢复剩余0允许只读核验）。不接受调用者URL。原列表由扩展自己捕获。

动作：start_run(scope)、renew_run({})、inspect_current_list({})、advance_list({})、restore_list({})、open_job({jobKey})、open_chat({jobKey})、inspect_chat({conversationKey})、read_first_phrase({conversationKey})、bind_phrase({conversationKey,expectedHash,observationRequestId})、choose_first_phrase({conversationKey,expectedHash})、submit_filled_phrase/inspect_send_result（同v3，可选receipt）。

列表响应：`{binding,snapshot:{fingerprint,keyword,city,url,filters},jobs:[{key,title,company,url,experience:exp_1_3|exp_3_5|null,...}],exhausted}`。仅url规范化业务字段；fingerprint覆盖城市/关键词/筛选，排除翻页游标。经验不合格保留可解释skip或在候选里标明，不静默伪造。详情/聊天/话术响应复用v3形状。

inspect_current_list首个结果固定原列表，后续同租约必须一致；resume由Python核对既有snapshot。bind_phrase依据本租约已完成read_first_phrase原requestId/hash/conversationKey，不派发网页点击，不重置计数；发送必须先绑定；模板缺失不得发送。

health新增currentListVersion:1/currentListSchemaHash。扩展新增currentListVersion:1绑定能力；版本0.8.0。所有老流程保持兼容。

## Review Focus

1. 模板绑定/续租/恢复不得重置次数（Task1/2/3测试）。
2. current-list不调用搜索或修改条件；跳转返回恢复原目标（Task2）。
3. 未知发送后重启不得再派发（Task3）。
4. 页面切换/同标签聊天后不冒认另一个岗位（Task2）。
5. 日志分清读取/点击/提交/确认，脱敏非预期错误（Task3）。

## Task1 MCP与协议

Files: contracts/boss-current-list-v4.schema.json, integrations/mcp-bosszp/boss_bridge/{workflow,tools,server}.py, tests/test_current_list_workflow.py。
- [x] 添加v4 contract/range/bootstrapping失败测试：bind前发送拒绝、错误rid/hash拒绝、preview拒绝contact、150后拒绝、bind不归零。
- [x] 实现验证/能力与health；Runs缓存read_first_phrase的已观察证据，只允许匹配绑定；snapshot在Python/扩展核验。
- [x] MCP完整测试通过。

## Task2 浏览器

Files: extensions/boss-page/current-list*.js、action-executor/workflow-controller/content/chat-actions及版本文件、build脚本、tests/boss-current-list*.test.ts。
- [x] 先编写当前列表快照保持、两档列表、绑定话术权限、返回原列表和城市变化暂停测试。
- [x] 实现捕获/核验/推进和原列表返回，不调用搜索；捕获URL仅内部受限恢复。复用精确岗位/接收人核验与消息receipt。
- [x] v4 executor/控制器bootstrap与bind；bind证据来自read_first_phrase，未绑定至多打开首个新聊天，未解决该聊天不得继续打开新人。
- [x] 构建0.8.0，受影响及完整TS测试、tsc通过。

## Task3 Python编排与日志

Files: python/jobpilot/current_list/{state,store,tools,nodes,graph,cli,logging}.py、bridge.py/cli.py；tests/python/test_current_list*.py。
- [x] 先写循环、resume预算、unknown不重发、实际城市与条件保持、日志计数测试。
- [x] 子类/组合复用BatchStore并增加flow与snapshot字段在config；桥支持version4和能力hash；继承固定工具发送原请求机制，覆盖前置与列表/模板读取。
- [x] 单一混合列表循环，不分年限重搜。开始/完成/异常日志均落地，输出岗位/常用语/尝试/发送/返回独立计数；不记录敏感数据。
- [x] CLI current-list run/preview/status/resume；run默认150，显式confirm-send；stop-after单岗返回后暂停，同批resume继续。
- [x] Python完整测试通过。

## Task4 审查、交付与实站

- [x] 独立审查协议授权、恢复、日志及列表保持，修复重要问题。
- [x] 编译、完整回归；备份旧扩展，更新原加载目录，核验权限和文件hash。
- [x] 用户重载连接后真实preview通过：15个岗位、10个经验合格，批次11510b98-b4cb-4a64-9b1e-71944ae3a718。修复成功日志误报，Python104项通过。
- [ ] 最新项目约定恢复人工发送，本轮不运行真实沟通；首岗发送/返回与同批循环尚未实站验收。
- [x] docs/python-current-list.md逐节点解释，保存测试和实站证据；不把本地测试当实站成功。

