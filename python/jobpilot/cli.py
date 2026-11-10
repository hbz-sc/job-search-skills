"""主入口：python -m jobpilot demo / preview / run。"""
import argparse
import json
import logging
import os
import sys
import tempfile
from contextlib import nullcontext
from pathlib import Path

os.environ["LANGSMITH_TRACING"] = "false"
os.environ["LANGCHAIN_TRACING_V2"] = "false"

from dotenv import dotenv_values
from .bridge import BossBridge
from .errors import WorkflowError
from .graph import build_graph
from .ledger import Ledger, run_lock
from .model import demo_planner, model_planner
from .tools import DemoTools, LiveTools


def main(argv=None, root=None):
    root = Path(root or Path(__file__).resolve().parents[2])
    args = list(sys.argv[1:] if argv is None else argv)
    if args[:1] == ["jobpilot"]:  # 兼容boss.cmd jobpilot转交
        args.pop(0)
    if args[:1] == ["current-list"]:
        from .current_list.cli import run_current_list
        return run_current_list(args[1:], root)
    if args[:1] == ["fixed-search"]:
        from .fixed_search.cli import run_fixed_search
        return run_fixed_search(args[1:], root)
    if args[:1] == ["learn"]:
        from .week1 import run_learning
        return run_learning(args[1:], root)
    if args[:1] == ["learn-graph"]:
        from .week2 import run_graph_learning
        return run_graph_learning(args[1:], root)
    if args[:1] == ["learn-model"]:
        from .week3 import run_model_learning
        return run_model_learning(args[1:], root)
    if args[:1] == ["check-model"]:
        from .practice import run_check_model
        return run_check_model(args[1:], root)
    if args[:1] == ["analyze"]:
        from .practice import run_practice
        return run_practice(args[1:], root)
    parser = argparse.ArgumentParser(description="Python 求职助手：check-model 模型诊断；analyze 实战资料分析；learn 第一周；learn-graph 第二周；learn-model 第三周（真实模型）；demo模拟业务图；preview真实搜索零联系；run显式联系")
    parser.add_argument("mode", nargs="?", default="demo", choices=["demo", "preview", "run"])
    parser.add_argument("--resume", type=Path, help="UTF-8简历文本路径；真实模式必填")
    parser.add_argument("--template-id", help="已读取的第一条常用语模板ID，默认取最近一条")
    parser.add_argument("--confirm-send", action="store_true", help="仅本次run允许真实联系，最多1个岗位")
    parser.add_argument("--retry-historical-quota", action="store_true", help="检查页面后允许重试旧日期的额度记录，不清除历史")
    parsed = parser.parse_args(args)
    if parsed.mode != "demo" and parsed.resume is None:
        parser.error("preview/run需要--resume；学习入门请先执行demo")
    if parsed.mode == "run" and not parsed.confirm_send:
        parser.error("真实联系必须显式提供--confirm-send；preview不会发送")
    if parsed.mode != "run" and (parsed.confirm_send or parsed.retry_historical_quota or parsed.template_id):
        parser.error("发送参数仅适用于run")
    for logger in ("httpx", "mcp", "langsmith"):
        logging.getLogger(logger).setLevel(logging.CRITICAL)
    try:
        with tempfile.TemporaryDirectory(prefix="jobpilot-demo-") as temp:
            db = Path(temp) / "demo.sqlite" if parsed.mode == "demo" else root / "data/boss.sqlite"
            lock = nullcontext() if parsed.mode == "demo" else run_lock(root / "private/boss-run-lock.sqlite")
            with lock, Ledger(db, parsed.mode) as ledger:
                bridge = None
                try:
                    if parsed.mode == "demo":
                        resume = "三年Java与React全栈开发经历，做过RAG知识库应用。"
                        planner, tools = demo_planner, DemoTools(ledger)
                    else:
                        resume = (root / parsed.resume).read_text(encoding="utf-8-sig")
                        config = {**dotenv_values(root / ".env"), **os.environ}
                        planner = model_planner(config)
                        template = ledger.load_template(parsed.template_id) if parsed.mode == "run" else None
                        profile_file = root / "private/profile.json"
                        profile = json.loads(profile_file.read_text(encoding="utf-8-sig")) if profile_file.exists() else {}
                        bridge = BossBridge.connect(root, ledger)
                        tools = LiveTools(bridge, ledger, parsed.mode, template, send_authorized=parsed.confirm_send,
                                          profile=profile, retry_historical_quota=parsed.retry_historical_quota)
                    graph = build_graph(planner, tools, ledger)
                    report = None
                    for event in graph.stream({"resume": resume, "mode": parsed.mode}, stream_mode="updates"):
                        for node, update in event.items():
                            print(f"[{node}]", "暂停：" + update["error"] if update.get("error") else "完成")
                            if "report" in update:
                                report = {**update["report"], "run_id": ledger.run_id}
                    if report is None:
                        raise WorkflowError("REPORT_MISSING")
                    out = root / "output/jobpilot/python" / (ledger.run_id + ".json")
                    out.parent.mkdir(parents=True, exist_ok=True)
                    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
                    print(json.dumps(report, ensure_ascii=False, indent=2))
                    print("结果文件：", out)
                    return 1 if report["error"] or report["result"]["status"] in {"unknown", "failed"} else 0
                finally:
                    if bridge:
                        bridge.close()
    except Exception as exc:
        code = str(exc) if isinstance(exc, WorkflowError) else "STARTUP_FAILED"
        print(json.dumps({"error": code}, ensure_ascii=False), file=sys.stderr)
        return 1
