import json
import tempfile
import unittest
from pathlib import Path
from jobpilot.errors import WorkflowError
from jobpilot.model import validate_roles
from jobpilot.ledger import Ledger, run_lock
from jobpilot.bridge import BossBridge


class ServiceTests(unittest.TestCase):
    def test_model_can_only_return_supported_roles_with_resume_evidence(self):
        resume = "负责Java和React全栈业务开发，使用RAG实现知识库问答。"
        self.assertEqual(validate_roles({"roles": [{"role_id": "java_fullstack", "evidence": "负责Java和React全栈业务开发"}]}, resume), ["Java全栈开发工程师"])
        for role in [{"role_id": "arbitrary-url", "evidence": resume}, {"role_id": "ai_application", "evidence": "编造的经历不在简历里"}]:
            with self.assertRaises(WorkflowError):
                validate_roles({"roles": [role]}, resume)

    def test_reservation_is_atomic_and_unknown_remains_skipped_after_restart(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "boss.sqlite"
            job = {"key": "j1", "title": "Java", "company": "甲"}
            with Ledger(path, "run") as ledger:
                attempt = ledger.reserve(job)
                ledger.finish(attempt, "uncertain", {"status": "unknown"})
                self.assertTrue(ledger.should_skip("j1"))
            with Ledger(path, "run") as ledger:
                self.assertTrue(ledger.should_skip("j1"))
                with self.assertRaises(WorkflowError):
                    ledger.reserve({**job, "key": "j2"})

    def test_preview_and_budget_cannot_reserve_contacts(self):
        with tempfile.TemporaryDirectory() as td:
            with Ledger(Path(td) / "preview.db", "preview") as ledger:
                with self.assertRaises(WorkflowError):
                    ledger.reserve({"key": "j"})
            with Ledger(Path(td) / "run.db", "run") as ledger:
                first = ledger.reserve({"key": "j1"})
                ledger.finish(first, "confirmed", {"status": "confirmed"})
                with self.assertRaises(WorkflowError):
                    ledger.reserve({"key": "j2"})

    def test_run_lock_excludes_another_process_connection(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "boss-run-lock.sqlite"
            with run_lock(path):
                with self.assertRaises(WorkflowError):
                    with run_lock(path):
                        pass

    def test_native_result_must_match_original_request(self):
        binding = {"sessionId": "s", "tabId": 1, "frameId": 0, "documentId": "d"}
        calls = []
        def transport(tool, args):
            calls.append(tool)
            return {"requestId": "wrong", "phase": "observed", "value": {"binding": binding}}
        bridge = BossBridge(binding, transport)
        with self.assertRaises(WorkflowError):
            bridge.inspect()
        self.assertEqual(calls, ["inspect_session"])

    def test_transport_timeout_queries_original_result_without_redispatch(self):
        binding = {"sessionId": "s", "tabId": 1, "frameId": 0, "documentId": "d"}
        calls = []
        def transport(tool, args):
            calls.append((tool, args))
            if tool == "inspect_session":
                raise TimeoutError("private-token")
            return {"requestId": args["requestId"], "phase": "uncertain", "error": {"code": "CONTENT_RESPONSE_TIMEOUT"}}
        bridge = BossBridge(binding, transport)
        with self.assertRaisesRegex(WorkflowError, "ACTION_UNKNOWN"):
            bridge.inspect()
        self.assertEqual([c[0] for c in calls], ["inspect_session", "get_action_result"])
        self.assertEqual(calls[0][1]["command"]["context"]["requestId"], calls[1][1]["requestId"])
