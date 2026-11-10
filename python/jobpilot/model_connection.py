"""模型连接边界：只传播固定错误码，诊断不发送私人材料。"""
import json
import os
from pathlib import Path
from urllib.parse import urlsplit
import httpx
from dotenv import dotenv_values
from .errors import WorkflowError

FIELDS = ('JOBPILOT_MODEL', 'JOBPILOT_BASE_URL', 'JOBPILOT_API_KEY')
ERRORS = {
    'MODEL_CONFIG_REQUIRED': (None, '模型配置缺失，请在本地 .env 配置模型、接口和 API Key，并检查环境变量覆盖。'),
    'MODEL_ENDPOINT_INVALID': (None, '模型接口地址无效，请使用无账号、查询参数或片段的 HTTPS 地址。'),
    'MODEL_AUTH_FAILED': (401, '鉴权失败：请检查本地百炼 API Key 与接口地域，AccessKey Secret 不能替代该接口 API Key。'),
    'MODEL_ACCESS_DENIED': (403, '访问被拒：请检查模型授权、账户及地域权限。'),
    'MODEL_NOT_FOUND': (404, '模型或端点不可用：请核对接口地址及模型名称。'),
    'MODEL_RATE_LIMITED': (429, '请求受限：请检查额度、配额或请求频率，稍后手动重试。'),
    'MODEL_SERVER_ERROR': (None, '模型服务端错误，请稍后手动重试。'),
    'MODEL_CALL_FAILED': (None, '模型请求被拒绝，请检查服务配置。'),
    'MODEL_TIMEOUT': (None, '模型网络操作超时，本次不自动重试。'),
    'MODEL_CONNECTION_FAILED': (None, '模型连接失败，请检查网络和接口地址。'),
    'MODEL_OUTPUT_INVALID': (None, '模型输出不符合 JSON 或结构要求。'),
    'MODEL_OUTPUT_TRUNCATED': (None, '模型输出达到 Token 上限被截断，未作为完整分析接受；请检查思考模式或输出预算。'),
    'JOB_EVIDENCE_INVALID': (None, '模型岗位引用未通过原文校验。'),
    'RESUME_EVIDENCE_INVALID': (None, '模型简历引用未通过原文校验。'),
    'UNKNOWN_REQUIRES_QUESTION': (None, '信息不足的分析项缺少有效追问。'),
    'ANALYSIS_FAILED': (None, '岗位分析失败，请检查输入并查看报告。'),
}
BLOCKING_MODEL_ERRORS = frozenset(('MODEL_AUTH_FAILED', 'MODEL_ACCESS_DENIED', 'MODEL_NOT_FOUND', 'MODEL_RATE_LIMITED'))


def error_info(code: str) -> dict:
    code = code if code in ERRORS else 'ANALYSIS_FAILED'
    status, message = ERRORS[code]
    return {'code': code, 'http_status': status, 'message': message}


def load_model_config(root: Path) -> tuple[dict, dict]:
    local = dotenv_values(Path(root) / '.env')
    sources = {k: 'env' if k in os.environ else 'dotenv' if k in local else 'missing' for k in FIELDS}
    return {k: os.environ[k] if k in os.environ else local.get(k, '') for k in FIELDS}, sources


def validate_model_config(config: dict) -> dict:
    if not all(isinstance(config.get(k), str) and config[k].strip() for k in FIELDS):
        raise WorkflowError('MODEL_CONFIG_REQUIRED')
    config = {k: config[k].strip() for k in FIELDS}
    try:
        url = urlsplit(config['JOBPILOT_BASE_URL'])
        valid = (url.hostname and not url.username and not url.password and not url.query and not url.fragment
                 and (url.scheme == 'https' or (url.scheme == 'http' and url.hostname in {'localhost', '127.0.0.1'})))
        _ = url.port
        if not valid:
            raise ValueError()
    except ValueError:
        raise WorkflowError('MODEL_ENDPOINT_INVALID') from None
    return config


def request_json(config: dict, messages: list[dict], *, max_tokens: int, transport=None) -> dict:
    config = validate_model_config(config)
    payload = {'model': config['JOBPILOT_MODEL'], 'messages': messages, 'temperature': 0,
               'max_tokens': max_tokens, 'response_format': {'type': 'json_object'}}
    # 此百炼快照已实测支持关闭思考；避免思考耗尽预算导致 content 为空。
    # 不向其他供应商/模型发送未经验证的扩展参数。
    host = urlsplit(config['JOBPILOT_BASE_URL']).hostname or ''
    if config['JOBPILOT_MODEL'] == 'deepseek-v4.1-flash-1017' and host.endswith('.aliyuncs.com'):
        payload['enable_thinking'] = False
    try:
        with httpx.Client(timeout=45, follow_redirects=False, transport=transport) as client:
            response = client.post(config['JOBPILOT_BASE_URL'].rstrip('/') + '/chat/completions',
                headers={'Authorization': 'Bearer ' + config['JOBPILOT_API_KEY']},
                json=payload)
            response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code
        code = {401: 'MODEL_AUTH_FAILED', 403: 'MODEL_ACCESS_DENIED', 404: 'MODEL_NOT_FOUND',
                429: 'MODEL_RATE_LIMITED'}.get(status, 'MODEL_SERVER_ERROR' if status >= 500 else 'MODEL_CALL_FAILED')
        raise WorkflowError(code) from None
    except httpx.TimeoutException:
        raise WorkflowError('MODEL_TIMEOUT') from None
    except httpx.RequestError:
        raise WorkflowError('MODEL_CONNECTION_FAILED') from None
    try:
        choice = response.json()['choices'][0]
        if choice.get('finish_reason') == 'length':
            raise WorkflowError('MODEL_OUTPUT_TRUNCATED')
        data = json.loads(choice['message']['content'])
        if not isinstance(data, dict):
            raise ValueError()
        return data
    except (ValueError, KeyError, IndexError, TypeError):
        raise WorkflowError('MODEL_OUTPUT_INVALID') from None


def check_model(config: dict, *, transport=None) -> dict:
    config = validate_model_config(config)
    request_json(config, [{'role': 'user', 'content': 'Return only a JSON object: {"ok":true}'}],
                 max_tokens=32, transport=transport)
    return {'status': 'completed', 'model': config['JOBPILOT_MODEL'], 'model_calls': 1}
