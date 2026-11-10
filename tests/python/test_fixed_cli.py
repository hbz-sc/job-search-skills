import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from jobpilot.errors import WorkflowError
from jobpilot.cli import main
from jobpilot.fixed_search.store import BatchStore


class FixedCliTests(unittest.TestCase):
    def test_preview_needs_no_resume_or_model_and_records_connection_failure(self):
        with tempfile.TemporaryDirectory() as td:
            root, output = Path(td), io.StringIO()
            with patch("jobpilot.fixed_search.cli.BossBridge.connect", side_effect=WorkflowError("BOSS_NOT_CONNECTED")), contextlib.redirect_stdout(output):
                result = main(["fixed-search", "preview"], root)
            self.assertEqual(result, 1)
            self.assertIn("BOSS_NOT_CONNECTED", output.getvalue())
            reports = list((root / "output/jobpilot/fixed-search").glob("*.json"))
            self.assertEqual(len(reports), 1)
            report = json.loads(reports[0].read_text(encoding="utf-8"))
            self.assertEqual(report["used_contacts"], 0)
            self.assertEqual(report["status"], "paused")

    def test_run_requires_explicit_flag_and_limit_1_to_150(self):
        with tempfile.TemporaryDirectory() as td:
            for args in (["run"], ["run", "--confirm-send", "--max-contacts", "151"], ["run", "--confirm-send", "--max-contacts", "0"]):
                with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as raised:
                    main(["fixed-search", *args], Path(td))
                self.assertEqual(raised.exception.code, 2)
            self.assertFalse((Path(td) / "data/boss.sqlite").exists())

    def test_status_does_not_connect_or_create_run(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            with BatchStore(root / "data/boss.sqlite", max_contacts=7) as s:
                bid = s.run_id
            with patch("jobpilot.fixed_search.cli.BossBridge.connect") as connect, contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(main(["fixed-search", "status", "--batch", bid], root), 0)
                connect.assert_not_called()
            with BatchStore(root / "data/boss.sqlite", batch_id=bid) as s:
                self.assertEqual(s.summary()["max_contacts"], 7)
                self.assertEqual(s.db.execute("SELECT count(*) FROM page_runs").fetchone()[0], 1)

    def test_completed_resume_does_not_connect(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            with BatchStore(root / "data/boss.sqlite") as s:
                bid = s.run_id
                s.set_status("completed", "CONTACT_LIMIT")
            with patch("jobpilot.fixed_search.cli.BossBridge.connect") as connect, contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(main(["fixed-search", "resume", "--batch", bid, "--confirm-send"], root), 0)
                connect.assert_not_called()
