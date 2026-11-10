"""第二周：把第一周的普通函数组织成真正的 LangGraph。

阅读顺序：LearningState → 节点函数 → 路由函数 → build_learning_graph。
本模块不调用模型或浏览器；待补充只是输出分类，不是 interrupt 暂停。
"""
import argparse
import json
import sys
from pathlib import Path
from typing import TypedDict
from uuid import uuid4

from langgraph.graph import END, START, StateGraph
from .week1 import read_jobs, filter_jobs


class LearningState(TypedDict, total=False):
    """State 是跨节点的数据快照；TypedDict 不负责运行时校验。"""
    source: str                  # 输入文件
    city: str                    # 筛选目标
    root: str                    # 项目目录，报告写在 output 内
    jobs: list[dict]             # 已校验的原始岗位
    report: dict                 # 第一周筛选结果，含统计和未知城市岗位
    ready_jobs: list[dict]       # 城市符合且正文齐全；不代表简历匹配
    needs_description: list[dict]
    notices: list[str]           # 待补充节点产生的说明
    visited_nodes: list[str]     # 教学用执行轨迹
    error: str
    report_path: str
    status: str


def load_jobs_node(state: LearningState):
    """读取 source，返回 jobs 或 error，保留其他状态字段。"""
    try:
        if not isinstance(state.get("city"), str) or not state["city"].strip():
            raise ValueError("城市不能为空且必须是字符串")
        jobs = read_jobs(state["source"])
        return {"jobs": jobs, "city": state["city"].strip(),
                "error": "", "visited_nodes": ["load_jobs"]}
    except (OSError, ValueError) as exc:
        return {"jobs": [], "error": str(exc), "status": "failed",
                "visited_nodes": ["load_jobs"]}


def filter_jobs_node(state: LearningState):
    """复用第一周筛选；将目标城市岗位按正文完整程度分组。"""
    report = filter_jobs(state["jobs"], state["city"])
    ready, missing = [], []
    for job in report["jobs"]:
        if job["missing_description"]:
            missing.append(job)
        else:
            ready.append(job)
    return {"report": report, "ready_jobs": ready, "needs_description": missing,
            "notices": [], "visited_nodes": state["visited_nodes"] + ["filter_jobs"]}


def mark_missing_node(state: LearningState):
    """没有补写/猜测正文，仅生成用户可以执行的补充清单。"""
    notices = []
    for job in state["needs_description"]:
        identity = job["url"] or job["jobId"] or "身份未提供"
        notices.append(f"请补充岗位正文：{job['title']}（{identity}）")
    return {"notices": notices,
            "visited_nodes": state["visited_nodes"] + ["mark_missing"]}


def save_report_node(state: LearningState):
    """输出节点：保存最终结果，返回文件位置。"""
    visited = state["visited_nodes"] + ["save_report"]
    status = "needs_info" if state["needs_description"] or state["report"]["needs_info"] else "completed"
    report = {**state["report"], "ready_jobs": state["ready_jobs"],
              "needs_description": state["needs_description"], "notices": state["notices"],
              "visited_nodes": visited, "status": status}
    lines = ["# 第二周 LangGraph 岗位报告", "", f"状态：{status}",
             "", "执行路径：" + " → ".join(visited),
             "", "统计：" + json.dumps(report["counts"], ensure_ascii=False),
             "", "仅做本地资料分类；正文齐全不代表简历匹配或已联系。"]
    groups = (("正文齐全", state["ready_jobs"]),
              ("正文待补充", state["needs_description"]),
              ("城市待确认", report["needs_info"]))
    for label, jobs in groups:
        lines += ["", f"## {label}", ""]
        if not jobs:
            lines.append("无")
        for job in jobs:
            lines.append(f"- {job['title']} / {job['company'] or '公司未知'} / {job['city'] or '城市未知'}")
            lines.append(f"  - 薪资：{job['salary'] or '未知'}；链接：{job['url'] or '未提供'}；ID：{job['jobId'] or '未提供'}")
            lines.append(f"  - 正文：{'待补充' if job['missing_description'] else '已提供'}；判重身份：{'缺失，保留此条' if job['missing_identity'] else '已提供'}")
    lines += ["", "## 补充任务", ""] + (state["notices"] or ["无正文补充任务；城市待确认项见上方。"])
    directory = Path(state["root"]) / "output/jobpilot/week2" / uuid4().hex
    directory.mkdir(parents=True, exist_ok=False)
    path = directory / "report.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    path.with_suffix(".md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return {"report": report, "report_path": str(path), "status": status, "visited_nodes": visited}


def route_after_load(state: LearningState):
    """条件边1：读取失败立即结束，不继续处理错误数据。"""
    return "stop" if state.get("error") else "continue"


def route_after_filter(state: LearningState):
    """条件边2：路由只决定下一步，不读文件、不修改状态。"""
    return "missing" if state["needs_description"] else "ready"


def build_learning_graph():
    graph = StateGraph(LearningState)
    # 节点：名字 → 函数。这里没有立即调用函数。
    graph.add_node("load_jobs", load_jobs_node)
    graph.add_node("filter_jobs", filter_jobs_node)
    graph.add_node("mark_missing", mark_missing_node)
    graph.add_node("save_report", save_report_node)
    # 固定边和条件边决定执行顺序。
    graph.add_edge(START, "load_jobs")
    graph.add_conditional_edges("load_jobs", route_after_load,
                                {"stop": END, "continue": "filter_jobs"})
    graph.add_conditional_edges("filter_jobs", route_after_filter,
                                {"missing": "mark_missing", "ready": "save_report"})
    graph.add_edge("mark_missing", "save_report")
    graph.add_edge("save_report", END)
    return graph.compile()


def run_graph_learning(argv, root):
    parser = argparse.ArgumentParser(description="第二周：本地岗位 LangGraph，显示节点与条件分支")
    parser.add_argument("--jobs", type=Path, default=Path("examples/python/week1-jobs.json"))
    parser.add_argument("--city", default="深圳")
    args = parser.parse_args(argv)
    if not args.city.strip():
        parser.error("城市不能为空")
    initial_state = {"source": str(Path(root) / args.jobs), "city": args.city.strip(), "root": str(root)}
    try:
        graph = build_learning_graph()
        for event in graph.stream(initial_state, stream_mode="updates"):
            for node, update in event.items():
                print(f"[{node}]", "失败" if update.get("error") else "完成")
                if update.get("error"):
                    print("学习图失败：" + update["error"], file=sys.stderr)
                    return 1
                if "report_path" in update:
                    print("状态：", update["status"])
                    print("[报告]", update["report_path"])
                    print("[阅读版]", Path(update["report_path"]).with_suffix(".md"))
        return 0
    except (OSError, ValueError) as exc:
        print(f"学习图失败：{exc}", file=sys.stderr)
        return 1
