import hashlib
import tempfile
import unittest
from pathlib import Path
from jobpilot.ledger import Ledger
from jobpilot.tools import LiveTools
from jobpilot.errors import WorkflowError


class FakeBridge:
    def __init__(self, unknown=False, changed=False):
        self.calls, self.unknown, self.changed = [], unknown, changed

    def action(self, tool, payload):
        self.calls.append(tool)
        job = {"key": "j", "title": "Java", "company": "甲", "recruiter": "李"}
        if tool == "search_jobs":
            return {"observedKeyword": payload["keyword"], "observedCity": "深圳", "observedExperience": payload["experience"], "jobs": [job]}
        if tool == "open_job":
            return {**job, "alreadyContacted": False}
        if tool == "open_chat":
            return {**job, "conversationKey": "j"}
        if tool == "read_first_phrase":
            text = "错误话术" if self.changed else "已保存的第一条常用语"
            return {"text": text, "hash": hashlib.sha256(text.encode()).hexdigest()}
        if tool == "choose_first_phrase":
            if self.unknown:
                raise WorkflowError("ACTION_UNKNOWN")
            return {"status": "submitted"}
        if tool == "inspect_send_result":
            return {"status": "confirmed"}
        raise AssertionError(tool)


class ToolTests(unittest.TestCase):
    def test_search_quota_is_persisted_before_any_contact(self):
        for stage in ("inspect", "start", "search_jobs"):
            with tempfile.TemporaryDirectory() as td:
                ledger, bridge, tools, _ = self.setup_tools(td)
                bridge.inspect = lambda: {"adapterVersion": "boss-dom-0.6.0", "pageKind": "jobs", "blockers": ["quota"] if stage == "inspect" else []}
                def start(*args):
                    if stage == "start":
                        raise WorkflowError("QUOTA_REACHED")
                bridge.start = start
                def action(*args):
                    raise WorkflowError("QUOTA_REACHED")
                bridge.action = action
                with ledger:
                    with self.assertRaisesRegex(WorkflowError, "QUOTA_REACHED"):
                        tools.search(["Java开发工程师"])
                    self.assertEqual(ledger.db.execute("SELECT count(*) FROM page_attempts").fetchone()[0], 0)
                with Ledger(Path(td) / "boss.sqlite", "run") as restarted:
                    with self.assertRaisesRegex(WorkflowError, "ACCOUNT_STOPPED"):
                        restarted.check_blockers()

    def test_quota_before_contact_reservation_is_persisted(self):
        for blocked_tool in ("search_jobs", "open_job"):
            with tempfile.TemporaryDirectory() as td:
                ledger, bridge, tools, job = self.setup_tools(td)
                original = bridge.action
                def action(tool, payload):
                    if tool == blocked_tool:
                        raise WorkflowError("QUOTA_REACHED")
                    return original(tool, payload)
                bridge.action = action
                with ledger:
                    with self.assertRaisesRegex(WorkflowError, "QUOTA_REACHED"):
                        tools.contact(job)
                with Ledger(Path(td) / "boss.sqlite", "run") as restarted:
                    with self.assertRaisesRegex(WorkflowError, "ACCOUNT_STOPPED"):
                        restarted.check_blockers()

    def setup_tools(self, root, mode="run", unknown=False, changed=False):
        ledger = Ledger(Path(root) / "boss.sqlite", mode)
        bridge = FakeBridge(unknown, changed)
        text = "已保存的第一条常用语"
        template = {"expectedText": text, "normalizedHash": hashlib.sha256(text.encode()).hexdigest()}
        tools = LiveTools(bridge, ledger, mode, template, send_authorized=mode == "run")
        job = {"key": "j", "title": "Java", "company": "甲", "experience": "exp_1_3", "query": {"keyword": "Java开发工程师", "city": "深圳", "experience": "exp_1_3"}}
        return ledger, bridge, tools, job

    def test_one_confirmed_contact_and_preview_refusal(self):
        with tempfile.TemporaryDirectory() as td:
            ledger, bridge, tools, job = self.setup_tools(td)
            with ledger:
                self.assertEqual(tools.contact(job)["status"], "confirmed")
                self.assertEqual(bridge.calls.count("choose_first_phrase"), 1)
                self.assertTrue(ledger.should_skip("j"))
        with tempfile.TemporaryDirectory() as td:
            ledger, bridge, tools, job = self.setup_tools(td, "preview")
            with ledger, self.assertRaises(WorkflowError):
                tools.contact(job)
            self.assertEqual(bridge.calls, [])

    def test_unknown_send_is_not_retried_and_changed_phrase_never_sent(self):
        for unknown, changed in [(True, False), (False, True)]:
            with tempfile.TemporaryDirectory() as td:
                ledger, bridge, tools, job = self.setup_tools(td, unknown=unknown, changed=changed)
                with ledger:
                    with self.assertRaises(WorkflowError):
                        tools.contact(job)
                    self.assertTrue(ledger.should_skip("j"))
                    self.assertEqual(bridge.calls.count("choose_first_phrase"), 0 if changed else 1)
                    with self.assertRaises(WorkflowError):
                        ledger.check_blockers()
