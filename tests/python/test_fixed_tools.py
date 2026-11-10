import hashlib
from datetime import datetime, timedelta, timezone
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path
from jobpilot.errors import WorkflowError
from jobpilot.bridge import BossBridge
from jobpilot.fixed_search.store import BatchStore
from jobpilot.fixed_search.tools import FixedTools, phrase_checked

TEXT = "您好，想了解这个岗位。"
HASH = hashlib.sha256(TEXT.encode()).hexdigest()
BINDING = {"sessionId": "s", "tabId": 1, "frameId": 0, "documentId": "d"}
JOB = {"key": "j1", "title": "Java全栈开发工程师", "company": "甲", "recruiter": "李", "experience": "exp_1_3"}


class FakeBridge:
    def __init__(self):
        self.binding = BINDING.copy()
        self.calls = []
        self.results = {}
        self.lost = False

    def inspect(self):
        return {"adapterVersion": "boss-dom-0.7.1", "pageKind": "chat", "blockers": []}

    def start(self, *args, **kwargs):
        self.calls.append(("start", kwargs))

    def close(self):
        pass

    def action(self, tool, payload, **kwargs):
        self.calls.append((tool, payload))
        if tool in {"read_saved_phrase", "read_first_phrase"}:
            value = {"text": TEXT, "hash": HASH}
        elif tool in {"open_chat", "inspect_chat"}:
            value = {**JOB, "conversationKey": JOB["key"]}
        elif tool in {"choose_first_phrase", "submit_filled_phrase"}:
            value = {"status": "submitted"}
        elif tool == "inspect_send_result":
            value = {"status": "confirmed"}
        else:
            raise AssertionError(tool)
        if kwargs.get("request_id"):
            self.results[kwargs["request_id"]] = value
        if self.lost and tool == "choose_first_phrase":
            raise WorkflowError("ACTION_UNKNOWN")
        return value

    def recover(self, request_id):
        if request_id not in self.results:
            raise WorkflowError("ACTION_UNKNOWN")
        return self.results[request_id]


