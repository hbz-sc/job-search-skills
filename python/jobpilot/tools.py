"""工具细节放这里；学习状态图时先把它们当作普通函数调用。"""
import hashlib
import re
import time
from datetime import datetime, timedelta, timezone
from .errors import WorkflowError
from .model import ROLE_KEYWORDS

BANDS = ("exp_1_3", "exp_3_5")


def validate_view(view, query):
    if not isinstance(view, dict) or any(view.get(k) != query[q] for k, q in (("observedKeyword", "keyword"), ("observedCity", "city"), ("observedExperience", "experience"))) or not isinstance(view.get("jobs"), list) or len(view["jobs"]) > 200:
        raise WorkflowError("FILTER_UNVERIFIED")
    for job in view["jobs"]:
        if not isinstance(job, dict) or not isinstance(job.get("key"), str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,200}", job["key"]) or not all(isinstance(job.get(k), str) and job[k].strip() for k in ("title", "company")):
            raise WorkflowError("JOB_IDENTITY_UNVERIFIED")
    return view["jobs"]


class DemoTools:
    """纯本地模拟，绝不会连接BOSS。"""
    def __init__(self, ledger):
        self.ledger = ledger

    def search(self, roles):
        return [{"key": f"demo_{i}", "title": role, "company": "本地模拟公司", "experience": BANDS[i % 2]} for i, role in enumerate(roles)]

    def contact(self, job):
        attempt = self.ledger.reserve(job)
        result = {"status": "confirmed", "simulated": True, "job_key": job["key"]}
        self.ledger.finish(attempt, "confirmed", result)
        return result


class LiveTools:
    def __init__(self, bridge, ledger, mode, template=None, *, send_authorized=False, profile=None, retry_historical_quota=False):
        self.bridge, self.ledger, self.mode, self.template = bridge, ledger, mode, template
        self.send_authorized = send_authorized
        self.profile, self.retry_historical_quota = profile or {}, retry_historical_quota

    def _call(self, operation, *args):
        try:
            return operation(*args)
        except WorkflowError as exc:
            if str(exc) == "QUOTA_REACHED":
                self.ledger.stop_quota()
            raise

    def search(self, roles):
        if not roles or len(roles) > 3 or any(r not in ROLE_KEYWORDS.values() for r in roles) or len(set(roles)) != len(roles):
            raise WorkflowError("ROLE_SCOPE_INVALID")
        page = self._call(self.bridge.inspect)
        if "quota" in page.get("blockers", []):
            self.ledger.stop_quota()
            raise WorkflowError("QUOTA_REACHED")
        if page.get("adapterVersion") not in {"boss-dom-0.6.0", "boss-dom-0.7.0", "boss-dom-0.7.1", "boss-dom-0.8.0"}:
            raise WorkflowError("EXTENSION_UPDATE_REQUIRED")
        if page.get("blockers") or page.get("pageKind") not in {"jobs", "chat"}:
            raise WorkflowError("PAGE_BLOCKED")
        if self.mode == "run":
            self._send_policy()
        self._call(self.bridge.start, roles, self.mode, self.template["normalizedHash"] if self.template else None)
        jobs, seen = [], set()
        for keyword in roles:
            for band in BANDS:
                query = {"keyword": keyword, "city": "深圳", "experience": band}
                view = self._call(self.bridge.action, "search_jobs", query)
                for job in validate_view(view, query):
                    if job["key"] not in seen:
                        jobs.append({"key": job["key"], "title": job["title"], "company": job["company"], "experience": band, "query": query})
                        seen.add(job["key"])
        return jobs

    def _send_policy(self):
        if self.mode != "run" or not self.send_authorized or not self.template:
            raise WorkflowError("SEND_NOT_AUTHORIZED")
        text = self.template.get("expectedText", "")
        if not isinstance(text, str) or not text.strip() or hashlib.sha256(text.encode()).hexdigest() != self.template.get("normalizedHash"):
            raise WorkflowError("TEMPLATE_CHANGED")
        old_date = self.profile.get("greeting_quota_exhausted_date")
        if old_date:
            today = datetime.now(timezone(timedelta(hours=8))).date().isoformat()
            if not isinstance(old_date, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", old_date) or old_date >= today or not self.retry_historical_quota:
                raise WorkflowError("HISTORICAL_QUOTA_UNVERIFIED")
        self.ledger.check_blockers()

    def contact(self, job):
        self._send_policy()
        query = job.get("query", {})
        if query.get("experience") not in BANDS or query.get("city") != "深圳" or query.get("keyword") not in ROLE_KEYWORDS.values():
            raise WorkflowError("FILTER_UNVERIFIED")
        # 搜索过多个方向后，先恢复该岗位的查询并重新核对；不使用旧快照直接联系。
        current = validate_view(self._call(self.bridge.action, "search_jobs", query), query)
        if not any(all(j.get(k) == job.get(k) for k in ("key", "title", "company")) for j in current):
            raise WorkflowError("JOB_CHANGED")
        detail = self._call(self.bridge.action, "open_job", {"jobKey": job["key"]})
        if detail.get("status") == "unavailable" or detail.get("alreadyContacted"):
            return {"status": "skipped", "job_key": job["key"]}
        if not detail.get("recruiter") or any(detail.get(k) != job.get(k) for k in ("key", "title", "company")):
            raise WorkflowError("JOB_IDENTITY_UNVERIFIED")
        attempt = self.ledger.reserve(job)  # 唯一键+事务，开启聊天前先占位
        try:
            chat = self._call(self.bridge.action, "open_chat", {"jobKey": job["key"]})
            if chat.get("conversationKey") != job["key"] or any(chat.get(k) != detail.get(k) for k in ("title", "company", "recruiter")):
                raise WorkflowError("CHAT_IDENTITY_UNVERIFIED")
            self.ledger.finish(attempt, "chat_open", {"conversationKey": job["key"]})
            phrase = None
            for _ in range(3):
                phrase = self._call(self.bridge.action, "read_first_phrase", {"conversationKey": job["key"]})
                if phrase.get("text") == self.template["expectedText"] and phrase.get("hash") == self.template["normalizedHash"]:
                    break
                time.sleep(0.3)
            else:
                raise WorkflowError("FIRST_PHRASE_CHANGED")
            payload = {"conversationKey": job["key"], "expectedHash": self.template["normalizedHash"]}
            self.ledger.finish(attempt, "sending", {"expectedHash": payload["expectedHash"]})
            choice = self._call(self.bridge.action, "choose_first_phrase", payload)
            if choice.get("status") == "filled":
                choice = self._call(self.bridge.action, "submit_filled_phrase", payload)
            if choice.get("status") != "submitted":
                raise WorkflowError("SEND_UNKNOWN")
            result = self._call(self.bridge.action, "inspect_send_result", payload)
            status = result.get("status")
            if status not in {"confirmed", "failed"}:
                raise WorkflowError("SEND_UNKNOWN")
            result = {"status": status, "job_key": job["key"]}
            self.ledger.finish(attempt, status, result)
            return result
        except BaseException as exc:
            code = str(exc) if isinstance(exc, WorkflowError) else "ACTION_UNKNOWN"
            self.ledger.finish(attempt, "uncertain", {"status": "unknown", "code": code, "retry": False})
            raise
