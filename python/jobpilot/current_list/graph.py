from functools import wraps
import time
from langgraph.graph import StateGraph, START, END
from ..errors import WorkflowError
from .state import CurrentListState
from .logging import error_code


def initial_state(store, saved=None):
    state={"batch_id":store.run_id,"mode":store.mode,"seen_job_keys":[],"candidates":[],"step":0,"advances":0,"no_new":0,**(saved or {})}
    job=state.get("current_job")
    if job and not state.get("attempt_id") and not store.should_skip(job["key"]) and not store.db.execute("SELECT 1 FROM fixed_events WHERE batch_id=? AND event_key=?",(store.run_id,"skip:"+job["key"])).fetchone():
        # 选择完成但尚未占额时中断，该岗位没有外部副作用，恢复后重新观察。
        state["seen_job_keys"]=[key for key in state["seen_job_keys"] if key!=job["key"]]
    return {**state,"status":"running","stop_reason":"","route":"","current_job":None,"attempt_id":None}


def build_graph(tools, store, checkpointer=None, *, stop_after=None):
    def safe(fn):
        @wraps(fn)
        def run(state):
            start=time.monotonic();name=fn.__name__
            if store.log: store.log.emit("node","begin",node=name)
            try:
                update=fn(state)
                if store.log: store.log.emit("node","complete",node=name,elapsed_ms=round((time.monotonic()-start)*1000))
            except Exception as exc:
                code=error_code(str(exc)) if isinstance(exc,WorkflowError) else "WORKFLOW_FAILED"
                if state.get("attempt_id"): store.finish(state["attempt_id"],"uncertain",{"code":code,"retry":False})
                if "QUOTA" in code: store.stop_quota()
                store.set_status("paused",code)
                if store.log: store.log.emit("node","failed",node=name,error=code,elapsed_ms=round((time.monotonic()-start)*1000))
                update={"status":"paused","stop_reason":code}
            return {**update,"step":state.get("step",0)+1}
        return run

    @safe
    def preflight(s):
        store.set_status("running")
        pending=tools.preflight()
        if pending: return {"current_job":pending["job"],"attempt_id":pending["id"],"route":"restore" if pending.get("phase") in {"confirmed","failed"} else "recover_contact"}
        return {"route":"read_list"}

    @safe
    def read_list(s): return {"view":tools.read_list(),"advancing":False}

    @safe
    def collect(s):
        view=s["view"];store.pin_snapshot(view["snapshot"])
        jobs=view["jobs"];seen=set(s["seen_job_keys"])
        fresh=[j for j in jobs if j["key"] not in seen]
        eventkey=f"list:{s['step']}"
        store.event(eventkey,{"status":"list_read","count":len(jobs)})
        store.event(eventkey+":fresh",{"status":"candidates","count":len(fresh)})
        for job in jobs:
            store.event("seen:"+job["key"],{"status":"job_seen","job_key":job["key"]})
            if job.get("experience") in {"exp_1_3","exp_3_5"}:
                store.event("eligible:"+job["key"],{"status":"candidate_seen","job_key":job["key"]})
        if store.log: store.log.emit("list","observed",count=len(jobs),city=view["snapshot"].get("city"),keyword=view["snapshot"].get("keyword"),fingerprint=view["snapshot"]["fingerprint"])
        no_new=s.get("no_new",0)
        if s.get("advancing"): no_new=no_new+1 if not fresh else 0
        if s["mode"]=="preview":
            store.event("preview",{"status":"preview","jobs":jobs})
            return {"status":"completed","stop_reason":"PREVIEW_COMPLETE"}
        return {"candidates":fresh,"no_new":no_new,"advancing":False,"exhausted":view["exhausted"] or no_new>=3 or s.get("advances",0)>=50}

    @safe
    def select(s):
        used=store.summary()["used_contacts"]
        if used>=store.batch()["config"]["max_contacts"]: return {"status":"completed","stop_reason":"CONTACT_LIMIT"}
        if stop_after is not None and used>=stop_after: return {"status":"paused","stop_reason":"VALIDATION_PAUSE"}
        seen=list(s["seen_job_keys"]);candidates=list(s["candidates"])
        while candidates:
            job=candidates.pop(0)
            if job["key"] in seen: continue
            seen.append(job["key"])
            reason="ALREADY_RECORDED" if store.should_skip(job["key"]) else "EXPERIENCE_NOT_SUPPORTED" if job.get("experience") not in {"exp_1_3","exp_3_5"} else None
            if reason:
                store.event("skip:"+job["key"],{"status":"skipped","job_key":job["key"],"reason":reason})
                if store.log: store.log.emit("job","skipped",job_key=job["key"],error=reason)
                continue
            if store.log: store.log.emit("job","selected",job_key=job["key"],company=job["company"],title=job["title"])
            return {"current_job":job,"attempt_id":None,"seen_job_keys":seen,"candidates":candidates,"route":"inspect_job"}
        if s["exhausted"]: return {"status":"completed","stop_reason":"LIST_EXHAUSTED","seen_job_keys":seen}
        return {"seen_job_keys":seen,"candidates":[],"route":"advance"}

    @safe
    def inspect_job(s):
        job=tools.inspect_job(s["current_job"])
        if job.get("status")=="skipped":
            store.event("skip:"+s["current_job"]["key"],{**job,"job_key":s["current_job"]["key"]})
            return {"route":"restore"}
        return {"current_job":job,"route":"reserve"}

    @safe
    def reserve(s):
        attempt=store.reserve(s["current_job"])
        return {"attempt_id":attempt,"route":"open_chat" if attempt else "restore"}

    @safe
    def open_chat(s):
        chat=tools.open_chat(s["current_job"],s["attempt_id"])
        return {"route":"restore" if chat.get("status")=="skipped" else "verify_phrase"}

    @safe
    def recover_contact(s):
        tools.recover_contact(s["current_job"],s["attempt_id"])
        return {"route":"verify_phrase"}

    @safe
    def verify_phrase(s):
        store.event("phrase-attempt:"+s["attempt_id"],{"status":"phrase_attempt"})
        tools.verify_phrase(s["current_job"])
        store.event("phrase:"+s["attempt_id"],{"status":"phrase_read"})
        return {}

    @safe
    def send_phrase(s): tools.send_phrase(s["current_job"],s["attempt_id"]);return {}

    @safe
    def inspect_result(s): tools.inspect_result(s["current_job"],s["attempt_id"]);return {}

    @safe
    def restore(s):
        view=tools.restore()
        store.pin_snapshot(view["snapshot"])
        if s.get("attempt_id"): store.event("return:"+s["attempt_id"],{"status":"returned"})
        return {"view":view,"current_job":None,"attempt_id":None,"advancing":False}

    @safe
    def advance(s): return {"view":tools.advance(),"advances":s.get("advances",0)+1,"advancing":True}

    def summarize(s):
        status="paused" if s.get("status")=="paused" else "completed"
        store.set_status(status,s.get("stop_reason","LIST_EXHAUSTED"))
        return {"report":store.summary(),"status":status}

    graph=StateGraph(CurrentListState)
    for fn in (preflight,read_list,collect,select,inspect_job,reserve,open_chat,recover_contact,verify_phrase,send_phrase,inspect_result,restore,advance,summarize): graph.add_node(fn.__name__,fn)
    graph.add_edge(START,"preflight")
    fixed={"read_list":"collect","collect":"select","verify_phrase":"send_phrase","send_phrase":"inspect_result","inspect_result":"restore","restore":"collect","advance":"collect"}
    for name in ("preflight","read_list","collect","select","inspect_job","reserve","open_chat","recover_contact","verify_phrase","send_phrase","inspect_result","restore","advance"):
        graph.add_conditional_edges(name,lambda s,n=name: "summarize" if s.get("status")!="running" else fixed.get(n,s.get("route")))
    graph.add_edge("summarize",END)
    return graph.compile(checkpointer=checkpointer)
