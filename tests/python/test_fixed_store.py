import tempfile
import unittest
from pathlib import Path
from jobpilot.errors import WorkflowError
from jobpilot.ledger import Ledger
from jobpilot.fixed_search.store import BatchStore


def job(n):
    return {"key": f"j{n}", "title": "Java全栈开发工程师", "company": "测试公司", "experience": "exp_1_3"}


class BatchStoreTests(unittest.TestCase):
    def test_old_lowercase_legacy_quota_preserved_and_unknown_ownership_blocks(self):
        with tempfile.TemporaryDirectory() as td, BatchStore(Path(td) / "b.db") as s:
            s.db.execute("CREATE TABLE account_stops(accountKey TEXT,reason TEXT,evidence TEXT,createdAt TEXT)")
            s.db.execute("INSERT INTO account_stops VALUES('a','quota','{}','2026-01-01T00:00:00Z')")
            s.check_blockers()
            s.db.execute("UPDATE account_stops SET reason='legacy_unverified'")
            with self.assertRaisesRegex(WorkflowError, "QUOTA_REACHED"):
                s.check_blockers()

    def test_150_limit_and_resume_budget(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "boss.sqlite"
            with BatchStore(path) as s:
                batch_id = s.run_id
                for n in range(150):
                    attempt = s.reserve(job(n))
                    s.finish(attempt, "confirmed", {"status": "confirmed"})
                self.assertEqual(s.summary()["used_contacts"], 150)
                with self.assertRaisesRegex(WorkflowError, "CONTACT_LIMIT"):
                    s.reserve(job(150))
            with BatchStore(path, batch_id=batch_id) as s:
                self.assertEqual(s.summary()["max_contacts"], 150)
                self.assertEqual(s.summary()["confirmed_count"], 150)
                with self.assertRaisesRegex(WorkflowError, "CONTACT_LIMIT"):
                    s.reserve(job(151))

    def test_crash_reservation_is_idempotent_and_blocks_other_jobs(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "boss.sqlite"
            with BatchStore(path) as s:
                bid, attempt = s.run_id, s.reserve(job(1))
            with BatchStore(path, batch_id=bid) as s:
                self.assertEqual(s.reserve(job(1)), attempt)
                self.assertEqual(s.summary()["used_contacts"], 1)
                with self.assertRaisesRegex(WorkflowError, "UNRESOLVED_CONTACT"):
                    s.reserve(job(2))

    def test_legacy_history_and_preview(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "boss.sqlite"
            with Ledger(path, "run") as old:
                a = old.reserve(job(1))
                old.finish(a, "confirmed", {})
            with BatchStore(path) as s:
                self.assertTrue(s.should_skip("j1"))
                self.assertIsNone(s.reserve(job(1)))
                self.assertEqual(s.summary()["used_contacts"], 0)
            with BatchStore(path, mode="preview") as s:
                with self.assertRaisesRegex(WorkflowError, "SEND_NOT_AUTHORIZED"):
                    s.reserve(job(2))

    def test_invalid_limits_do_not_create_file(self):
        with tempfile.TemporaryDirectory() as td:
            for limit in (0, 151, -1, True, 1.5):
                path = Path(td) / str(limit)
                with self.assertRaisesRegex(WorkflowError, "INVALID_CONTACT_LIMIT"):
                    BatchStore(path, max_contacts=limit)
                self.assertFalse(path.exists())

    def test_effect_intent_retains_request_id(self):
        with tempfile.TemporaryDirectory() as td, BatchStore(Path(td) / "b.db") as s:
            first, fresh = s.effect("a:send", "choose_first_phrase", {"conversationKey": "j1"})
            second, fresh2 = s.effect("a:send", "choose_first_phrase", {"conversationKey": "j1"})
            self.assertTrue(fresh)
            self.assertFalse(fresh2)
            self.assertEqual(first["request_id"], second["request_id"])
            with self.assertRaisesRegex(WorkflowError, "ACTION_CONFLICT"):
                s.effect("a:send", "choose_first_phrase", {"conversationKey": "j2"})

    def test_same_day_quota_blocks_but_past_evidence_is_preserved(self):
        with tempfile.TemporaryDirectory() as td, BatchStore(Path(td) / "b.db") as s:
            s.stop_quota()
            with self.assertRaisesRegex(WorkflowError, "QUOTA_REACHED"):
                s.check_blockers()
            s.db.execute("UPDATE page_stops SET createdAt='2026-01-01T00:00:00+00:00'")
            s.check_blockers()  # live preflight still required by tools
            self.assertEqual(s.db.execute("SELECT count(*) FROM page_stops").fetchone()[0], 1)

    def test_status_read_only_does_not_create_new_run(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "b.db"
            with BatchStore(path, max_contacts=3) as s:
                bid = s.run_id
            self.assertEqual(BatchStore.read_summary(path, bid)["max_contacts"], 3)
            with BatchStore(path, batch_id=bid) as s:
                self.assertEqual(s.db.execute("SELECT count(*) FROM page_runs").fetchone()[0], 1)
