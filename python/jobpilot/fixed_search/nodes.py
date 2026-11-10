"""每个函数对应一个业务步骤；返回字典只更新相关 State 字段。"""
from functools import wraps
from ..errors import WorkflowError
from .state import BANDS


def make_nodes(tools, store, *, stop_after=None):
    def safe(fn):
        @wraps(fn)
        def run(state):
            try:
                return {**fn(state), "step": state.get("step", 0) + 1}
            except Exception as exc:
                code = str(exc) if isinstance(exc, WorkflowError) else "WORKFLOW_FAILED"
                attempt = state.get("attempt_id")
                if attempt:
                    store.finish(attempt, "uncertain", {"code": code, "retry": False})
                if "QUOTA" in code:
                    store.stop_quota()
                store.set_status("paused", code)
                return {"status": "paused", "stop_reason": code, "route": "summarize", "step": state.get("step", 0) + 1}
        return run

    @safe
    def load_config(state):
        config = store.batch()["config"]
        if state["batch_id"] != store.run_id or state["mode"] != config["mode"]:
            raise WorkflowError("BATCH_CONFIG_MISMATCH")
        store.set_status("running")
        return {"status": "running", "stop_reason": ""}

    @safe
    def preflight(state):
        pending = tools.preflight()
        if pending:
            job = pending["job"]
            return {"current_job": job, "attempt_id": pending["id"], "band_index": BANDS.index(job["experience"]), "route": "recover_contact"}
        return {"current_job": None, "attempt_id": None, "route": "search_and_filter"}

    @safe
    def search_and_filter(state):
        return {"view": tools.search(BANDS[state["band_index"]]), "advancing": False}

    @safe
    def collect_candidates(state):
        view = state["view"]
        seen = set(state["seen_job_keys"])
        fresh = [j for j in view["jobs"] if j["key"] not in seen]
        no_new = state.get("no_new", 0)
        if state.get("advancing"):
            no_new = 0 if fresh else no_new + 1
        if state["mode"] == "preview":
            store.event("preview:" + BANDS[state["band_index"]], {"status": "preview", "experience": BANDS[state["band_index"]], "jobs": view["jobs"]})
        return {"candidates": fresh, "exhausted": view["exhausted"] or no_new >= 3 or state.get("advances", 0) >= 50,
                "no_new": no_new, "advancing": False}

    @safe
    def select_candidate(state):
        if state["mode"] == "preview":
            return {"route": "next_band"}
        counts = store.summary()
        if counts["used_contacts"] >= counts["max_contacts"]:
            return {"status": "completed", "stop_reason": "CONTACT_LIMIT", "route": "summarize"}
        if stop_after is not None and counts["used_contacts"] >= stop_after:
            return {"status": "paused", "stop_reason": "VALIDATION_PAUSE", "route": "summarize"}
        seen = list(state["seen_job_keys"])
        candidates = list(state["candidates"])
        while candidates:
            job = candidates.pop(0)
            if job["key"] in seen:
                continue
            seen.append(job["key"])
            if store.should_skip(job["key"]):
                store.event("skip:" + job["key"], {"status": "skipped", "job_key": job["key"], "reason": "ALREADY_RECORDED"})
                continue
            return {"current_job": job, "attempt_id": None, "seen_job_keys": seen, "candidates": candidates, "route": "inspect_job"}
        return {"current_job": None, "attempt_id": None, "seen_job_keys": seen, "candidates": [],
                "route": "next_band" if state["exhausted"] else "advance_results"}

    @safe
    def inspect_job(state):
        detail = tools.inspect_job(state["current_job"])
        if detail.get("status") == "skipped":
            store.event("skip:" + state["current_job"]["key"], {**detail, "job_key": state["current_job"]["key"]})
            return {"route": "restore_search"}
        return {"current_job": detail, "route": "reserve_contact"}

    @safe
    def reserve_contact(state):
        attempt = store.reserve(state["current_job"])
        return {"attempt_id": attempt, "route": "open_chat" if attempt else "restore_search"}

    @safe
    def open_chat(state):
        chat = tools.open_chat(state["current_job"], state["attempt_id"])
        return {"chat": chat, "route": "restore_search" if chat.get("status") == "skipped" else "verify_phrase"}

    @safe
    def recover_contact(state):
        chat = tools.recover_contact(state["current_job"], state["attempt_id"])
        return {"chat": chat, "route": "restore_search" if chat.get("status") == "skipped" else "verify_phrase"}

    @safe
    def verify_phrase(state):
        tools.verify_phrase(state["current_job"])
        return {}

    @safe
    def send_phrase(state):
        tools.send_phrase(state["current_job"], state["attempt_id"])
        return {}

    @safe
    def inspect_result(state):
        tools.inspect_result(state["current_job"], state["attempt_id"])
        return {}

    @safe
    def restore_search(state):
        return {"view": tools.restore(BANDS[state["band_index"]]), "advancing": False, "current_job": None, "attempt_id": None}

    @safe
    def advance_results(state):
        return {"view": tools.advance(BANDS[state["band_index"]]), "advances": state.get("advances", 0) + 1, "advancing": True}

    @safe
    def next_band(state):
        index = state["band_index"] + 1
        if state["mode"] != "preview":
            reason = "NO_NEW_RESULTS" if state.get("no_new", 0) >= 3 else "ADVANCE_LIMIT" if state.get("advances", 0) >= 50 else "LIST_EXHAUSTED"
            store.event("query-end:" + BANDS[state["band_index"]], {"status": "query_end", "reason": reason})
        if index >= len(BANDS):
            return {"status": "completed", "stop_reason": "PREVIEW_COMPLETE" if state["mode"] == "preview" else "QUERIES_EXHAUSTED", "route": "summarize"}
        return {"band_index": index, "advances": 0, "no_new": 0, "candidates": [], "route": "search_and_filter"}

    def summarize(state):
        status = "paused" if state.get("status") == "paused" else "completed"
        store.set_status(status, state.get("stop_reason", "QUERIES_EXHAUSTED"))
        return {"status": status, "report": store.summary()}

    return {fn.__name__: fn for fn in (load_config, preflight, search_and_filter, collect_candidates, select_candidate,
            inspect_job, reserve_contact, open_chat, recover_contact, verify_phrase, send_phrase, inspect_result,
            restore_search, advance_results, next_band, summarize)}
