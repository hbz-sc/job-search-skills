"""先读本文件：五个普通函数节点，组成一个真正的 LangGraph。"""
from typing import TypedDict
from langgraph.graph import StateGraph, START, END
from .errors import WorkflowError


class JobState(TypedDict, total=False):
    # State：节点共享的数据结构。类型注解不是运行时输入校验。
    resume: str                 # 初始输入，只在内存中用于分析
    mode: str                   # demo / preview / run
    roles: list[str]            # 模型给出的有限岗位方向
    jobs: list[dict]            # 工具返回的候选岗位
    selected: dict | None       # 本轮最多选一个
    result: dict
    error: str
    report: dict


def build_graph(planner, tools, ledger):
    """注入工具：同一张图既能跑离线 demo，也能连接真实页面。"""
    def analyze_resume(state: JobState):
        if state["mode"] not in {"demo", "preview", "run"}:
            return {"error": "INVALID_MODE", "roles": []}
        try:
            return {"roles": planner(state["resume"]), "error": ""}
        except Exception as exc:
            return {"roles": [], "error": str(exc) if isinstance(exc, WorkflowError) else "ANALYZE_FAILED"}

    def search_jobs(state: JobState):
        try:
            return {"jobs": tools.search(state["roles"])}
        except Exception as exc:
            return {"jobs": [], "error": str(exc) if isinstance(exc, WorkflowError) else "SEARCH_FAILED"}

    def select_job(state: JobState):
        # 普通 Python for / if，不需要把每一行都变成 Agent。
        try:
            for job in state["jobs"]:
                if job.get("experience") not in {"exp_1_3", "exp_3_5"}:
                    continue
                if not ledger.should_skip(job["key"]):
                    return {"selected": job}
            return {"selected": None}
        except Exception as exc:
            return {"selected": None, "error": str(exc) if isinstance(exc, WorkflowError) else "SELECTION_FAILED"}

    def contact_once(state: JobState):
        try:
            return {"result": tools.contact(state["selected"])}
        except Exception as exc:
            return {"result": {"status": "unknown"}, "error": str(exc) if isinstance(exc, WorkflowError) else "CONTACT_UNKNOWN"}

    def record_result(state: JobState):
        result = state.get("result") or {"status": "paused" if state.get("error") else "preview" if state["mode"] == "preview" else "no_candidate"}
        report = {"mode": state["mode"], "roles": state.get("roles", []),
                  "candidates": len(state.get("jobs", [])), "jobs": state.get("jobs", []),
                  "selected": state.get("selected"),
                  "result": result, "error": state.get("error", "")}
        ledger.save_report(report)   # 不保存完整简历、密钥或聊天内容
        return {"report": report}

    # Node：注册普通 Python 函数；返回的字典是对 State 的局部更新。
    graph = StateGraph(JobState)
    graph.add_node("analyze_resume", analyze_resume)
    graph.add_node("search_jobs", search_jobs)
    graph.add_node("select_job", select_job)
    graph.add_node("contact_once", contact_once)
    graph.add_node("record_result", record_result)
    # Edge：固定下一步；conditional_edges：根据状态决定下一步。
    graph.add_edge(START, "analyze_resume")
    graph.add_conditional_edges("analyze_resume", lambda s: "record_result" if s.get("error") or not s["roles"] else "search_jobs")
    graph.add_conditional_edges("search_jobs", lambda s: "record_result" if s.get("error") else "select_job")
    graph.add_conditional_edges("select_job", lambda s: "contact_once" if s.get("selected") and s["mode"] in {"demo", "run"} else "record_result")
    graph.add_edge("contact_once", "record_result")
    graph.add_edge("record_result", END)
    return graph.compile()
