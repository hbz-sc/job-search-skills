import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import httpx
from jobpilot.errors import WorkflowError
from jobpilot.model_connection import (load_model_config, validate_model_config,
    request_json, check_model, error_info)

CONFIG = dict(JOBPILOT_MODEL='test', JOBPILOT_BASE_URL='https://example.test/v1', JOBPILOT_API_KEY='SECRET_SENTINEL')


class ConnectionTests(unittest.TestCase):
    def test_bailian_selected_model_uses_non_thinking_json_mode(self):
        def handler(request):
            body = json.loads(request.content)
            self.assertIs(body['enable_thinking'], False)
            return httpx.Response(200, json={'choices': [{'message': {'content': '{"ok":true}'}}]})
        check_model({**CONFIG, 'JOBPILOT_MODEL': 'deepseek-v4.1-flash-1017',
                     'JOBPILOT_BASE_URL': 'https://dashscope.aliyuncs.com/compatible-mode/v1'},
                    transport=httpx.MockTransport(handler))

    def test_truncated_response_is_not_a_valid_analysis(self):
        for content in ['', '{"requirements":[]}']:
            response = {'choices': [{'finish_reason': 'length', 'message': {'content': content}}]}
            with self.assertRaisesRegex(WorkflowError, '^MODEL_OUTPUT_TRUNCATED$'):
                request_json(CONFIG, [], max_tokens=4000,
                             transport=httpx.MockTransport(lambda _: httpx.Response(200, json=response)))

    def test_http_errors_are_classified_without_secrets_or_retries(self):
        codes = {401: 'MODEL_AUTH_FAILED', 403: 'MODEL_ACCESS_DENIED', 404: 'MODEL_NOT_FOUND',
                 429: 'MODEL_RATE_LIMITED', 500: 'MODEL_SERVER_ERROR', 400: 'MODEL_CALL_FAILED', 302: 'MODEL_CALL_FAILED'}
        for status, code in codes.items():
            with self.subTest(status=status):
                calls = []
                def handler(request):
                    calls.append(request)
                    return httpx.Response(status, text='SECRET_SENTINEL', headers={'location': 'https://elsewhere.test'})
                with self.assertRaisesRegex(WorkflowError, '^' + code + '$'):
                    request_json(CONFIG, [], max_tokens=32, transport=httpx.MockTransport(handler))
                self.assertEqual(len(calls), 1)
                self.assertNotIn('SECRET_SENTINEL', str(error_info(code)))

    def test_network_and_response_errors(self):
        for error, code in [(httpx.ReadTimeout('SECRET_SENTINEL'), 'MODEL_TIMEOUT'),
                            (httpx.ConnectError('SECRET_SENTINEL'), 'MODEL_CONNECTION_FAILED')]:
            def handler(_):
                raise error
            with self.assertRaisesRegex(WorkflowError, '^' + code + '$'):
                request_json(CONFIG, [], max_tokens=32, transport=httpx.MockTransport(handler))
        for payload in [{'choices': []}, {'choices': [{'message': {'content': '[]'}}]},
                        {'choices': [{'message': {'content': 'not JSON'}}]}]:
            with self.assertRaisesRegex(WorkflowError, '^MODEL_OUTPUT_INVALID$'):
                request_json(CONFIG, [], max_tokens=32, transport=httpx.MockTransport(lambda _: httpx.Response(200, json=payload)))

    def test_diagnostic_contract_no_private_material(self):
        requests = []
        def handler(request):
            requests.append(request)
            body = json.loads(request.content)
            self.assertEqual(body['response_format'], {'type': 'json_object'})
            self.assertEqual(body['max_tokens'], 32)
            self.assertEqual(body['model'], 'test')
            self.assertEqual(request.headers['Authorization'], 'Bearer SECRET_SENTINEL')
            self.assertNotIn('resume', request.content.decode())
            return httpx.Response(200, json={'choices': [{'message': {'content': '{"ok": true}'}}]})
        result = check_model(CONFIG, transport=httpx.MockTransport(handler))
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(len(requests), 1)
        self.assertNotIn('SECRET_SENTINEL', str(result))

    def test_config_precedence_and_endpoint_validation(self):
        with tempfile.TemporaryDirectory() as td, patch.dict(os.environ, {}, clear=True):
            Path(td, '.env').write_text('JOBPILOT_MODEL=file\nJOBPILOT_API_KEY=local\n', encoding='utf8')
            os.environ['JOBPILOT_MODEL'] = 'environment'
            os.environ['JOBPILOT_API_KEY'] = ''
            config, sources = load_model_config(Path(td))
            self.assertEqual(config['JOBPILOT_MODEL'], 'environment')
            self.assertEqual(config['JOBPILOT_API_KEY'], '')
            self.assertEqual(sources['JOBPILOT_API_KEY'], 'env')
            self.assertEqual(sources['JOBPILOT_BASE_URL'], 'missing')
        for field in CONFIG:
            with self.assertRaisesRegex(WorkflowError, 'MODEL_CONFIG_REQUIRED'):
                validate_model_config({**CONFIG, field: ' '})
        for url in ['https://user:SECRET_SENTINEL@example.test/v1', 'https://example.test/?key=SECRET_SENTINEL',
                    'https://example.test/#secret', 'http://example.test/v1', 'https://', 'https://example.test:bad']:
            with self.assertRaisesRegex(WorkflowError, '^MODEL_ENDPOINT_INVALID$'):
                validate_model_config({**CONFIG, 'JOBPILOT_BASE_URL': url})
        self.assertEqual(validate_model_config({**CONFIG, 'JOBPILOT_MODEL': ' test '})['JOBPILOT_MODEL'], 'test')
