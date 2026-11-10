import json
import tempfile
import unittest
from pathlib import Path
from jobpilot.current_list.store import CurrentListStore
from jobpilot.current_list.graph import build_graph, initial_state
from jobpilot.current_list.logging import DiagnosticLog
from jobpilot.errors import WorkflowError
from jobpilot.current_list.tools import CurrentListTools
from jobpilot.current_list.bridge import CurrentListBridge
import hashlib


JOB = {"key": "j1", "title": "Java", "company": "公司", "experience": "exp_1_3", "recruiter": "李"}
SNAPSHOT = {"fingerprint": "a" * 64, "keyword": "Java", "city": "广州", "url": "https://www.zhipin.com/web/geek/jobs?city=101280100", "filters": {}}


class FakeTools:
    def __init__(self, store): self.store, self.calls = store, []
    def preflight(self): self.calls.append("preflight"); return None
    def read_list(self):
        self.calls.append("read_list")
        return {"snapshot": SNAPSHOT, "jobs": [JOB], "exhausted": True}
    def inspect_job(self, job): self.calls.append("inspect_job"); return job
    def open_chat(self, job, attempt): self.calls.append("open_chat"); return {"conversationKey": job["key"]}
    def verify_phrase(self, job): self.calls.append("read_and_bind_phrase"); return {}
    def send_phrase(self, job, attempt): self.calls.append("send_phrase")
    def inspect_result(self, job, attempt):
        self.calls.append("confirm"); self.store.finish(attempt, "confirmed", {})
    def restore(self): self.calls.append("restore"); return self.read_list()