class FixedToolsTests(unittest.TestCase):
    def test_current_city_accepts_real_city_and_reports_it(self):
        with tempfile.TemporaryDirectory() as td, BatchStore(Path(td) / "b.db", mode="preview") as s:
            bridge = FakeBridge()
            t = FixedTools(bridge, s)
            t.preflight()
            self.assertEqual(bridge.calls[-1][1]["city"], "current")
            self.assertEqual(t.query("exp_1_3")["city"], "current")
            def search(tool, payload, **kw):
                return {"observedKeyword": JOB["title"], "observedCity": "广州", "observedExperience": "exp_1_3",
                        "filterEvidence": {"keyword": JOB["title"], "city": "广州", "experience": "1-3年", "results": "one"},
                        "jobs": [JOB], "exhausted": False}
            bridge.action = search
            view = t.search("exp_1_3")
            self.assertEqual(view["jobs"][0]["observed_city"], "广州")
            self.assertEqual(s.summary()["observed_cities"], ["广州"])
            bridge.action = lambda *a, **k: {**view, "observedCity": ""}
            with self.assertRaisesRegex(WorkflowError, "FILTER_UNVERIFIED"):
                t.search("exp_1_3")

    def test_old_batch_preserves_city_constraint_on_resume(self):
        import json
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "b.db"
            with BatchStore(path, mode="preview") as s:
                batch_id = s.run_id
                config = {**s.batch()["config"], "city": "深圳"}
                s.db.execute("UPDATE fixed_batches SET config=? WHERE id=?", (json.dumps(config), batch_id))
            with BatchStore(path, batch_id=batch_id) as s:
                bridge = FakeBridge()
                t = FixedTools(bridge, s)
                t.preflight()
                self.assertEqual(bridge.calls[-1][1]["city"], "深圳")
                self.assertEqual(t.query("exp_1_3")["city"], "深圳")

    def test_today_profile_quota_blocks_without_contact(self):
        with tempfile.TemporaryDirectory() as td, BatchStore(Path(td) / "b.db") as s:
            bridge = FakeBridge()
            today = datetime.now(timezone(timedelta(hours=8))).date().isoformat()
            tools = FixedTools(bridge, s, send_authorized=True, profile={"greeting_quota_exhausted_date": today})
            with self.assertRaisesRegex(WorkflowError, "QUOTA_REACHED"):
                tools.preflight()
            self.assertEqual(bridge.calls, [])

    def test_persisted_receipt_is_forwarded_to_read_only_verification(self):
        with tempfile.TemporaryDirectory() as td, BatchStore(Path(td) / "b.db") as s:
            bridge = FakeBridge()
            tools = FixedTools(bridge, s, send_authorized=True)
            tools.preflight()
            a = s.reserve(JOB)
            receipt = {"beforeCount": 0, "beforeHash": hashlib.sha256(b"[]").hexdigest()}
            s.effect(a + ":choose", "choose_first_phrase", {"conversationKey": "j1", "expectedHash": HASH})
            s.observed(a + ":choose", {"status": "submitted", "receipt": receipt})
            tools.inspect_result(JOB, a)
            self.assertEqual(bridge.calls[-1][1]["receipt"], receipt)

    def test_pending_can_be_observed_again_without_resending(self):
        with tempfile.TemporaryDirectory() as td, BatchStore(Path(td) / "b.db") as s:
            bridge = FakeBridge()
            t = FixedTools(bridge, s, send_authorized=True)
            t.preflight()
            a = s.reserve(JOB)
            original = bridge.action
            delivered = False
            reads = []
            def action(tool, payload, **kwargs):
                if tool == "inspect_send_result":
                    reads.append(tool)
                    return {"status": "confirmed" if delivered else "pending"}
                return original(tool, payload, **kwargs)
            bridge.action = action
            with patch("jobpilot.fixed_search.tools.time.sleep"), self.assertRaisesRegex(WorkflowError, "SEND_UNKNOWN"):
                t.inspect_result(JOB, a)
            delivered = True
            self.assertEqual(t.inspect_result(JOB, a)["status"], "confirmed")
            self.assertEqual(len(reads), 4)

    def test_platform_default_phrase_is_not_bound_as_user_phrase(self):
        text = "我可以把我的简历发给您看看吗？"
        with self.assertRaisesRegex(WorkflowError, "DEFAULT_PHRASE_NOT_READY"):
            phrase_checked({"text": text, "hash": hashlib.sha256(text.encode()).hexdigest()})

    def test_confirmed_inspection_survives_before_ledger_finish(self):
        with tempfile.TemporaryDirectory() as td, BatchStore(Path(td) / "b.db") as s:
            bridge = FakeBridge()
            t = FixedTools(bridge, s, send_authorized=True)
            t.preflight()
            a = s.reserve(JOB)
            original = s.finish
            def crash(*args):
                raise RuntimeError("crash before ledger finish")
            s.finish = crash
            with self.assertRaises(RuntimeError):
                t.inspect_result(JOB, a)
            s.finish = original
            t.inspect_result(JOB, a)
            self.assertEqual(sum(name == "inspect_send_result" for name, _ in bridge.calls), 1)
            self.assertEqual(s.summary()["confirmed_count"], 1)

    def test_replayed_send_never_dispatches_again(self):
        with tempfile.TemporaryDirectory() as td, BatchStore(Path(td) / "b.db") as s:
            bridge = FakeBridge()
            t = FixedTools(bridge, s, send_authorized=True)
            t.preflight()
            a = s.reserve(JOB)
            t.open_chat(JOB, a)
            t.verify_phrase(JOB)
            t.send_phrase(JOB, a)
            t.send_phrase(JOB, a)
            self.assertEqual(sum(name == "choose_first_phrase" for name, _ in bridge.calls), 1)

    def test_lost_result_queries_old_request(self):
        with tempfile.TemporaryDirectory() as td, BatchStore(Path(td) / "b.db") as s:
            bridge = FakeBridge()
            t = FixedTools(bridge, s, send_authorized=True)
            t.preflight()
            a = s.reserve(JOB)
            bridge.lost = True
            with self.assertRaisesRegex(WorkflowError, "ACTION_UNKNOWN"):
                t.send_phrase(JOB, a)
            t.send_phrase(JOB, a)
            self.assertEqual(sum(name == "choose_first_phrase" for name, _ in bridge.calls), 1)

    def test_unknown_result_cannot_replay(self):
        with tempfile.TemporaryDirectory() as td, BatchStore(Path(td) / "b.db") as s:
            bridge = FakeBridge()
            t = FixedTools(bridge, s, send_authorized=True)
            t.preflight()
            a = s.reserve(JOB)
            s.effect(a + ":choose", "choose_first_phrase", {"conversationKey": "j1", "expectedHash": HASH})
            with self.assertRaisesRegex(WorkflowError, "ACTION_UNKNOWN"):
                t.send_phrase(JOB, a)
            self.assertFalse(any(name == "choose_first_phrase" for name, _ in bridge.calls))

    def test_preview_cannot_open_chat_and_changed_phrase_stops(self):
        with tempfile.TemporaryDirectory() as td, BatchStore(Path(td) / "b.db", mode="preview") as s:
            t = FixedTools(FakeBridge(), s)
            t.preflight()
            with self.assertRaisesRegex(WorkflowError, "SEND_NOT_AUTHORIZED"):
                t.open_chat(JOB, "x")
        with tempfile.TemporaryDirectory() as td, BatchStore(Path(td) / "b.db") as s:
            bridge = FakeBridge()
            t = FixedTools(bridge, s, send_authorized=True)
            t.preflight()
            bridge.action = lambda *a, **k: {"text": "变化", "hash": HASH}
            with self.assertRaisesRegex(WorkflowError, "FIRST_PHRASE_CHANGED"):
                t.verify_phrase(JOB)

    def test_bridge_accepts_batch_scope_and_recovers_without_dispatch(self):
        calls = []
        def transport(tool, args):
            calls.append((tool, args))
            rid = args.get("requestId") or args["command"]["context"]["requestId"]
            return {"requestId": rid, "phase": "observed", "value": {"binding": BINDING, "status": "confirmed"}}
        bridge = BossBridge(BINDING, transport)
        bridge.start([JOB["title"]], "run", HASH, batch_id="batch", max_contacts=150, experience_mode="auto", city="current")
        scope = calls[0][1]["command"]["payload"]
        self.assertEqual(scope["maxContacts"], 150)
        self.assertEqual(scope["experienceMode"], "auto")
        self.assertEqual(scope["batchId"], "batch")
        self.assertEqual(scope["city"], "current")
        bridge.recover("original")
        self.assertEqual(calls[-1], ("get_action_result", {"requestId": "original"}))

    def test_rejected_scope_keeps_diagnostic_and_does_not_retry(self):
        calls = []
        def transport(tool, args):
            calls.append(tool)
            return {"requestId": args["command"]["context"]["requestId"],
                    "phase": "rejected", "error": {"code": "INVALID_SCOPE"}}
        bridge = BossBridge(BINDING, transport)
        with self.assertRaisesRegex(WorkflowError, "^INVALID_SCOPE$"):
            bridge.start(["Java全栈开发工程师"], "preview", experience_mode="auto")
        self.assertEqual(calls, ["execute_action"])

    def test_city_mismatch_keeps_diagnostic(self):
        bridge = BossBridge(BINDING, lambda tool, args: {
            "requestId": args["command"]["context"]["requestId"],
            "phase": "uncertain", "error": {"code": "CITY_MISMATCH"}})
        with self.assertRaisesRegex(WorkflowError, "^CITY_MISMATCH$"):
            bridge.inspect()
