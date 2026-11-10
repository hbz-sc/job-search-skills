"""真实固定岗位入口。默认预览；run/resume 的发送授权仅用于本次批次。"""
import argparse
import json
import logging
from pathlib import Path
from langgraph.checkpoint.sqlite import SqliteSaver
from ..bridge import BossBridge
from ..errors import WorkflowError
from ..ledger import run_lock
from .store import BatchStore
from .tools import FixedTools
from .graph import build_graph, initial_state

LABELS = {"load_config": "读取固定搜索配置", "preflight": "检查网页与常用语", "search_and_filter": "搜索并验证经验",
          "collect_candidates": "读取岗位", "select_candidate": "选择下一个岗位", "inspect_job": "核对岗位详情",
          "reserve_contact": "占用一次额度", "open_chat": "打开沟通", "recover_contact": "核验原沟通进度",
          "verify_phrase": "核对第一条常用语", "send_phrase": "发送常用语", "inspect_result": "核实发送结果",
          "restore_search": "返回岗位列表", "advance_results": "加载更多岗位", "next_band": "切换经验档位", "summarize": "保存结果"}
REASONS = {"BOSS_NOT_CONNECTED": "浏览器扩展未连接，请在已登录的 BOSS 页面连接扩展。",
           "INVALID_BINDING": "当前没有有效页面绑定，请在 BOSS 职位页或聊天页点击扩展的连接此页面。",
           "CITY_MISMATCH": "页面城市与该批次配置不符；新建 fixed-search preview 将沿用页面当前城市。",
           "INVALID_SCOPE": "扩展拒绝了任务参数，任务未启动。请在 Edge 扩展管理页重新加载 JobPilot，再回到 BOSS 职位页连接；若仍失败，请保留本批次报告。",
           "BRIDGE_CONTRACT_MISMATCH": "运行中的桥与新代码不匹配，请重载扩展并重新连接。",
           "EXTENSION_UPDATE_REQUIRED": "请重新加载并连接 0.7.1 版本扩展。",
           "TEMPLATE_READ_REQUIRES_EXISTING_CHAT": "请先打开一个已有聊天，再运行；程序将只读取得第一条常用语。",
           "FIRST_PHRASE_CHANGED": "第一条常用语不一致，已暂停。",
           "AUTHORIZED_TARGET_CHANGED": "浏览器会话或标签改变，不能自动迁移原批次授权。",
           "CONTACT_LIMIT": "已达到本批沟通尝试上限。", "VALIDATION_PAUSE": "单岗验收暂停，可使用原批次 ID 继续。",
           "ACTION_UNKNOWN": "外部动作结果未知，保留原请求，未重新发送。",
           "QUOTA_REACHED": "账号额度停止，已保留证据。", "PREVIEW_COMPLETE": "真实搜索预览结束，未开启新沟通。",
           "QUERIES_EXHAUSTED": "两档经验的有界遍历结束。", "USER_STOPPED": "已停止；继续前将核验未完成动作。"}


def parser_for_fixed():
    parser = argparse.ArgumentParser(description="固定 Java全栈开发工程师 / 页面当前城市 / 1–3、3–5 年；不需要简历或模型")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("preview", help="真实搜索预览，零发送")
    run = commands.add_parser("run", help="新建有界真实沟通批次")
    run.add_argument("--max-contacts", type=int, default=150)
    run.add_argument("--confirm-send", action="store_true")
    run.add_argument("--stop-after", type=int, help="在原预算内提前暂停，首次实站验收可用1")
    resume = commands.add_parser("resume", help="继续原批次，预算不会重置")
    resume.add_argument("--batch", required=True)
    resume.add_argument("--confirm-send", action="store_true")
    status = commands.add_parser("status", help="只读查看本地批次")
    status.add_argument("--batch", required=True)
    return parser


def write_report(root, report):
    directory = root / "output/jobpilot/fixed-search"
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / (report["batch_id"] + ".json")
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    reason = report["stop_reason"]
    print(f"批次：{report['batch_id']}\n状态：{report['status']}；原因：{reason}")
    print("搜索城市：", "、".join(report.get("observed_cities", [])) or ("跟随页面（尚未完成读取）" if report.get("city") == "current" else report.get("city", "未知")))
    print(f"已占用沟通尝试 {report['used_contacts']}/{report['max_contacts']}；确认发送 {report['confirmed_count']}；跳过 {report['skipped_count']}；待核验 {report['uncertain_count']}")
    print(REASONS.get(reason, "请根据错误码核对页面；本次已保留进度。"))
    print("结果文件：", target)


def run_fixed_search(argv, root):
    root = Path(root)
    parser = parser_for_fixed()
    args = parser.parse_args(argv)
    if args.command in {"run", "resume"} and not args.confirm_send:
        parser.error("真实沟通需要 --confirm-send；只查看岗位请用 preview")
    if args.command == "run":
        if not 1 <= args.max_contacts <= 150:
            parser.error("--max-contacts 必须是 1 到 150")
        if args.stop_after is not None and not 1 <= args.stop_after <= args.max_contacts:
            parser.error("--stop-after 必须在本批预算范围内")
    for logger in ("httpx", "mcp", "langsmith"):
        logging.getLogger(logger).setLevel(logging.CRITICAL)
    path = root / "data/boss.sqlite"
    if args.command == "status":
        try:
            print(json.dumps(BatchStore.read_summary(path, args.batch), ensure_ascii=False, indent=2))
            return 0
        except WorkflowError as exc:
            print(str(exc))
            return 1
    try:
        with run_lock(root / "private/boss-run-lock.sqlite"):
            with BatchStore(path, batch_id=args.batch if args.command == "resume" else None,
                            mode="preview" if args.command == "preview" else "run", max_contacts=getattr(args, "max_contacts", 150)) as store:
                if store.batch()["status"] == "completed":
                    write_report(root, store.summary())
                    return 0
                print("批次：", store.run_id, flush=True)
                bridge = None
                try:
                    bridge = BossBridge.connect(root, store)
                    profile_path = root / "private/profile.json"
                    profile = json.loads(profile_path.read_text(encoding="utf-8-sig")) if profile_path.exists() else {}
                    tools = FixedTools(bridge, store, send_authorized=getattr(args, "confirm_send", False), profile=profile)
                    with SqliteSaver.from_conn_string(str(root / "data/jobpilot-fixed-checkpoints.sqlite")) as saver:
                        graph = build_graph(tools, store, saver, stop_after=getattr(args, "stop_after", None))
                        config = {"configurable": {"thread_id": store.run_id}, "recursion_limit": 8000}
                        saved = graph.get_state(config).values if args.command == "resume" else None
                        for event in graph.stream(initial_state(store, saved), config, stream_mode="updates"):
                            for name, update in event.items():
                                counts = store.summary()
                                print(f"[{name}] {LABELS.get(name, name)}；尝试 {counts['used_contacts']}/{counts['max_contacts']}；确认 {counts['confirmed_count']}" + (f"；{update['stop_reason']}" if update.get("stop_reason") else ""), flush=True)
                except KeyboardInterrupt:
                    store.set_status("paused", "USER_STOPPED")
                except Exception as exc:
                    store.set_status("paused", str(exc) if isinstance(exc, WorkflowError) else "STARTUP_FAILED")
                finally:
                    if bridge:
                        bridge.close()
                report = store.summary()
                write_report(root, report)
                return 0 if report["status"] == "completed" else 1
    except Exception as exc:
        print(str(exc) if isinstance(exc, WorkflowError) else "STARTUP_FAILED")
        return 1