class CurrentListTests(unittest.TestCase):
    def test_success_log_does_not_invent_error_for_none(self):
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/"run.jsonl"
            DiagnosticLog(p,"batch",echo=False).emit("tool","complete",phase="observed",error=None)
            event=json.loads(p.read_text(encoding="utf-8"))
            self.assertNotIn("error",event)

    def test_resume_does_not_drop_selected_unreserved_job(self):
        with tempfile.TemporaryDirectory() as td, CurrentListStore(Path(td)/"b.db") as s:
            saved={"current_job":JOB,"attempt_id":None,"seen_job_keys":["j1"]}
            restored=initial_state(s,saved)
            result=build_graph(FakeTools(s),s,stop_after=1).invoke(restored)
            self.assertEqual(result['stop_reason'],'VALIDATION_PAUSE')
            self.assertEqual(s.summary()['confirmed_count'],1)

    def test_real_python_tools_drive_single_full_cycle(self):
        text="您好，想了解岗位";digest=hashlib.sha256(text.encode()).hexdigest()
        class Bridge:
            binding={"sessionId":"s","tabId":1,"frameId":0,"documentId":"d"}
            def __init__(self): self.calls=[];self.last_request_id=""
            def inspect(self): return {"pageKind":"jobs","adapterVersion":"boss-dom-0.8.0","blockers":[]}
            def start_current(self,mode,batch,remaining): self.calls.append("start_run");self.remaining=remaining
            def action(self,tool,payload,**kw):
                self.calls.append(tool);self.last_request_id=kw.get("request_id",str(len(self.calls)))
                if tool in {"inspect_current_list","restore_list"}: return {"snapshot":SNAPSHOT,"jobs":[JOB],"exhausted":True}
                if tool=="open_job": return {**JOB,"alreadyContacted":False}
                if tool=="open_chat": return {**JOB,"conversationKey":"j1"}
                if tool=="read_first_phrase": return {"text":text,"hash":digest}
                if tool=="bind_phrase": return {"hash":digest}
                if tool=="choose_first_phrase": return {"status":"submitted"}
                if tool=="inspect_send_result": return {"status":"confirmed"}
                raise AssertionError(tool)
        with tempfile.TemporaryDirectory() as td, CurrentListStore(Path(td)/"b.db") as s:
            b=Bridge();t=CurrentListTools(b,s,send_authorized=True)
            result=build_graph(t,s,stop_after=1).invoke(initial_state(s))
            self.assertEqual(result['stop_reason'],'VALIDATION_PAUSE')
            self.assertEqual(s.summary()['confirmed_count'],1)
            self.assertEqual(s.summary()['returned_count'],1)
            self.assertEqual(b.calls.count('start_run'),1)
            self.assertEqual(b.remaining,150)
            self.assertNotIn('search_jobs',b.calls)
            self.assertNotIn('submit_filled_phrase',b.calls)

    def test_first_phrase_binds_observed_request_without_restarting(self):
        text="您好，想了解岗位";digest=hashlib.sha256(text.encode()).hexdigest()
        class Bridge:
            binding={"sessionId":"s","tabId":1,"frameId":0,"documentId":"d"}
            calls=[]
            def action(self,tool,payload):
                self.calls.append((tool,payload));self.last_request_id="observed-first"
                return {"text":text,"hash":digest}
        with tempfile.TemporaryDirectory() as td, CurrentListStore(Path(td)/"b.db") as s:
            b=Bridge();t=CurrentListTools(b,s,send_authorized=True)
            t.verify_phrase(JOB)
            self.assertEqual(b.calls[1],("bind_phrase",{"conversationKey":"j1","expectedHash":digest,"observationRequestId":"observed-first"}))
            self.assertEqual(s.batch()["template"]["normalizedHash"],digest)
            self.assertEqual(s.summary()["used_contacts"],0)

    def test_unknown_action_is_queried_not_dispatched_again(self):
        class Bridge:
            binding={"sessionId":"s","tabId":1,"frameId":0,"documentId":"d"}
            calls=[]
            def action(self,tool,payload,**kw):
                self.calls.append("dispatch");raise WorkflowError("ACTION_UNKNOWN")
            def recover(self,rid): self.calls.append("recover");raise WorkflowError("ACTION_UNKNOWN")
        with tempfile.TemporaryDirectory() as td, CurrentListStore(Path(td)/"b.db") as s:
            b=Bridge();t=CurrentListTools(b,s,send_authorized=True)
            for _ in range(2):
                with self.assertRaisesRegex(WorkflowError,"ACTION_UNKNOWN"): t._effect("a:choose","choose_first_phrase",{"conversationKey":"j1","expectedHash":"a"*64})
            self.assertEqual(b.calls,["dispatch","recover"])

    def test_v4_bridge_uses_lease_and_preserves_specific_errors(self):
        calls=[];binding={"sessionId":"s","tabId":1,"frameId":0,"documentId":"d"}
        def transport(tool,args):
            c=args['command'];calls.append(c)
            return {"requestId":c['context']['requestId'],"phase":"rejected","error":{"code":"LIST_CONDITIONS_CHANGED"}}
        bridge=CurrentListBridge(binding,transport)
        with self.assertRaisesRegex(WorkflowError,"LIST_CONDITIONS_CHANGED"): bridge.start_current("run","batch",150)
        self.assertEqual(calls[0]['version'],4);self.assertIn('leaseId',calls[0]['context'])

    def test_150_budget_survives_reopen(self):
        with tempfile.TemporaryDirectory() as td:
            path=Path(td)/"b.db"
            with CurrentListStore(path) as s:
                bid=s.run_id
                for n in range(150):
                    a=s.reserve({**JOB,"key":f"j{n}"});s.finish(a,"confirmed",{})
                with self.assertRaisesRegex(WorkflowError,"CONTACT_LIMIT"): s.reserve({**JOB,"key":"j151"})
            with CurrentListStore(path,batch_id=bid) as s:
                self.assertEqual(s.summary()['used_contacts'],150)
                with self.assertRaisesRegex(WorkflowError,"CONTACT_LIMIT"): s.reserve({**JOB,"key":"j151"})

    def test_full_loop_returns_before_single_contact_pause(self):
        with tempfile.TemporaryDirectory() as td, CurrentListStore(Path(td)/"b.db") as s:
            t=FakeTools(s)
            result=build_graph(t,s,stop_after=1).invoke(initial_state(s))
            self.assertEqual(result["stop_reason"],"VALIDATION_PAUSE")
            self.assertEqual(t.calls[:7],["preflight","read_list","inspect_job","open_chat","read_and_bind_phrase","send_phrase","confirm"])
            self.assertIn("restore",t.calls)
            self.assertEqual(s.summary()["confirmed_count"],1)
            self.assertEqual(s.summary()["returned_count"],1)
            self.assertEqual(s.summary()["read_count"],1)

    def test_preview_reads_jobs_without_contact(self):
        with tempfile.TemporaryDirectory() as td, CurrentListStore(Path(td)/"b.db",mode="preview") as s:
            t=FakeTools(s);result=build_graph(t,s).invoke(initial_state(s))
            self.assertEqual(result["stop_reason"],"PREVIEW_COMPLETE")
            self.assertEqual(t.calls,["preflight","read_list"])
            self.assertEqual(s.summary()["read_count"],1)
            self.assertEqual(s.summary()["phrase_read_count"],0)

    def test_snapshot_change_pauses_and_budget_persists(self):
        with tempfile.TemporaryDirectory() as td:
            path=Path(td)/"b.db"
            with CurrentListStore(path,max_contacts=1) as s:
                bid=s.run_id;s.pin_snapshot(SNAPSHOT);s.reserve(JOB)
                with self.assertRaisesRegex(WorkflowError,"LIST_CONDITIONS_CHANGED"):
                    s.pin_snapshot({**SNAPSHOT,"fingerprint":"b"*64})
            with CurrentListStore(path,batch_id=bid) as s:
                self.assertEqual(s.summary()["used_contacts"],1)
                self.assertEqual(s.batch()["config"]["flow"],"current-list")

    def test_log_drops_secret_and_message_fields(self):
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/"run.jsonl";log=DiagnosticLog(p,"batch",echo=False)
            log.emit("tool","failed",tool="open_chat",token="SECRET",text="PRIVATE",error="bad token SECRET",request_id="r")
            raw=p.read_text(encoding="utf-8")
            self.assertNotIn("SECRET",raw);self.assertNotIn("PRIVATE",raw)
            self.assertEqual(json.loads(raw)["error"],"UNEXPECTED_ERROR")

    def test_condition_diagnostics_keep_business_fields_only(self):
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/"run.jsonl";log=DiagnosticLog(p,"batch",echo=False)
            log.emit("tool","failed",error="LIST_CONDITIONS_CHANGED",details={
                "expected":{"city":"广州","keyword":"Java","token":"SECRET","url":"PRIVATE"},
                "observed":{"city":"深圳","filters":{"controls":["工作经验(2)"],"cookie":["SECRET"]}},
                "text":"PRIVATE"})
            raw=p.read_text(encoding="utf-8"); event=json.loads(raw)
            self.assertNotIn("SECRET",raw);self.assertNotIn("PRIVATE",raw)
            self.assertEqual(event["conditions"]["expected"]["city"],"广州")
            self.assertEqual(event["conditions"]["observed"]["filters"]["controls"],["工作经验(2)"])
