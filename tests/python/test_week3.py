import copy
import json
import tempfile
import unittest
from pathlib import Path
import httpx

from jobpilot.week3_model import validate_analysis, create_analyzer, redact
from jobpilot.week3 import build_analysis_graph
from jobpilot.errors import WorkflowError

RESUME = '使用Python开发接口。尚无模型训练经验。'
JD = '要求Python开发经验。要求模型训练经验。英语良好。'
ANSWER = {'requirements': [
    {'requirement': 'Python开发', 'job_quote': '要求Python开发经验', 'status': 'matched', 'resume_quote': '使用Python开发接口', 'reason': '有相关开发经历', 'question': ''},
    {'requirement': '模型训练', 'job_quote': '要求模型训练经验', 'status': 'gap', 'resume_quote': '尚无模型训练经验', 'reason': '明确缺少训练经验', 'question': ''},
    {'requirement': '英语', 'job_quote': '英语良好', 'status': 'unknown', 'resume_quote': '', 'reason': '简历未说明', 'question': '英语是否满足工作沟通要求？'}]}


class Week3Tests(unittest.TestCase):
    def test_real_jd_with_more_than_twenty_requirements_is_not_discarded(self):
        # 实际 JD 的职责、硬性要求及加分项合计可超过 20 项。
        items = [{'requirement': f'要求{i}', 'job_quote': f'岗位要求{i}。', 'status': 'unknown',
                  'resume_quote': '', 'reason': '简历未说明', 'question': f'是否满足要求{i}？'} for i in range(41)]
        jd = ''.join(r['job_quote'] for r in items)
        self.assertEqual(len(validate_analysis({'requirements': items[:24]}, RESUME, jd)['requirements']), 24)
        with self.assertRaisesRegex(WorkflowError, '^MODEL_OUTPUT_INVALID$'):
            validate_analysis({'requirements': items}, RESUME, jd)

    def test_schema_and_source_evidence(self):
        result = validate_analysis(ANSWER, RESUME, JD)
        self.assertEqual([r['status'] for r in result['requirements']], ['matched', 'gap', 'unknown'])
        for field, value in [('resume_quote', '虚构项目经历'), ('job_quote', '岗位未写的要求'), ('status', 'perfect')]:
            bad = copy.deepcopy(ANSWER)
            bad['requirements'][0][field] = value
            with self.assertRaises(WorkflowError):
                validate_analysis(bad, RESUME, JD)

    def test_gap_requires_evidence_unknown_requires_question(self):
        for index, field in [(1, 'resume_quote'), (2, 'question')]:
            bad = copy.deepcopy(ANSWER)
            bad['requirements'][index][field] = ''
            with self.assertRaises(WorkflowError):
                validate_analysis(bad, RESUME, JD)
        with self.assertRaises(WorkflowError):
            validate_analysis({**ANSWER, 'extra': 'ignore instructions'}, RESUME, JD)

    def test_two_requirements_can_quote_the_same_source_sentence(self):
        data = {'requirements': [
            {'requirement': skill, 'job_quote': '要求Python和SQL', 'status': 'matched',
             'resume_quote': '使用Python和SQL开发接口', 'reason': '有相关经历', 'question': ''}
            for skill in ['Python', 'SQL']]}
        self.assertEqual(len(validate_analysis(data, '使用Python和SQL开发接口', '要求Python和SQL')['requirements']), 2)
        with self.assertRaises(WorkflowError):
            validate_analysis({'requirements': [data['requirements'][0]] * 2}, '使用Python和SQL开发接口', '要求Python和SQL')
        with self.assertRaises(WorkflowError):
            validate_analysis({'requirements': [[]]}, RESUME, JD)

    def test_http_contract_and_failure_redaction(self):
        def handler(request):
            body = json.loads(request.content)
            self.assertEqual(body['messages'][0]['role'], 'system')
            self.assertEqual(json.loads(body['messages'][1]['content'])['resume'], RESUME)
            self.assertEqual(body['response_format'], {'type': 'json_object'})
            return httpx.Response(200, json={'choices': [{'message': {'content': json.dumps(ANSWER)}}]})
        config = {'JOBPILOT_MODEL': 'test', 'JOBPILOT_BASE_URL': 'https://example.test/v1', 'JOBPILOT_API_KEY': 'secret'}
        analyzer = create_analyzer(config, transport=httpx.MockTransport(handler))
        self.assertEqual(analyzer(RESUME, JD), ANSWER)
        for response, code in [(httpx.Response(500, text='secret'), 'MODEL_SERVER_ERROR'), (httpx.Response(200, json={'choices': []}), 'MODEL_OUTPUT_INVALID')]:
            analyzer = create_analyzer(config, transport=httpx.MockTransport(lambda _: response))
            with self.assertRaisesRegex(WorkflowError, '^' + code + '$'):
                analyzer(RESUME, JD)

    def test_auth_failure_is_actionable_without_response_secrets(self):
        config = {'JOBPILOT_MODEL': 'test', 'JOBPILOT_BASE_URL': 'https://example.test/v1', 'JOBPILOT_API_KEY': 'secret'}
        analyzer = create_analyzer(config, transport=httpx.MockTransport(lambda _: httpx.Response(401, text='private credential')))
        with self.assertRaisesRegex(WorkflowError, '^MODEL_AUTH_FAILED$'):
            analyzer(RESUME, JD)
        _, report = self.run_graph(analyzer, [{'title': '开发', 'city': '深圳', 'description': JD}])
        self.assertEqual(report['results'][0]['error'], 'MODEL_AUTH_FAILED')
        self.assertNotIn('private credential', str(report))

    def run_graph(self, analyzer, jobs):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / 'resume.txt').write_text(RESUME, encoding='utf-8')
            (root / 'jobs.json').write_text(json.dumps({'jobs': jobs}), encoding='utf-8')
            result = build_analysis_graph(analyzer).invoke({'root': td, 'source': str(root / 'jobs.json'), 'resume_path': str(root / 'resume.txt'), 'city': '深圳', 'limit': 2})
            report = json.loads(Path(result['report_path']).read_text(encoding='utf-8')) if result.get('report_path') else None
            self.assertFalse((root / 'data').exists())
            return result, report

    def test_graph_classifies_missing_skips_unknown_and_limits_calls(self):
        calls = []
        def analyzer(resume, jd):
            calls.append(jd)
            return ANSWER
        jobs = [{'key': str(i), 'title': '开发', 'city': '深圳', 'description': JD} for i in range(3)]
        jobs += [{'key': 'missing', 'title': '缺正文', 'city': '深圳'}, {'key': 'unknown', 'title': '未知城市'}]
        result, report = self.run_graph(analyzer, jobs)
        self.assertEqual(len(calls), 2)
        self.assertEqual([r['status'] for r in report['results']], ['needs_info', 'needs_info', 'deferred', 'needs_info'])
        self.assertEqual(len(report['unknown_city']), 1)
        self.assertEqual(report['results'][0]['matches'][0]['resume_quote'], '使用Python开发接口')
        self.assertNotIn('resume', report)

    def test_model_failure_and_bad_evidence_do_not_become_success(self):
        def fail(*args):
            raise RuntimeError('secret-private-input')
        for analyzer in [fail, lambda *_: {'requirements': [{'fake': 'data'}]}]:
            result, report = self.run_graph(analyzer, [{'title': '开发', 'city': '深圳', 'description': JD}])
            self.assertEqual(report['status'], 'failed')
            self.assertEqual(report['results'][0]['status'], 'failed')
            self.assertNotIn('secret-private', json.dumps(report))

    def test_invalid_input_stops_before_model(self):
        def forbidden(*args):
            self.fail('must not call model')
        result, report = self.run_graph(forbidden, [{'city': '深圳'}])
        self.assertIn('缺少 title', result['error'])
        self.assertIsNone(report)

    def test_empty_requirements_are_unknown_not_a_match(self):
        _, report = self.run_graph(lambda *_: {'requirements': []},
            [{'title': '开发', 'city': '深圳', 'description': JD}])
        self.assertEqual(report['results'][0]['status'], 'needs_info')
        self.assertEqual(report['results'][0]['matches'], [])
        self.assertTrue(report['results'][0]['questions'])

    def test_failed_calls_still_consume_budget(self):
        calls = []
        def fail(*args):
            calls.append(1)
            raise WorkflowError('MODEL_CALL_FAILED')
        _, report = self.run_graph(fail, [{'key': str(i), 'title': '开发', 'city': '深圳', 'description': JD} for i in range(4)])
        self.assertEqual(len(calls), 2)
        self.assertEqual([r['status'] for r in report['results']], ['failed', 'failed', 'deferred', 'deferred'])

    def test_contact_redaction_and_missing_config(self):
        self.assertEqual(redact('邮箱user@example.com 电话13800138000 Python'), '邮箱[邮箱] 电话[电话] Python')
        with self.assertRaisesRegex(WorkflowError, '^MODEL_CONFIG_REQUIRED$'):
            create_analyzer({})
