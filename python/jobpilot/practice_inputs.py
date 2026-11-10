"""实战输入边界：结构错误停止，单个岗位缺资料列出问题。"""
import json
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit

FIELDS = ('jobId', 'title', 'company', 'city', 'salary', 'url', 'description',
          'capturedAt', 'description_kind', 'listing_status')


def read_practice_jobs(path: str | Path) -> list[dict]:
    try:
        payload = json.loads(Path(path).read_text(encoding='utf-8-sig'))
    except (json.JSONDecodeError, UnicodeError):
        raise ValueError('岗位文件必须是合法 UTF-8 JSON') from None
    if not isinstance(payload, dict) or not isinstance(payload.get('jobs'), list):
        raise ValueError('JSON 顶层需要 jobs 数组')
    jobs = []
    for index, row in enumerate(payload['jobs'], 1):
        if not isinstance(row, dict):
            raise ValueError(f'第 {index} 项岗位必须是对象')
        item = {}
        for field in FIELDS:
            value = row.get(field, '')
            if not isinstance(value, str):
                raise ValueError(f'第 {index} 项字段 {field} 必须是字符串')
            item[field] = value.strip()
        item['listing_status'] = item['listing_status'] or 'unverified'
        for field, allowed in [('description_kind', {'original_full', 'summary'}),
                               ('listing_status', {'observed_open', 'closed', 'unverified'})]:
            if item[field] and item[field] not in allowed:
                raise ValueError(f'第 {index} 项字段 {field} 枚举无效')
        if item['capturedAt']:
            try:
                dt = datetime.fromisoformat(item['capturedAt'])
                if dt.tzinfo is None or dt.utcoffset() is None:
                    raise ValueError()
            except ValueError:
                raise ValueError(f'第 {index} 项字段 capturedAt 需要带时区的 ISO 8601 时间') from None
        issues = [f'缺少 {field}，请补充' for field in
                  ('title', 'company', 'city', 'url', 'capturedAt', 'description') if not item[field]]
        if item['url']:
            try:
                url = urlsplit(item['url'])
                if url.scheme not in {'http', 'https'} or not url.hostname or url.username is not None or url.password is not None:
                    raise ValueError()
                _ = url.port
            except ValueError:
                issues.append('url 必须是无账号信息的 HTTP(S) 岗位来源链接')
                item['url'] = ''  # 不把 URL 内潜在凭据写入报告
        if item['description_kind'] != 'original_full':
            issues.append('description_kind 需为 original_full，请核验并补充完整正文，不能将摘要冒充原文')
        item.update(issues=issues, missing_description=not bool(item['description']),
                    missing_identity=not bool(item['url'] or item['jobId']))
        jobs.append(item)
    return jobs
