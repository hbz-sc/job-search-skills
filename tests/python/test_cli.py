import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from jobpilot.cli import main


class CliTests(unittest.TestCase):
    def test_demo_saves_result_without_touching_real_history(self):
        with tempfile.TemporaryDirectory() as td, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(main(["demo"], root=td), 0)
            root = Path(td)
            self.assertFalse((root / "data").exists())
            self.assertFalse((root / "private").exists())
            reports = list((root / "output/jobpilot/python").glob("*.json"))
            self.assertEqual(len(reports), 1)
            report = json.loads(reports[0].read_text(encoding="utf-8"))
            self.assertTrue(report["result"]["simulated"])
            self.assertNotIn("resume", report)

    def test_real_send_requires_explicit_opt_in_and_preview_rejects_send_flags(self):
        for args in (["run", "--resume", "x.txt"], ["preview", "--resume", "x.txt", "--confirm-send"]):
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as error:
                main(args)
            self.assertEqual(error.exception.code, 2)
