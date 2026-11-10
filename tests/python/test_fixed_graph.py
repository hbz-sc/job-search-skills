import tempfile
import unittest
from pathlib import Path
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.checkpoint.sqlite import SqliteSaver
from jobpilot.errors import WorkflowError
from jobpilot.fixed_search.store import BatchStore
from jobpilot.fixed_search.graph import build_graph, initial_state


class GraphTools:
    def __init__(self, store, count=4, unknown=False):
        self.store, self.count, self.unknown = store, count, unknown
        self.opens, self.sends, self.advances = [], [], 0

    def preflight(self):
        pending = self.store.pending()
        self.store.check_blockers(pending[0]["id"] if pending else None)
        return pending[0] if pending else None

    def search(self, band):
        return {"jobs": [{"key": f"j{i}", "title": "Java全栈开发工程师", "company": "甲", "experience": band} for i in range(self.count)], "exhausted": True}

    restore = search

    def advance(self, band):
        self.advances += 1
        return self.search(band)

    def inspect_job(self, job):
        return {**job, "recruiter": "李"}

    def open_chat(self, job, attempt):
        self.opens.append(job["key"])
        return {"conversationKey": job["key"]}

    def recover_contact(self, job, attempt):
        raise WorkflowError("ACTION_UNKNOWN")

    def verify_phrase(self, job):
        pass

    def send_phrase(self, job, attempt):
        self.sends.append(job["key"])
        if self.unknown:
            raise WorkflowError("ACTION_UNKNOWN")

    def inspect_result(self, job, attempt):
        self.store.finish(attempt, "confirmed", {"status": "confirmed"})
        return {"status": "confirmed"}


class FixedGraphTests(unittest.TestCase):
    def invoke(self, graph, store, state=None):
        return graph.invoke(state or initial_state(store), {"configurable": {"thread_id": store.run_id}, "recursion_limit": 8000})

    def test_real_graph_stops_at_150_and_does_not_open_151(self):
        with tempfile.TemporaryDirectory() as td, BatchStore(Path(td) / "b.db") as s:
            tools = GraphTools(s, count=155)
            result = self.invoke(build_graph(tools, s, InMemorySaver()), s)
            self.assertEqual(result["report"]["used_contacts"], 150)
            self.assertEqual(result["report"]["confirmed_count"], 150)
            self.assertEqual(result["stop_reason"], "CONTACT_LIMIT")
            self.assertEqual(len(tools.opens), 150)
            self.assertEqual(len(set(tools.sends)), 150)

    def test_two_bands_dedupe_and_preview_never_contacts(self):
        with tempfile.TemporaryDirectory() as td:
            for mode in ("run", "preview"):
                with BatchStore(Path(td) / (mode + ".db"), mode=mode) as s:
                    tools = GraphTools(s)
                    result = self.invoke(build_graph(tools, s, InMemorySaver()), s)
                    self.assertEqual(len(tools.sends), 4 if mode == "run" else 0)
                    self.assertEqual(result["status"], "completed")

    def test_unknown_send_pauses_and_resume_does_not_send_again(self):
        with tempfile.TemporaryDirectory() as td, BatchStore(Path(td) / "b.db") as s:
            tools = GraphTools(s, unknown=True)
            saver = InMemorySaver()
            graph = build_graph(tools, s, saver)
            first = self.invoke(graph, s)
            self.assertEqual(first["status"], "paused")
            self.assertEqual(first["report"]["used_contacts"], 1)
            second = self.invoke(graph, s, initial_state(s, first))
            self.assertEqual(second["status"], "paused")
            self.assertEqual(len(tools.opens), 1)
            self.assertEqual(len(tools.sends), 1)

    def test_sqlite_restart_preserves_batch_and_does_not_repeat_first_job(self):
        with tempfile.TemporaryDirectory() as td:
            db, checkpoint = Path(td) / "b.db", str(Path(td) / "checkpoints.db")
            with BatchStore(db, max_contacts=3) as s, SqliteSaver.from_conn_string(checkpoint) as cp:
                bid = s.run_id
                first = self.invoke(build_graph(GraphTools(s), s, cp, stop_after=1), s)
                self.assertEqual(first["stop_reason"], "VALIDATION_PAUSE")
            with BatchStore(db, batch_id=bid) as s, SqliteSaver.from_conn_string(checkpoint) as cp:
                tools = GraphTools(s)
                graph = build_graph(tools, s, cp)
                saved = graph.get_state({"configurable": {"thread_id": bid}}).values
                result = self.invoke(graph, s, initial_state(s, saved))
                self.assertEqual(result["report"]["used_contacts"], 3)
                self.assertNotIn("j0", tools.opens)

    def test_empty_pages_without_exhausted_stop_after_three_advances_each_band(self):
        with tempfile.TemporaryDirectory() as td, BatchStore(Path(td) / "b.db") as s:
            tools = GraphTools(s, count=0)
            tools.search = lambda band: {"jobs": [], "exhausted": False}
            graph = build_graph(tools, s, InMemorySaver())
            result = self.invoke(graph, s)
            self.assertEqual(tools.advances, 6)
            self.assertEqual(result["report"]["used_contacts"], 0)
            ends = [e for e in result["report"]["events"] if e["status"] == "query_end"]
            self.assertEqual(len(ends), 2)
            self.assertTrue(all(e["reason"] == "NO_NEW_RESULTS" for e in ends))
