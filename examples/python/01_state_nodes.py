"""第一课：python examples/python/01_state_nodes.py。无需模型、浏览器或真实简历。"""
from typing import TypedDict
from langgraph.graph import StateGraph, START, END


class State(TypedDict, total=False):
    resume: str
    roles: list[str]
    message: str


def extract_roles(state: State):
    roles = []
    if "Java" in state["resume"]:
        roles.append("Java开发工程师")
    if "RAG" in state["resume"]:
        roles.append("AI应用开发工程师")
    return {"roles": roles}  # 节点返回状态更新，不必返回整个 state


def summarize(state: State):
    return {"message": "建议搜索：" + "、".join(state["roles"])}


builder = StateGraph(State)
builder.add_node("extract_roles", extract_roles)
builder.add_node("summarize", summarize)
builder.add_edge(START, "extract_roles")
builder.add_edge("extract_roles", "summarize")
builder.add_edge("summarize", END)
graph = builder.compile()

if __name__ == "__main__":
    print(graph.invoke({"resume": "Java开发，做过RAG应用。"})["message"])
