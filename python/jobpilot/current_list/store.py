import json
import re
import time
from ..fixed_search.store import BatchStore
from ..errors import WorkflowError
from .logging import error_code


class CurrentListStore(BatchStore):
    def __init__(self, path, batch_id=None, mode="run", max_contacts=150):
        super().__init__(path,batch_id,mode,max_contacts)
        self.log = None
        self.action_times = {}
        if batch_id:
            if self.batch()["config"].get("flow") != "current-list":
                self.db.close(); raise WorkflowError("BATCH_FLOW_MISMATCH")
        else:
            config = {**self.batch()["config"], "flow": "current-list", "keyword": "current", "snapshot": None}
            self.db.execute("UPDATE fixed_batches SET config=? WHERE id=?", (json.dumps(config),self.run_id))

    def pin_snapshot(self, snapshot):
        if not isinstance(snapshot,dict) or not isinstance(snapshot.get("fingerprint"),str) or not re.fullmatch(r"[a-f0-9]{64}",snapshot["fingerprint"]):
            raise WorkflowError("LIST_SNAPSHOT_INVALID")
        config = self.batch()["config"]
        if config.get("snapshot") and config["snapshot"]["fingerprint"] != snapshot["fingerprint"]:
            raise WorkflowError("LIST_CONDITIONS_CHANGED")
        config["snapshot"] = snapshot
        self.db.execute("UPDATE fixed_batches SET config=? WHERE id=?", (json.dumps(config,ensure_ascii=False),self.run_id))

    def before_action(self, command):
        super().before_action(command)
        rid = command["context"]["requestId"]
        self.action_times[rid] = time.monotonic()
        if self.log: self.log.emit("tool","begin",tool=command["tool"],request_id=rid)

    def after_action(self, request_id, result):
        super().after_action(request_id,result)
        if self.log:
            row=self.db.execute("SELECT command FROM python_actions WHERE id=?",(request_id,)).fetchone()
            tool=json.loads(row[0])["tool"] if row else "recover"
            code=error_code(result.get("error",{}).get("code")) if result.get("error") else None
            self.log.emit("tool","complete" if result.get("phase")=="observed" else "failed",tool=tool,request_id=request_id,phase=result.get("phase"),error=code,details=result.get("error",{}).get("details"),elapsed_ms=round((time.monotonic()-self.action_times.pop(request_id,time.monotonic()))*1000))

    def summary(self):
        result=super().summary();events=result["events"]
        result.update(read_count=sum(e.get("status")=="job_seen" for e in events),
                      candidate_count=sum(e.get("status")=="candidate_seen" for e in events),
                      phrase_read_count=sum(e.get("status")=="phrase_read" for e in events),
                      phrase_attempt_count=sum(e.get("status")=="phrase_attempt" for e in events),
                      returned_count=sum(e.get("status")=="returned" for e in events))
        return result

    def unreturned(self):
        """发送结果已落账、返回列表前崩溃时，仍需完成返回步骤。"""
        for row in self.db.execute("SELECT id FROM page_attempts WHERE runId=? AND phase IN ('confirmed','failed') ORDER BY rowid DESC",(self.run_id,)):
            if not self.db.execute("SELECT 1 FROM fixed_events WHERE batch_id=? AND event_key=?",(self.run_id,"return:"+row["id"])).fetchone():
                return self.attempt(row["id"])
        return None
