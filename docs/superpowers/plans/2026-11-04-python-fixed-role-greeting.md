# Python 固定岗位批量沟通 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 用可学习的 Python LangGraph 执行真实固定岗位搜索、第一条常用语沟通及最多 150 次的持久化批次。

**Architecture:** Python 负责图和业务账本，现有 MCP/Edge 扩展负责受限网页交互。新增独立 fixed-search 入口，保留已有学习与简历分析入口。

**Tech Stack:** Python 3.12、LangGraph、SQLite checkpointer、现有 TypeScript MCP 桥及 Edge 扩展。

**Spec:** `docs/superpowers/specs/2026-11-04-python-fixed-role-greeting-design.md`

## Global Constraints

- 固定 Java全栈开发工程师、深圳、1–3/3–5 年；不读取简历或调用模型。
- 每批最多 150 次新沟通占额；预览零发送；恢复不重置预算。
- 只使用第一条常用语；未知外部动作不能重新派发。
- 不清空历史记录，不修改其他入口的人工发送语义。
- 当前不是 Git 仓库，原地增量修改并保存工作日志，不创建仓库或伪造提交。
- 用户已要求开始代码；计划直接执行，不再重复请求实施授权。

## Review Focus

- 发送成功但 checkpoint 未更新：原动作键/请求记录阻止重复发送（任务 2/3）。
- 占额后崩溃：恢复不重复扣额且不允许第 151 次（任务 2）。
- 旧扩展接受新参数/经验控件多选变化：版本与契约拒绝不匹配，实际选中证据通过才前进（任务 1/4）。
- 页面恢复到不同招聘者或列表旧快照：重新核对身份及结果证据（任务 1/3）。
- 额度旧日期、当天额度和未知旧发送：分别核验，不能一律清除或一律忽略（任务 2/4）。

## 文件与接口

- `extensions/boss-page/*`、`src/boss-extension/search-protocol.ts`、`contracts/boss-search-v3.schema.json`：自动经验能力与 150 上限。
- 新增 `python/jobpilot/fixed_search/{state,store,tools,nodes,graph,cli}.py`：状态、持久记录、工具、业务节点、图、入口。
- 扩展 `python/jobpilot/bridge.py`：可选稳定 batch_id、max_contacts、experience_mode；保持旧调用兼容。
- `python/jobpilot/cli.py`：分派 fixed-search；`pyproject.toml` / lock：SQLite saver 的固定依赖。
- `tests/python/test_fixed_*.py`、`tests/boss-fixed-*.test.ts`：新行为回归。
- `docs/python-fixed-search.md`：按真实业务步骤解释代码，给出实际运行和验收结果。

跨域约定：v3 start_run scope 新增可选 `experienceMode: "manual" | "auto"`（缺省 manual）；auto 仅用于本入口。所有层 maxContacts 最大 150。适配器版本更新到 boss-dom-0.7.0，旧单岗入口继续接受兼容版本。搜索 query 和现有动作名保持不变。

### Task 1: 自动经验与共享协议

**Files:** 修改浏览器扩展、TS/JSON 验证器；新增 `tests/boss-fixed-search.test.ts`。

**Interfaces:** 消费 scope.experienceMode；产出与现有 search_jobs/list_jobs/restore_search 相同的可核验 SearchView，使用 0.7.0 适配器。

- [x] 写失败测试：auto 可用、manual 不自动点击、150 接受/151 拒绝、选择两档或单选轮换、返回列表核验、不可见/未知选中状态不通过。
- [x] 用本地 Node 执行对应 vitest，观察失败。
- [x] 实现限定经验控件的自动选择；保留旧 manual 模式；各层 schema 与能力同步。
- [x] 跑相关协议、控制器、经验和筛选测试，类型检查及扩展构建。

### Task 2: 持久批次、预算和动作去重

**Files:** 新增 state.py、store.py、`tests/python/test_fixed_store.py`；更新 SQLite saver 依赖。

