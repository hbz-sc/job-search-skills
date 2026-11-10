"""网页工具边界。图只关心业务；这里核对页面证据、身份和单次动作。"""
import hashlib
import json
import time
from datetime import datetime, timedelta, timezone
from ..errors import WorkflowError
from ..tools import validate_view
from .state import KEYWORD, BANDS


def phrase_checked(value):
    text = value.get("text") if isinstance(value, dict) else None
    if not isinstance(text, str) or not text.strip() or hashlib.sha256(text.encode()).hexdigest() != value.get("hash"):
        raise WorkflowError("FIRST_PHRASE_CHANGED")
    if "".join(text.split()) == "我可以把我的简历发给您看看吗？":
        raise WorkflowError("DEFAULT_PHRASE_NOT_READY")
    return {"expectedText": text, "normalizedHash": value["hash"]}


class FixedTools:
    def __init__(self, bridge, store, *, send_authorized=False, profile=None):
        self.bridge, self.store = bridge, store
        self.send_authorized, self.profile = send_authorized, profile or {}
        self.city = store.batch()["config"]["city"]

    def _send_policy(self):
        if self.store.mode != "run" or not self.send_authorized:
            raise WorkflowError("SEND_NOT_AUTHORIZED")

    def _call(self, tool, payload, **kwargs):
        try:
            value = self.bridge.action(tool, payload, **kwargs)
            self.store.pin(binding=self.bridge.binding)
            return value
        except WorkflowError as exc:
            if "QUOTA" in str(exc):
                self.store.stop_quota()
            raise

    def preflight(self):
        batch = self.store.batch()
        pending = self.store.pending()
        if len(pending) > 1:
            raise WorkflowError("UNRESOLVED_CONTACT")
        if self.store.mode == "run":
            self._send_policy()
            self.store.check_blockers(pending[0]["id"] if pending else None)
            quota_date = self.profile.get("greeting_quota_exhausted_date")
            if quota_date:
                try:
                    recorded_date = datetime.strptime(quota_date, "%Y-%m-%d").date()
                except (ValueError, TypeError):
                    raise WorkflowError("QUOTA_DATE_UNVERIFIED") from None
                if recorded_date >= datetime.now(timezone(timedelta(hours=8))).date():
                    raise WorkflowError("QUOTA_REACHED")
        page = self.bridge.inspect()
        if "quota" in page.get("blockers", []):
            self.store.stop_quota()
            raise WorkflowError("QUOTA_REACHED")
        if page.get("blockers") or page.get("pageKind") not in {"jobs", "chat"}:
            raise WorkflowError("PAGE_BLOCKED")
        if page.get("adapterVersion") not in {"boss-dom-0.7.1", "boss-dom-0.8.0"}:
            raise WorkflowError("EXTENSION_UPDATE_REQUIRED")
        old = batch["binding"]
        if old and any(old[k] != self.bridge.binding[k] for k in ("sessionId", "tabId", "frameId")):
            raise WorkflowError("AUTHORIZED_TARGET_CHANGED")
        self.store.pin(binding=self.bridge.binding)
        template = batch["template"]
        if self.store.mode == "run" and template is None:
            if page["pageKind"] != "chat":
                raise WorkflowError("TEMPLATE_READ_REQUIRES_EXISTING_CHAT")
            # 在已有聊天只读取得第一条常用语，不为读取模板联系新人。
            self.bridge.start([KEYWORD], "preview", batch_id=self.store.run_id, experience_mode="auto", city=self.city)
            template = phrase_checked(self._call("read_saved_phrase", {}))
            self.store.pin(template=template)
        summary = self.store.summary()
        remaining = summary["max_contacts"] - summary["used_contacts"]
        # 已占额但尚未形成 open_chat 意图的恢复项，还允许执行原来的那一次。
        if pending and not self.store.db.execute("SELECT 1 FROM fixed_effects WHERE batch_id=? AND op_key=?", (self.store.run_id, pending[0]["id"] + ":open")).fetchone():
            remaining += 1
        self.bridge.start([KEYWORD], self.store.mode, template["normalizedHash"] if template else None,
                          batch_id=self.store.run_id, max_contacts=max(0, remaining), experience_mode="auto", city=self.city)
        return pending[0] if pending else None

    def query(self, band):
        if band not in BANDS:
            raise WorkflowError("FILTER_UNVERIFIED")
        return {"keyword": KEYWORD, "city": self.city, "experience": band}

    def _view(self, tool, band, **extra):
        query = self.query(band)
        value = self._call(tool, {**query, **extra})
        observed_city = value.get("observedCity") if isinstance(value, dict) else None
        if not isinstance(observed_city, str) or not observed_city.strip() or observed_city == "current":
            raise WorkflowError("FILTER_UNVERIFIED")
        jobs = validate_view(value, {**query, "city": observed_city} if self.city == "current" else query)
        evidence = value.get("filterEvidence", {})
        if not isinstance(value.get("exhausted"), bool) or not all(isinstance(evidence.get(k), str) and evidence[k].strip() for k in ("keyword", "city", "experience", "results")):
            raise WorkflowError("FILTER_UNVERIFIED")
        self.store.event("city:" + observed_city, {"status": "city_observed", "city": observed_city})
        return {**value, "jobs": [{**j, "experience": band, "query": query, "observed_city": observed_city} for j in jobs]}

    def search(self, band):
        return self._view("search_jobs", band)

    def advance(self, band):
        return self._view("list_jobs", band, advance=True)

    def restore(self, band):
        return self._view("restore_search", band)

    def inspect_job(self, job):
        detail = self._call("open_job", {"jobKey": job["key"]})
        if detail.get("status") == "unavailable" or detail.get("alreadyContacted"):
            return {"status": "skipped", "reason": detail.get("reason", "ALREADY_CONTACTED")}
        if not detail.get("recruiter") or any(detail.get(k) != job[k] for k in ("key", "title", "company")):
            raise WorkflowError("JOB_IDENTITY_UNVERIFIED")
        if detail.get("experience") not in BANDS or detail["experience"] != job["experience"]:
            return {"status": "skipped", "reason": "JOB_EXPERIENCE_UNVERIFIED"}
        return {**job, **detail}

    def _effect(self, key, tool, payload):
        self._send_policy()
        record, fresh = self.store.effect(key, tool, payload)
        if record["value"] is not None:
            return record["value"]
        # 已有意图只查原请求；哪怕崩溃发生在真正点击前，也不猜测没发。
        value = self._call(tool, payload, request_id=record["request_id"]) if fresh else self.bridge.recover(record["request_id"])
        self.store.observed(key, value)
        return value

    @staticmethod
    def _chat_checked(job, chat):
        if chat.get("conversationKey") != job["key"] or not chat.get("recruiter") or any(chat.get(k) != job.get(k) for k in ("title", "company", "recruiter")):
            raise WorkflowError("CHAT_IDENTITY_UNVERIFIED")
        return chat

    def open_chat(self, job, attempt):
        chat = self._effect(attempt + ":open", "open_chat", {"jobKey": job["key"]})
        if chat.get("status") == "unavailable":
            self.store.finish(attempt, "skipped", chat)
            return {"status": "skipped"}
        self._chat_checked(job, chat)
        self.store.finish(attempt, "chat_open", {"conversationKey": job["key"]})
        return chat

    def recover_contact(self, job, attempt):
        row = self.store.db.execute("SELECT 1 FROM fixed_effects WHERE batch_id=? AND op_key=?", (self.store.run_id, attempt + ":open")).fetchone()
        if row is None:
            view = self.search(job["experience"])
            if not any(j["key"] == job["key"] for j in view["jobs"]):
                raise WorkflowError("RECOVERY_JOB_NOT_VISIBLE")
            detail = self.inspect_job(job)
            if detail.get("status") == "skipped":
                self.store.finish(attempt, "skipped", detail)
                return detail
            return self.open_chat(detail, attempt)
        self.open_chat(job, attempt)  # 原请求结果核验，无重新开启聊天。
        chat = self._call("inspect_chat", {"conversationKey": job["key"]})
        return self._chat_checked(job, chat)

    def verify_phrase(self, job):
        template = self.store.batch()["template"]
        current = phrase_checked(self._call("read_first_phrase", {"conversationKey": job["key"]}))
        if current != template:
            raise WorkflowError("FIRST_PHRASE_CHANGED")
        return current

    def send_phrase(self, job, attempt):
        self._send_policy()
        template = self.store.batch()["template"]
        if not template:
            raise WorkflowError("SAVED_TEMPLATE_REQUIRED")
        payload = {"conversationKey": job["key"], "expectedHash": template["normalizedHash"]}
        self.store.finish(attempt, "sending", {"expectedHash": payload["expectedHash"]})
        choice = self._effect(attempt + ":choose", "choose_first_phrase", payload)
        if choice.get("status") == "filled":
            choice = self._effect(attempt + ":submit", "submit_filled_phrase", {**payload, **({"receipt": choice["receipt"]} if "receipt" in choice else {})})
        if choice.get("status") != "submitted":
            raise WorkflowError("SEND_UNKNOWN")
        return choice

    def inspect_result(self, job, attempt):
        payload = {"conversationKey": job["key"], "expectedHash": self.store.batch()["template"]["normalizedHash"]}
        # 基线摘要由扩展在选择常用语时产生；恢复后校验当前消息前缀，不能猜测送达。
        for suffix in (":submit", ":choose"):
            row = self.store.db.execute("SELECT value FROM fixed_effects WHERE batch_id=? AND op_key=?", (self.store.run_id, attempt + suffix)).fetchone()
            if row and row[0]:
                value = json.loads(row[0])
                if value.get("receipt"):
                    payload["receipt"] = value["receipt"]
                    break
        old = self.store.db.execute("SELECT op_key,payload FROM fixed_effects WHERE batch_id=? AND tool='inspect_send_result' AND op_key LIKE ? ORDER BY rowid", (self.store.run_id, attempt + ":result:%")).fetchall()
        for row in old:
            result = self._effect(row["op_key"], "inspect_send_result", json.loads(row["payload"]))
            if result.get("status") in {"confirmed", "failed"}:
                self.store.finish(attempt, result["status"], result)
                return result
        for poll in range(3):
            # 每次只读观察也保留原请求，防止“已核实，但写业务账本前崩溃”丢失证据。
            result = self._effect(attempt + f":result:{len(old) + poll}", "inspect_send_result", payload)
            if result.get("status") in {"confirmed", "failed"}:
                self.store.finish(attempt, result["status"], result)
                return result
            if result.get("status") != "pending":
                break
            if poll < 2:
                time.sleep(0.5)
        raise WorkflowError("SEND_UNKNOWN")
