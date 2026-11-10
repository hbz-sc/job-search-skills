import unittest
from jobpilot.graph import build_graph


class Tools:
    def __init__(self):
        self.sent = 0

    def search(self, roles):
        return [{"key": "j1", "title": "Java全栈开发工程师", "company": "示例公司", "experience": "exp_1_3"}]

    def contact(self, job):
        self.sent += 1
        return {"status": "confirmed", "job_key": job["key"]}


class Ledger:
    def __init__(self, seen=False):
        self.seen = seen
        self.reports = []

    def should_skip(self, key):
        return self.seen

    def save_report(self, report):
        self.reports.append(report)


class GraphTests(unittest.TestCase):
    def run_graph(self, mode="demo", seen=False, planner=None):
        tools, ledger = Tools(), Ledger(seen)
        graph = build_graph(planner or (lambda resume: ["Java全栈开发工程师"]), tools, ledger)
        events = list(graph.stream({"resume": "示例Java简历", "mode": mode}, stream_mode="updates"))
        return events, tools, ledger

    def test_real_langgraph_executes_five_nodes(self):
        events, tools, ledger = self.run_graph()
        self.assertEqual([next(iter(e)) for e in events], ["analyze_resume", "search_jobs", "select_job", "contact_once", "record_result"])
        self.assertEqual(tools.sent, 1)
        self.assertEqual(ledger.reports[0]["result"]["status"], "confirmed")
        self.assertNotIn("resume", ledger.reports[0])

    def test_preview_and_seen_job_branch_without_contact(self):
        for mode, seen in [("preview", False), ("demo", True)]:
            events, tools, ledger = self.run_graph(mode, seen)
            self.assertNotIn("contact_once", [next(iter(e)) for e in events])
            self.assertEqual(tools.sent, 0)
            self.assertEqual(len(ledger.reports), 1)

    def test_model_failure_is_recorded_without_leaking_message(self):
        def bad(_):
            raise RuntimeError("secret-key-private-resume")
        _, tools, ledger = self.run_graph(planner=bad)
        self.assertEqual(tools.sent, 0)
        self.assertEqual(ledger.reports[0]["error"], "ANALYZE_FAILED")
        self.assertNotIn("secret", str(ledger.reports))

    def test_no_roles_skips_browser(self):
        events, tools, ledger = self.run_graph(planner=lambda _: [])
        self.assertEqual([next(iter(e)) for e in events], ["analyze_resume", "record_result"])
        self.assertEqual(tools.sent, 0)

    def test_preview_exports_candidates_for_local_learning(self):
        _, tools, ledger = self.run_graph('preview')
        self.assertEqual(ledger.reports[0]['jobs'][0]['key'], 'j1')
        self.assertEqual(tools.sent, 0)

    def test_bad_mode_never_contacts(self):
        _, tools, ledger = self.run_graph(mode="unexpected")
        self.assertEqual(tools.sent, 0)
        self.assertEqual(ledger.reports[0]["error"], "INVALID_MODE")

    def test_history_read_failure_still_reaches_record_node(self):
        class BrokenLedger(Ledger):
            def should_skip(self, key):
                raise RuntimeError("private database path")
        ledger = BrokenLedger()
        graph = build_graph(lambda _: ["Java全栈开发工程师"], Tools(), ledger)
        result = graph.invoke({"resume": "Java", "mode": "preview"})
        self.assertEqual(result["report"]["error"], "SELECTION_FAILED")
        self.assertEqual(len(ledger.reports), 1)
