import contextlib
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import httpx
from jobpilot.cli import main
from jobpilot.practice import run_check_model, run_practice
from test_practice_inputs import JOB
from test_analysis_repair import ANSWER, RESUME


class PracticeCliTests(unittest.TestCase):
    def invoke(self, args, *, jobs=None, status=200, invalid_config=False, interrupt=False):
        requests, output = [], io.StringIO()
        original_client = httpx.Client
        def handler(request):
            requests.append(request)
            if interrupt:
                raise KeyboardInterrupt()
            return httpx.Response(status, json={'choices': [{'message': {'content': json.dumps(ANSWER)}}]},
                                  text=None if status == 200 else 'SECRET_SENTINEL') if status == 200 else httpx.Response(status, text='SECRET_SENTINEL')
        with tempfile.TemporaryDirectory() as td, patch.dict(os.environ, {}, clear=True):
            root = Path(td)
            (root / '.env').write_text('JOBPILOT_MODEL=test\nJOBPILOT_API_KEY=SECRET_SENTINEL\nJOBPILOT_BASE_URL=' +
                ('https://user:SECRET_SENTINEL@example.test/v1' if invalid_config else 'https://example.test/v1'), encoding='utf8')
            (root / 'resume.txt').write_text(RESUME, encoding='utf8')
            (root / 'jobs.json').write_text(json.dumps({'jobs': [JOB] if jobs is None else jobs}), encoding='utf8')
            with patch('jobpilot.model_connection.httpx.Client', side_effect=lambda **kw: original_client(**{**kw, 'transport': httpx.MockTransport(handler)})), \
                 patch('jobpilot.bridge.BossBridge.connect', side_effect=AssertionError('must not connect BOSS')), \
                 contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
                code = main(args, root=root)
            reports = [json.loads(p.read_text(encoding='utf8')) for p in root.glob('output/jobpilot/week3/*/report.json')]
        self.assertNotIn('SECRET_SENTINEL', output.getvalue())
        self.assertNotIn('SECRET_SENTINEL', str(reports))
        return code, output.getvalue(), requests, reports

    def test_real_arguments_are_required(self):
        for args in [['analyze'], ['analyze', '--resume', 'resume.txt']]:
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as caught:
                main(args)
            self.assertEqual(caught.exception.code, 2)

    def test_success_and_missing_inputs_exit_codes(self):
        args = ['analyze', '--resume', 'resume.txt', '--jobs', 'jobs.json']
        code, output, requests, reports = self.invoke(args)
        self.assertEqual(code, 0)
        self.assertEqual(len(requests), 1)
        self.assertIn('正在分析', output)
        self.assertIn('[阅读版]', output)
        self.assertEqual(reports[0]['mode'], 'practice')
        code, _, requests, reports = self.invoke(args, jobs=[{**JOB, 'description': ''}])
        self.assertEqual(code, 0)
        self.assertEqual(requests, [])
        self.assertEqual(reports[0]['status'], 'needs_info')
        code, _, requests, _ = self.invoke(args, jobs=[{**JOB, 'description': 12}])
        self.assertEqual(code, 1)
        self.assertEqual(requests, [])

    def test_diagnostic_single_request_and_config_failure_is_safe(self):
        code, output, requests, reports = self.invoke(['check-model'])
        self.assertEqual(code, 0)
        self.assertEqual(len(requests), 1)
        self.assertEqual(reports, [])
        self.assertIn('dotenv', output)
        self.assertNotIn(RESUME, requests[0].content.decode())
        code, output, requests, _ = self.invoke(['check-model'], invalid_config=True)
        self.assertEqual(code, 1)
        self.assertEqual(requests, [])
        self.assertIn('MODEL_ENDPOINT_INVALID', output)

    def test_partial_auth_and_user_cancel(self):
        args = ['analyze', '--resume', 'resume.txt', '--jobs', 'jobs.json', '--limit', '3']
        jobs = [JOB, {**JOB, 'url': 'https://example.test/jobs/2'}]
        code, output, requests, reports = self.invoke(args, jobs=jobs, status=401)
        self.assertEqual(code, 1)
        self.assertEqual(len(requests), 1)
        self.assertEqual(reports[0]['status'], 'partial')
        self.assertIn('MODEL_AUTH_FAILED', output)
        code, output, requests, _ = self.invoke(args, interrupt=True)
        self.assertEqual(code, 130)
        self.assertIn('用户已中断', output)

    def test_learning_mode_labels_examples(self):
        with tempfile.TemporaryDirectory() as td, patch.dict(os.environ, {}, clear=True), \
             contextlib.redirect_stdout(io.StringIO()) as out, contextlib.redirect_stderr(io.StringIO()):
            main(['learn-model'], root=Path(td))
            self.assertIn('学习模式', out.getvalue())
            self.assertIn('样例', out.getvalue())
