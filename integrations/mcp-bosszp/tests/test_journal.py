from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from boss_bridge.journal import Journal
from boss_bridge.diagnostics import sanitize_url

class JournalTests(unittest.TestCase):
    def test_duplicate_conflict_restart_and_unknown_result(self):
        with tempfile.TemporaryDirectory() as td:
            path=Path(td)/'journal.sqlite'
            j=Journal(path)
            self.assertTrue(j.accept('q1','run1',{'tool':'read'}))
            self.assertFalse(j.accept('q1','run1',{'tool':'read'}))
            with self.assertRaises(ValueError):j.accept('q1','run1',{'tool':'write'})
            j.finish('q1',{'requestId':'q1','phase':'executing','evidenceIds':[]})
            j.close()
            j=Journal(path)
            self.assertEqual(j.result('q1')['phase'],'uncertain')
            self.assertEqual(j.result('missing')['phase'],'uncertain')
            j.finish('q1',{'requestId':'q1','phase':'observed','evidenceIds':[],'value':{'ok':True}})
            self.assertFalse(j.accept('q1','run1',{'tool':'read'}))
            self.assertTrue(j.result('q1')['value']['ok'])
            j.close()

    def test_diagnostics_whitelist_and_url_redaction(self):
        self.assertEqual(sanitize_url('https://www.zhipin.com/web/geek/jobs?token=SECRET#x'),'https://www.zhipin.com/web/geek/jobs')
        self.assertEqual(sanitize_url('chrome://newtab'),'chrome://newtab')
        with tempfile.TemporaryDirectory() as td:
            j=Journal(Path(td)/'journal.sqlite')
            j.event('r1','q1','content_received',{'url':'https://www.zhipin.com/?token=SECRET','token':'SECRET','body':'PRIVATE','documentId':'d'})
            events=j.events('r1')
            self.assertNotIn('SECRET',str(events));self.assertNotIn('PRIVATE',str(events))
            self.assertEqual(events[-1]['stage'],'content_received')
            j.close()
