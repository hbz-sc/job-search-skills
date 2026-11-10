import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from jobpilot.cli import main


class Week1Tests(unittest.TestCase):
    def test_batch_of_100_without_network_model_or_config(self):
        # 模型工厂/网络若被调用，立即失败；校验的仍是真实CLI产出的报告。
        jobs = [{'key': f'sz-{i}', 'title': 'Python', 'city': '深圳'} for i in range(40)]
        jobs += [{'key': f'bj-{i}', 'title': '后端', 'city': '北京'} for i in range(30)]
        jobs += [{'key': f'unknown-{i}', 'title': 'Agent'} for i in range(20)]
        jobs += [{'key': f'sz-{i}', 'title': '重复', 'city': '深圳'} for i in range(10)]
        def forbidden(*args, **kwargs):
            raise AssertionError('离线学习不应调用模型、配置或网络')
        with patch('jobpilot.cli.model_planner', side_effect=forbidden), \
             patch('jobpilot.cli.demo_planner', side_effect=forbidden), \
             patch('jobpilot.cli.dotenv_values', side_effect=forbidden), \
             patch('jobpilot.cli.BossBridge.connect', side_effect=forbidden), \
             patch('socket.socket.connect', side_effect=forbidden), \
             patch('socket.create_connection', side_effect=forbidden):
            report = self.run_learn({'jobs': jobs})
        self.assertEqual(report['counts'], {'input': 100, 'matched': 40, 'duplicates': 10,
                                           'other_city': 30, 'unknown_city': 20})

    def test_required_field_errors_identify_problem(self):
        cases = [
            ({'jobs': [{'city': '深圳'}]}, '第 1 项岗位缺少 title'),
            ({'jobs': [{'title': '  '}]}, '第 1 项岗位缺少 title'),
            ({'jobs': [{'title': '开发', 'city': 42}]}, '字段 city 必须是字符串'),
            ({'jobs': [{'title': '开发', 'city': None}]}, '字段 city 必须是字符串'),
            ({}, '需要 jobs 或 summaries 数组'),
        ]
        for payload, message in cases:
            with self.subTest(payload=payload), tempfile.TemporaryDirectory() as td:
                root = Path(td)
                source = root / 'jobs.json'
                source.write_text(json.dumps(payload, ensure_ascii=False), encoding='utf-8')
                error = io.StringIO()
                with contextlib.redirect_stderr(error):
                    code = main(['learn', '--jobs', str(source)], root=root)
                self.assertEqual(code, 1)
                self.assertIn(message, error.getvalue())
                self.assertFalse((root / 'output').exists())

    def test_optional_fields_are_explained_in_human_report(self):
        with tempfile.TemporaryDirectory() as td, contextlib.redirect_stdout(io.StringIO()):
            root = Path(td)
            source = root / 'jobs.json'
            source.write_text('{"jobs": [{"title": "Python"}]}', encoding='utf-8')
            self.assertEqual(main(['learn', '--jobs', str(source)], root=root), 0)
            report = next((root / 'output/jobpilot/week1').glob('*/report.md')).read_text(encoding='utf-8')
            for hint in ('城市待确认', '城市未知', '公司未知', '薪资未知', '正文：待补充',
                         '链接：未提供', '岗位 ID：未提供', '判重身份：缺失，保留此条'):
                self.assertIn(hint, report)

    def run_learn(self, payload):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            source = root / 'jobs.json'
            source.write_text(json.dumps(payload, ensure_ascii=False), encoding='utf-8-sig')
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                code = main(['learn', '--jobs', str(source)], root=root)
            self.assertEqual(code, 0)
            self.assertFalse((root / 'data').exists())
            self.assertFalse((root / 'private').exists())
            files = list((root / 'output/jobpilot/week1').glob('*/report.json'))
            self.assertEqual(len(files), 1)
            self.assertTrue(files[0].with_suffix('.md').exists())
            return json.loads(files[0].read_text(encoding='utf-8'))

    def test_filter_deduplicate_and_keep_unknown_separate(self):
        report = self.run_learn({'jobs': [
            {'title': 'Python', 'city': '深圳', 'url': 'https://example.com/1', 'description': 'FastAPI'},
            {'title': '重复', 'city': '深圳', 'url': 'https://example.com/1'},
            {'title': '北京岗位', 'city': '北京', 'key': 'b'},
            {'title': '未知城市', 'key': 'u'},
            {'title': '深圳缺正文', 'city': '深圳', 'key': 'c'},
        ]})
        self.assertEqual([j['title'] for j in report['jobs']], ['Python', '深圳缺正文'])
        self.assertEqual([j['title'] for j in report['needs_info']], ['未知城市'])
        self.assertEqual(report['counts'], {'input': 5, 'matched': 2, 'duplicates': 1, 'other_city': 1, 'unknown_city': 1})
        self.assertTrue(report['jobs'][1]['missing_description'])

    def test_existing_samples_and_preview_query_city(self):
        report = self.run_learn({'summaries': [{'jobId': 'x', 'title': 'AI', 'city': '深圳'}],
                                 'details': [{'jobId': 'x', 'description': 'Python'}]})
        self.assertFalse(report['jobs'][0]['missing_description'])
        report = self.run_learn({'mode': 'preview', 'jobs': [{'key': 'a', 'title': '开发', 'query': {'city': '深圳'}}]})
        self.assertEqual(report['counts']['matched'], 1)

    def test_missing_identity_keeps_both_and_empty_list_works(self):
        report = self.run_learn({'jobs': [{'title': '同名', 'city': '深圳'}, {'title': '同名', 'city': '深圳'}]})
        self.assertEqual(report['counts']['matched'], 2)
        self.assertTrue(report['jobs'][0]['missing_identity'])
        self.assertEqual(self.run_learn({'jobs': []})['counts']['input'], 0)

    def test_bad_input_returns_error_without_report(self):
        for contents in ('{bad', '{"jobs": [42]}', '{"jobs": [{"title": "x", "city": 42}]}', '{"wrong": []}'):
            with self.subTest(contents=contents), tempfile.TemporaryDirectory() as td:
                root = Path(td)
                source = root / 'jobs.json'
                source.write_text(contents, encoding='utf-8')
                with contextlib.redirect_stderr(io.StringIO()):
                    self.assertEqual(main(['learn', '--jobs', str(source)], root=root), 1)
                self.assertFalse((root / 'output').exists())
