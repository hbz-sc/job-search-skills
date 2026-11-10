import argparse
import json
import logging
from pathlib import Path
from langgraph.checkpoint.sqlite import SqliteSaver
from ..errors import WorkflowError
from ..ledger import run_lock
from .bridge import CurrentListBridge
from .store import CurrentListStore
from .tools import CurrentListTools
from .logging import DiagnosticLog, error_code
from .graph import build_graph, initial_state


REASONS={"PREVIEW_COMPLETE":"只读预览已完成，未开启沟通，也未读取常用语。",
 "VALIDATION_PAUSE":"已完成本次单岗验收并返回列表；使用同批次 resume 继续。",
 "CONTACT_LIMIT":"已到达本批次沟通尝试上限。", "LIST_EXHAUSTED":"原列表已耗尽或连续无新增。",
 "CURRENT_LIST_REQUIRED":"请在已登录的 BOSS 职位列表连接扩展。",
 "EXTENSION_UPDATE_REQUIRED":"请重新加载0.8.0扩展并连接当前列表。",
 "BRIDGE_CONTRACT_MISMATCH":"桥服务或扩展仍是旧版，请重新加载扩展并连接。",
 "LIST_CONDITIONS_CHANGED":"原列表的城市、关键词或筛选发生变化，已暂停并保留现场。",
 "INVALID_BINDING":"扩展未绑定有效页面，请连接职位列表。",
 "BOSS_NOT_CONNECTED":"本地桥未连接，请在 BOSS 职位页连接扩展。",
 "QUOTA_REACHED":"平台沟通额度停止，已保留进度。",
 "FIRST_PHRASE_CHANGED":"第一条常用语变化，未继续发送。",
 "SEND_UNKNOWN":"未能确认消息结果，保留原请求，不重新发送。"}


def parser():
    p=argparse.ArgumentParser(description="从当前岗位列表沟通：不重新搜索，不改变城市/筛选，最多150次")
    commands=p.add_subparsers(dest="command",required=True)
    commands.add_parser("preview",help="只读当前列表，不沟通")
    run=commands.add_parser("run",help="真实沟通循环")
    run.add_argument("--max-contacts",type=int,default=150)
    run.add_argument("--stop-after",type=int,help="在原批次预算内，返回列表后提前暂停")
    run.add_argument("--confirm-send",action="store_true")
    resume=commands.add_parser("resume",help="恢复原批次，不重置预算")
    resume.add_argument("--batch",required=True)
    resume.add_argument("--confirm-send",action="store_true")
    resume.add_argument("--stop-after",type=int,help="原批次累计尝试数的暂停点")
    status=commands.add_parser("status",help="只读本地结果")
    status.add_argument("--batch",required=True)
    return p


def report(root,store):
    value=store.summary();directory=root/"output/jobpilot/current-list";directory.mkdir(parents=True,exist_ok=True)
    path=directory/(store.run_id+".json")
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding="utf-8")
    print(f"批次：{store.run_id}；状态：{value['status']}；原因：{value['stop_reason']}")
    print(f"读取岗位 {value['read_count']}；新候选 {value['candidate_count']}；跳过 {value['skipped_count']}；沟通尝试 {value['used_contacts']}/{value['max_contacts']}")
    phrase=str(value['phrase_read_count']) if value['phrase_read_count'] else ('已尝试，未成功' if value['phrase_attempt_count'] else '未执行')
    print(f"常用语读取成功：{phrase}；发送确认 {value['confirmed_count']}；发送失败 {value['failed_count']}；待核验 {value['uncertain_count']}；返回列表 {value['returned_count']}")
    print(REASONS.get(value['stop_reason'],"已保留原动作记录；请查看日志的失败节点与错误码。"))
    print("报告：",path)
    if store.log: print("日志：",store.log.path)
    return value


def run_current_list(argv,root):
    p=parser();args=p.parse_args(argv);root=Path(root)
    if args.command in {"run","resume"} and not args.confirm_send: p.error("真实沟通需 --confirm-send；只读请用 preview")
    if args.command=="run" and not 1<=args.max_contacts<=150: p.error("--max-contacts 必须为1到150")
    if getattr(args,"stop_after",None) is not None and not 1<=args.stop_after<=getattr(args,"max_contacts",150): p.error("--stop-after 必须在批次预算内")
    for name in ("httpx","mcp","langsmith"): logging.getLogger(name).setLevel(logging.CRITICAL)
    path=root/"data/boss.sqlite"
    if args.command=="status":
        try:
            summary=CurrentListStore.read_summary(path,args.batch)
            if summary.get("flow")!="current-list": raise WorkflowError("BATCH_FLOW_MISMATCH")
            print(json.dumps(summary,ensure_ascii=False,indent=2));return 0
        except WorkflowError as exc: print(error_code(str(exc)));return 1
    try:
        with run_lock(root/"private/boss-run-lock.sqlite"), CurrentListStore(path,batch_id=args.batch if args.command=="resume" else None,mode="preview" if args.command=="preview" else "run",max_contacts=getattr(args,"max_contacts",150)) as store:
            store.log=DiagnosticLog(root/"output/jobpilot/current-list"/(store.run_id+".jsonl"),store.run_id)
            store.log.emit("run","begin",mode="只读预览" if store.mode=="preview" else "真实沟通",budget=store.batch()["config"]["max_contacts"])
            if store.batch()["status"]=="completed": report(root,store);return 0
            bridge=None
            try:
                bridge=CurrentListBridge.connect(root,store)
                profilepath=root/"private/profile.json"
                profile=json.loads(profilepath.read_text(encoding="utf-8-sig")) if profilepath.exists() else {}
                tools=CurrentListTools(bridge,store,send_authorized=getattr(args,"confirm_send",False),profile=profile)
                with SqliteSaver.from_conn_string(str(root/"data/jobpilot-current-list-checkpoints.sqlite")) as saver:
                    graph=build_graph(tools,store,saver,stop_after=getattr(args,"stop_after",None))
                    config={"configurable":{"thread_id":store.run_id},"recursion_limit":8000}
                    saved=graph.get_state(config).values if args.command=="resume" else None
                    for _ in graph.stream(initial_state(store,saved),config,stream_mode="updates"): pass
            except KeyboardInterrupt: store.set_status("paused","USER_STOPPED")
            except Exception as exc:
                code=error_code(str(exc)) if isinstance(exc,WorkflowError) else "STARTUP_FAILED"
                store.set_status("paused",code);store.log.emit("run","failed",error=code)
            finally:
                if bridge: bridge.close()
            result=report(root,store)
            return 0 if result['status']=="completed" else 1
    except Exception as exc:
        print(error_code(str(exc)) if isinstance(exc,WorkflowError) else "STARTUP_FAILED");return 1
