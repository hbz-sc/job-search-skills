import json
import tempfile
import unittest
from pathlib import Path
from jobpilot.week3 import build_analysis_graph
from jobpilot.practice_inputs import read_practice_jobs
from jobpilot.errors import WorkflowError
from test_practice_inputs import JOB

RESUME = '使用Python开发接口'
ANSWER = {'requirements': [{'requirement': 'Python', 'job_quote': '要求Python开发经验',
          'status': 'matched', 'resume_quote': RESUME, 'reason': '有经历', 'question': ''}]}


class AnalysisRepairTests(unittest.TestCase):
    def run_case(self, jobs, analyzer, limit=3):
        events = []
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / 'resume.txt').write_text(RESUME, encoding='utf8')
            (root / 'jobs.json').write_text(json.dumps({'jobs': jobs}), encoding='utf8')
            state = build_analysis_graph(analyzer, job_reader=read_practice_jobs, progress=events.append).invoke(
                dict(root=td, source=str(root/'jobs.json'), resume_path=str(root/'resume.txt'),
                     limit=limit, city='深圳', mode='practice', model='test-model'))
            path = Path(state['report_path'])
            return json.loads(path.read_text(encoding='utf8')), path.with_suffix('.md').read_text(encoding='utf8'), events

    def jobs(self, n):
        return [{**JOB, 'url': f'https://example.test/jobs/{i}'} for i in range(n)]

    def test_global_failure_stops_remaining_requests_and_preserves_success(self):
        for code in ['MODEL_AUTH_FAILED', 'MODEL_ACCESS_DENIED', 'MODEL_NOT_FOUND', 'MODEL_RATE_LIMITED']:
            for succeed_first in [False, True]:
                calls = []
                def analyzer(*_):
                    calls.append(1)
                    if succeed_first and len(calls) == 1:
                        return ANSWER
                    raise WorkflowError(code)
                report, _, _ = self.run_case(self.jobs(3), analyzer)
                self.assertEqual(len(calls), 2 if succeed_first else 1)
                expected = ['matched', 'failed', 'deferred'] if succeed_first else ['failed', 'deferred', 'deferred']
                self.assertEqual([r['status'] for r in report['results']], expected)
                self.assertEqual(report['status'], 'partial')
                self.assertEqual(report['model_calls'], len(calls))

    def test_timeout_continues_and_progress_is_ordered(self):
        calls = []
        def analyzer(*_):
            calls.append(1)
            if len(calls) == 1:
                raise WorkflowError('MODEL_TIMEOUT')
            return ANSWER
        report, md, events = self.run_case(self.jobs(3), analyzer, limit=2)
        self.assertEqual([r['status'] for r in report['results']], ['failed', 'matched', 'deferred'])
        self.assertEqual([e['phase'] for e in events], ['start', 'end', 'start', 'end'])
        self.assertTrue(all(e['elapsed_seconds'] >= 0 for e in events))
        self.assertEqual(report['summary']['analyzed'], 1)
        self.assertEqual(report['model'], 'test-model')
        self.assertIn('待确认', md)
        self.assertNotIn('resume', report)
        for field in ('capturedAt', 'description_kind', 'listing_status'):
            self.assertEqual(report['results'][1][field], JOB[field])
            self.assertIn(JOB[field], md)

    def test_missing_closed_and_empty_cases_do_not_call_model(self):
        def forbidden(*_):
            self.fail('No model call allowed')
        for jobs in [[], [{**JOB, 'description': ''}], [{**JOB, 'listing_status': 'closed'}],
                     [{**JOB, 'city': '北京'}], [{**JOB, 'city': ''}], [{**JOB, 'description_kind': 'summary'}]]:
            report, _, events = self.run_case(jobs, forbidden)
            self.assertEqual(report['model_calls'], 0)
            self.assertEqual(report['status'], 'needs_info')
            self.assertEqual(events, [])
        report, _, _ = self.run_case([{**JOB, 'city': ''}], forbidden)
        self.assertEqual(report['unknown_city'][0]['capturedAt'], JOB['capturedAt'])

    def test_missing_fields_do_not_consume_budget_or_become_deferred(self):
        jobs = self.jobs(3)
        jobs[0]['description'] = ''
        report, _, _ = self.run_case(jobs, lambda *_: ANSWER, limit=1)
        self.assertEqual([r['status'] for r in report['results']], ['needs_info', 'matched', 'deferred'])
        self.assertEqual(report['model_calls'], 1)
