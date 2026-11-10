# 从当前岗位列表开始的 LangGraph 沟通循环

这是方案A的新入口。旧 `fixed-search preview` 只预览搜索结果，沟通次数为0是其行为，并非已尝试发送失败。

## 启动

按最新项目约定，当前默认人工发送。本轮只执行下面的 preview；run/resume 是以后明确启用自动沟通时可用的命令，不会随预览自动运行。

在 Edge 打开要处理的 BOSS 职位列表，自行选择城市、关键词和筛选。重新加载0.8.0扩展并连接该页面。程序不重新搜索，不修改城市与筛选；它只处理当前列表中1–3年、3–5年的岗位，其他经验跳过。

```powershell
Set-Location D:\code\job-search-skills
# 仅观察列表，不点击立即沟通
.\scripts\jobpilot.cmd current-list preview
# 真实沟通；同一批次预算150，先完成1次并返回列表后暂停
.\scripts\jobpilot.cmd current-list run --max-contacts 150 --stop-after 1 --confirm-send
# 核对结果后继续原批次，预算不重置（替换实际批次ID）
.\scripts\jobpilot.cmd current-list resume --batch 批次ID --confirm-send
```

完整循环一次启动命令：

```powershell
.\scripts\jobpilot.cmd current-list run --max-contacts 150 --confirm-send
```

不需要先进入已有聊天取模板。首次点击立即沟通后，程序读取该聊天里的第一条已保存常用语，将其hash绑定到本批次，再发送。之后每次读取都核对同一话术；变化/缺失/接收人不明会暂停。网站可能在点击立即沟通时已产生招呼，因此先占用尝试预算，后续失败不退回次数。

## 流程与对应代码

`preflight → read_list → collect → select → inspect_job → reserve → open_chat → verify_phrase → send_phrase → inspect_result → restore → collect`

- **状态 State**：[state.py](D:/code/job-search-skills/python/jobpilot/current_list/state.py) 是共享进度表，记录当前岗位、候选、已处理岗位、次数和暂停原因，不存浏览器对象。
- **节点与边**：[graph.py](D:/code/job-search-skills/python/jobpilot/current_list/graph.py) 中每个函数做一步，返回的字典更新State。发送确认后普通边走restore；select的条件边决定打开岗位、推进列表或结束。任何节点失败都走summarize。
- **网页工具**：[tools.py](D:/code/job-search-skills/python/jobpilot/current_list/tools.py) 核对原列表快照，读取并绑定第一条话术；发送与原请求恢复复用固定搜索模块，未知不重新派发。
- **桥**：[bridge.py](D:/code/job-search-skills/python/jobpilot/current_list/bridge.py) 发送v4业务动作，核验扩展能力和协议hash，不接受任意网页脚本。
- **预算账本**：[store.py](D:/code/job-search-skills/python/jobpilot/current_list/store.py) 复用SQLite历史去重与尝试预留，保存原列表快照和返回结果。checkpoint记流程位置，账本记外部动作，两者不能互相替代。
- **日志**：[logging.py](D:/code/job-search-skills/python/jobpilot/current_list/logging.py) 只记录白名单诊断字段；日志不含密钥、cookie、话术正文或完整聊天记录。
- **启动和报告**：[cli.py](D:/code/job-search-skills/python/jobpilot/current_list/cli.py) 区分preview与run，打印独立计数，写报告路径。

## 怎么看日志

每个节点和网页动作都有begin、complete或failed，附耗时与request_id。网页动作完成不一定代表消息确认，只有inspect_result观察到confirmed才增加发送确认数。

报告分别显示：去重读取岗位、新候选、跳过、沟通尝试、常用语读取成功、发送确认、发送失败、待核验、返回列表。常用语没有读取时显示“未执行”，不会用“0条常用语”误导。读取岗位与候选按岗位键去重，返回后再次看到同一岗位不会重复计入。

日志与报告存于 `output/jobpilot/current-list/<批次ID>.jsonl` 和 `.json`。同批次resume追加日志，不覆盖历史。城市与筛选变化时暂停，不重新提交搜索来猜测恢复。额度/验证/未知结果同样暂停并保留现场。

## 当前验收状态

2026-11-09：Python 103项、桥服务35项、TypeScript 324项测试通过，类型检查及构建通过。独立审查的4项问题已修复并复查。扩展0.8.0已更新到 `D:\code\jobpilot-edge`，19个文件hash一致，权限和扩展身份保持一致。

首次只读预览因旧桥服务报 `BRIDGE_CONTRACT_MISMATCH`；用户重载连接后已解决。最新真实预览批次 `11510b98-b4cb-4a64-9b1e-71944ae3a718` 为 `completed / PREVIEW_COMPLETE`：读取当前广州（101280100）、Java列表15个岗位，10个经验符合条件；未重新搜索、未发送、常用语未执行。两次预览的列表条件指纹一致。日志：`output/jobpilot/current-list/11510b98-b4cb-4a64-9b1e-71944ae3a718.jsonl`。

实测同时修复了成功动作误显示 `UNEXPECTED_ERROR` 的日志问题：空错误字段不再转换成错误码。新增回归测试先复现失败，再修复，Python完整104项测试通过。

单岗发送并返回、同批循环尚未实站验证。本地自动化测试使用测试页面和工具替身，不代表真实发送成功。真实列表没有变化且网站未给出耗尽标志时，会以 `POSTCONDITION_TIMEOUT:LIST_NOT_ADVANCED` 暂停；不能把它解释为“已处理全部岗位”。

## 对照代码理解 LangGraph

下面摘自 `graph.py`。节点返回字典，LangGraph把它合并进共享状态：

```python
@safe
def reserve(s):
    attempt = store.reserve(s["current_job"])
    return {"attempt_id": attempt, "route": "open_chat" if attempt else "restore"}
```

业务含义：先为当前岗位占用一次沟通尝试，再允许打开聊天。状态中的 `attempt_id` 贯穿发送、核验与返回；中途失败不会退回次数，避免恢复后超过150次。

```python
fixed = {
    "read_list": "collect", "collect": "select",
    "verify_phrase": "send_phrase", "send_phrase": "inspect_result",
    "inspect_result": "restore", "restore": "collect", "advance": "collect",
}
```

这是确定的下一步映射，例如发送后先核验，再返回列表。程序统一用条件边处理正常路径和失败路径：

```python
graph.add_conditional_edges(
    name,
    lambda s, n=name: "summarize" if s.get("status") != "running"
    else fixed.get(n, s.get("route")),
)
```

运行正常时沿映射或节点给出的 `route` 前进；遇到额度、页面变化、消息结果未知等问题，状态变为暂停并走 `summarize` 保存结果。边界就是这些必须满足的条件：原列表不变、岗位经验匹配、接收人身份明确、第一条话术一致、累计尝试不超过150。
