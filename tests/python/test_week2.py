import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from jobpilot.cli import main


class Week2Tests(unittest.TestCase):
    def run_graph_cli(self, payload, city='深圳'):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            source = root / 'jobs.json'
            source.write_text(json.dumps(payload, ensure_ascii=False), encoding='utf-8')
            stdout, stderr = io.StringIO(), io.StringIO()
            with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                code = main(['learn-graph', '--jobs', str(source), '--city', city], root=root)
            files = list((root / 'output/jobpilot/week2').glob('*/report.json'))
            report = json.loads(files[0].read_text(encoding='utf-8')) if files else None
            markdown = files[0].with_suffix('.md').read_text(encoding='utf-8') if files else ''
            self.assertFalse((root / 'data').exists())
            self.assertFalse((root / 'private').exists())
            return code, stdout.getvalue(), stderr.getvalue(), report, markdown

    def test_missing_description_routes_to_pending_without_model_or_network(self):
        jobs = [{'key': 'a', 'title': 'Python', 'city': '深圳', 'description': 'FastAPI'},
                {'key': 'b', 'title': 'AI', 'city': '深圳'},
                {'key': 'b', 'title': '重复', 'city': '深圳'},
                {'key': 'c', 'title': '异地', 'city': '北京'}]
        def forbidden(*args, **kwargs):
            raise AssertionError('学习图不应访问模型或网络')
        with patch('jobpilot.cli.model_planner', side_effect=forbidden), \
             patch('jobpilot.cli.BossBridge.connect', side_effect=forbidden), \
             patch('socket.socket.connect', side_effect=forbidden):
            code, stdout, _, report, markdown = self.run_graph_cli({'jobs': jobs})
        self.assertEqual(code, 0)
        self.assertEqual(report['visited_nodes'], ['load_jobs', 'filter_jobs', 'mark_missing', 'save_report'])
        self.assertEqual([j['jobId'] for j in report['ready_jobs']], ['a'])
        self.assertEqual([j['jobId'] for j in report['needs_description']], ['b'])
        self.assertEqual(report['counts']['duplicates'], 1)
        self.assertEqual(report['status'], 'needs_info')
        self.assertIn('[mark_missing]', stdout)
        self.assertIn('请补充岗位正文', markdown)

    def test_complete_jobs_skip_pending_node(self):
        code, stdout, _, report, _ = self.run_graph_cli({'jobs': [
            {'key': 'a', 'title': 'Python', 'city': '深圳', 'description': 'FastAPI'},
            {'key': 'b', 'title': 'Java', 'city': '深圳', 'description': 'Spring'}]})
        self.assertEqual(code, 0)
        self.assertEqual(report['visited_nodes'], ['load_jobs', 'filter_jobs', 'save_report'])
        self.assertEqual(len(report['ready_jobs']), 2)
        self.assertEqual(report['needs_description'], [])
        self.assertEqual(report['status'], 'completed')
        self.assertNotIn('[mark_missing]', stdout)

    def test_empty_and_unknown_city_are_not_ready(self):
        for jobs, status in [([], 'completed'), ([{'title': '未知'}], 'needs_info')]:
            code, _, _, report, _ = self.run_graph_cli({'jobs': jobs})
            self.assertEqual(code, 0)
            self.assertEqual(report['ready_jobs'], [])
            self.assertEqual(report['needs_description'], [])
            self.assertEqual(report['status'], status)
            self.assertEqual(len(report['needs_info']), len(jobs))

    def test_bad_input_stops_before_filter_and_report(self):
        for payload, message in [({'jobs': [{'city': '深圳'}]}, '缺少 title'),
                                 ({'jobs': [{'title': 'x', 'city': 4}]}, 'city 必须是字符串'),
                                 ({}, '需要 jobs 或 summaries 数组')]:
            code, stdout, stderr, report, _ = self.run_graph_cli(payload)
            self.assertEqual(code, 1)
            self.assertIn(message, stderr)
            self.assertNotIn('[filter_jobs]', stdout)
            self.assertIsNone(report)
