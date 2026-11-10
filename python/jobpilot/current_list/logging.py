"""只记录业务诊断字段，不记录认证数据或聊天正文。"""
import json
import re
from datetime import datetime, timezone, timedelta


def error_code(value):
    return value if isinstance(value, str) and re.fullmatch(r"[A-Z][A-Z0-9_:]{0,119}", value) else "UNEXPECTED_ERROR"


class DiagnosticLog:
    FIELDS = {"tool", "node", "request_id", "elapsed_ms", "job_key", "company", "title", "error", "mode", "budget", "count", "status", "city", "keyword", "fingerprint", "phrase_length", "phrase_hash", "phase"}

    def __init__(self, path, batch_id, echo=True):
        self.path, self.batch_id, self.echo = path, batch_id, echo
        path.parent.mkdir(parents=True, exist_ok=True)

    def emit(self, kind, stage, **fields):
        safe = {k: v[:200] if isinstance(v, str) else v for k, v in fields.items() if k in self.FIELDS and isinstance(v, (str, int, float, bool, type(None)))}
        if safe.get("error") is None:
            safe.pop("error", None)
        else:
            safe["error"] = error_code(safe["error"])
        details=fields.get("details")
        if isinstance(details,dict):
            safe_details={}
            for side in ("expected","observed"):
                snapshot=details.get(side)
                if not isinstance(snapshot,dict): continue
                item={k:snapshot[k][:200] for k in ("fingerprint","city","keyword") if isinstance(snapshot.get(k),str)}
                filters=snapshot.get("filters")
                if isinstance(filters,dict):
                    item["filters"]={k:[v[:120] for v in filters[k][:40] if isinstance(v,str)] for k in ("cityLabels","controls","selectedOptions") if isinstance(filters.get(k),list)}
                safe_details[side]=item
            if safe_details: safe["conditions"]=safe_details
        event = {"at": datetime.now(timezone(timedelta(hours=8))).isoformat(), "batch_id": self.batch_id, "kind": kind, "stage": stage, **safe}
        with self.path.open("a", encoding="utf-8") as f: f.write(json.dumps(event, ensure_ascii=False) + "\n")
        if self.echo:
            detail = "；".join(f"{k}={v}" for k,v in safe.items() if v is not None)
            print(f"[{kind}:{stage}] {detail}", flush=True)

