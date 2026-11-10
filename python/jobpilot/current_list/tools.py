import re
from datetime import datetime, timezone, timedelta
from ..errors import WorkflowError
from ..fixed_search.tools import FixedTools, phrase_checked


class CurrentListTools(FixedTools):
    """沿用可靠发送机制，仅覆盖列表与首条模板的获取方式。"""
    def preflight(self):
        batch=self.store.batch();pending=self.store.pending()
        if len(pending)>1: raise WorkflowError("UNRESOLVED_CONTACT")
        if self.store.mode=="run":
            self._send_policy();self.store.check_blockers(pending[0]["id"] if pending else None)
            quota=self.profile.get("greeting_quota_exhausted_date")
            if quota:
                try: date=datetime.strptime(quota,"%Y-%m-%d").date()
                except (TypeError,ValueError): raise WorkflowError("QUOTA_DATE_UNVERIFIED") from None
                if date>=datetime.now(timezone(timedelta(hours=8))).date(): raise WorkflowError("QUOTA_REACHED")
        page=self.bridge.inspect()
        if "quota" in page.get("blockers",[]): self.store.stop_quota();raise WorkflowError("QUOTA_REACHED")
        if page.get("blockers"): raise WorkflowError("PAGE_BLOCKED")
        if page.get("adapterVersion")!="boss-dom-0.8.0": raise WorkflowError("EXTENSION_UPDATE_REQUIRED")
        unreturned=self.store.unreturned()
        if page.get("pageKind")!="jobs" and not ((pending or unreturned) and page.get("pageKind")=="chat"):
            raise WorkflowError("CURRENT_LIST_REQUIRED")
        old=batch["binding"]
        if old and any(old[k]!=self.bridge.binding[k] for k in ("sessionId","tabId","frameId")):
            raise WorkflowError("AUTHORIZED_TARGET_CHANGED")
        self.store.pin(binding=self.bridge.binding)
        counts=self.store.summary();remaining=counts["max_contacts"]-counts["used_contacts"]
        if pending and not self.store.db.execute("SELECT 1 FROM fixed_effects WHERE batch_id=? AND op_key=?",(self.store.run_id,pending[0]["id"]+":open")).fetchone(): remaining+=1
        self.bridge.start_current(self.store.mode,self.store.run_id,max(0,remaining))
        if page.get("pageKind")=="jobs": self.read_list()
        return pending[0] if pending else unreturned

    def _list(self,tool):
        view=self._call(tool,{})
        if not isinstance(view,dict) or not isinstance(view.get("jobs"),list) or len(view["jobs"])>200 or not isinstance(view.get("exhausted"),bool):
            raise WorkflowError("LIST_VIEW_INVALID")
        self.store.pin_snapshot(view.get("snapshot"))
        for j in view["jobs"]:
            if not isinstance(j,dict) or not isinstance(j.get("key"),str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,200}",j["key"]) or not all(isinstance(j.get(k),str) and j[k].strip() for k in ("title","company")):
                raise WorkflowError("JOB_IDENTITY_UNVERIFIED")
        return view

    def read_list(self): return self._list("inspect_current_list")
    def advance(self): return self._list("advance_list")
    def restore(self): return self._list("restore_list")

    def verify_phrase(self,job):
        current=phrase_checked(self._call("read_first_phrase",{"conversationKey":job["key"]}))
        observation=self.bridge.last_request_id
        previous=self.store.batch()["template"]
        if previous and previous!=current: raise WorkflowError("FIRST_PHRASE_CHANGED")
        self._call("bind_phrase",{"conversationKey":job["key"],"expectedHash":current["normalizedHash"],"observationRequestId":observation})
        self.store.pin(template=current)
        if self.store.log: self.store.log.emit("phrase","read_and_bound",phrase_length=len(current["expectedText"]),phrase_hash=current["normalizedHash"],job_key=job["key"])
        return current

    def recover_contact(self,job,attempt):
        row=self.store.db.execute("SELECT 1 FROM fixed_effects WHERE batch_id=? AND op_key=?",(self.store.run_id,attempt+":open")).fetchone()
        if row is None:
            view=self.read_list()
            if not any(j["key"]==job["key"] for j in view["jobs"]): raise WorkflowError("RECOVERY_JOB_NOT_VISIBLE")
            detail=self.inspect_job(job)
            if detail.get("status")=="skipped": raise WorkflowError("RECOVERY_JOB_UNAVAILABLE")
            return self.open_chat(detail,attempt)
        chat=self.open_chat(job,attempt)
        if chat.get("status")=="skipped": raise WorkflowError("RECOVERY_JOB_UNAVAILABLE")
        return self._chat_checked(job,self._call("inspect_chat",{"conversationKey":job["key"]}))