**Interfaces:** `BatchStore(path, batch_id=None, mode='run', max_contacts=150)`；`batch()`、`reserve(job)`、`finish(attempt_id, phase, evidence)`、`should_skip(key)`、`check_blockers()`、`summary()`；持久动作逻辑键映射原 requestId/结果。

- [x] 写失败测试：150/151、非法上限、跨批次/历史去重、恢复计数、占额幂等、旧未知动作阻塞、当天与历史额度区分。
- [x] 执行 `.venv-jobpilot/Scripts/python.exe -m unittest discover -s tests/python -p test_fixed_store.py` 观察失败。
- [x] 实现 BatchStore，复用旧 page_attempts/page_runs 表以保持跨入口去重，新增批次与动作表；账本事务为预算真值。
- [x] 使用与当前 checkpoint 兼容的固定版本 SQLite saver；相同命令验证通过。

### Task 3: Python 工具和可恢复状态图

**Files:** tools.py、nodes.py、graph.py；扩展 bridge.py；`tests/python/test_fixed_graph.py`、`test_fixed_tools.py`。

**Interfaces:** `build_graph(tools, store, checkpointer)`；初始 state 包含 batch_id、mode、band_index、status；tools 提供 preflight/search/advance/inspect_job/open_chat/verify_phrase/send_phrase/inspect_result/restore，全部注入便于测试。

- [x] 写失败测试：真实 StateGraph 多岗循环、preview 无沟通、150 次边界、两档去重、翻页无新增退出、未知发送暂停且 resume 不重发、发送后 checkpoint 回放幂等。
- [x] 运行以上 unittest 测试并确认失败。
- [x] 每个业务步骤一个短函数节点；条件边处理候选、上限、异常；SQLite checkpoint 以 batch_id 为 thread_id。
- [x] 副作用动作使用稳定逻辑键及原 requestId 查询；已确认结果可回放，未知只核验不重新派发。发送前核对正文与身份，账本记录阶段。
- [x] 运行任务 2/3 测试；回归原 Python graph/tools/services。

### Task 4: CLI 集成与真实连接预览

**Files:** fixed_search/cli.py、原 cli.py；`tests/python/test_fixed_cli.py`。

**Interfaces:** `run_fixed_search(argv, root)`；preview/run/status/resume；run/resume 需 confirm-send；status 本地只读；重启恢复原批次参数。

- [x] 写失败测试：无简历/无 key 仍可启动；preview 无模板可执行；非法参数/缺发送授权拒绝；status 不新建批次；resume 不改预算；异常有批次 ID 与中文停止说明。
- [x] 运行对应测试确认失败，接入 CLI 和中文报告。
- [x] 检查所有 Python 单元测试、TS 类型检查/构建/扩展构建；修复新改动导致的失败。
- [ ] 执行真实 fixed-search preview；若桥未连接或用户需登录，输出准确阻塞原因，不把本地数据当实站验收。
- [ ] 真实筛选通过后才在同一个预算批次验证单岗沟通并继续批量；未知则暂停。

### Task 5: 教学、审查和交付

**Files:** docs/python-fixed-search.md、计划工作日志、设计状态。

- [x] 写模块解释、节点/状态/边示例、最终文件链接和运行流程。
- [x] 独立审查实现，重点检查 Review Focus；重要问题先写复现测试再修复。
- [x] 跑最终受影响测试/编译，记录证据及真实页面未通过项。
- [x] 给用户实际完成范围、如何启动、在哪读代码、测试结果及限制。

## 执行记录

计划已自查：全部设计要求分配到以上任务。Task 1 与 Python 本地账本/图可按明确 scope 契约独立开发，集成于 Task 4；不让两个执行者修改相同文件。无 Git，保留 `.superpowers/sdd/2026-11-04-python-fixed-role-greeting/progress.md` 作为过程记录。

本地代码与构建已完成；真实预览已尝试但连接受阻，网页验收项保留未完成。详见同名progress.md。
