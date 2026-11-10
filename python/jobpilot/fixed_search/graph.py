"""先读这里：节点做事，边决定下一步；循环由边连接出来。"""
from langgraph.graph import StateGraph, START, END
from .state import FixedSearchState
from .nodes import make_nodes


def initial_state(store, saved=None):
    state = {"batch_id": store.run_id, "mode": store.mode, "band_index": 0, "seen_job_keys": [],
             "candidates": [], "advances": 0, "no_new": 0, "step": 0, **(saved or {})}
    # resume 保留查询进度；页面对象和旧候选重新观察，不凭旧快照点击。
    return {**state, "status": "running", "stop_reason": "", "route": "", "current_job": None, "attempt_id": None}


def build_graph(tools, store, checkpointer, *, stop_after=None):
    graph = StateGraph(FixedSearchState)
    for name, fn in make_nodes(tools, store, stop_after=stop_after).items():
        graph.add_node(name, fn)
    graph.add_edge(START, "load_config")

    def next_step(default=None):
        def route(state):
            if state.get("status") != "running":
                return "summarize"
            return default or state["route"]
        return route

    # 有异常出口的节点使用条件边；业务成功路径固定时传入默认下一步。
    for source, target in (("load_config", "preflight"), ("search_and_filter", "collect_candidates"),
                           ("collect_candidates", "select_candidate"), ("verify_phrase", "send_phrase"),
                           ("send_phrase", "inspect_result"), ("inspect_result", "restore_search"),
                           ("restore_search", "collect_candidates"), ("advance_results", "collect_candidates")):
        graph.add_conditional_edges(source, next_step(target))
    for source in ("preflight", "select_candidate", "inspect_job", "reserve_contact", "open_chat", "recover_contact", "next_band"):
        graph.add_conditional_edges(source, next_step())
    graph.add_edge("summarize", END)
    return graph.compile(checkpointer=checkpointer)
