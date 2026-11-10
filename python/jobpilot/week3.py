"""第三周图：读取资料 → 模型分析并校验证据 → 保存可审阅报告。"""
import argparse
import json
import sys
import time
from pathlib import Path
from typing import TypedDict
from uuid import uuid4
from langgraph.graph import StateGraph, START, END
from .week1 import read_jobs, filter_jobs
from .week3_model import create_analyzer, validate_analysis, redact
from .errors import WorkflowError
from .model_connection import BLOCKING_MODEL_ERRORS, ERRORS, error_info, load_model_config


class AnalysisState(TypedDict, total=False):
    root: str
    source: str
    resume_path: str
    city: str
    limit: int
    resume: str
    filtered: dict
    results: list[dict]
    error: str
    calls: int
    status: str
    report_path: str
    mode: str
    model: str
    elapsed_seconds: float
    summary: dict


def load_inputs(state: AnalysisState, *, job_reader=read_jobs):
    try:
        if type(state['limit']) is not int or not 1 <= state['limit'] <= 10:
            raise ValueError('limit必须为1至10')
        if not isinstance(state['city'], str) or not state['city'].strip():
            raise ValueError('城市不能为空')
        resume = Path(state['resume_path']).read_text(encoding='utf-8-sig').strip()
        if not resume or len(resume) > 20000:
            raise ValueError('简历需为1至20000字文本')
        filtered = filter_jobs(job_reader(state['source']), state['city'].strip())
        return {'resume': redact(resume), 'filtered': filtered, 'error': ''}
    except (ValueError, OSError) as exc:
        return {'error': str(exc), 'status': 'failed'}


def job_metadata(job):
    fields = ('jobId', 'title', 'company', 'city', 'salary', 'url',
              'capturedAt', 'description_kind', 'listing_status', 'issues')
    return {k: job[k] for k in fields if k in job}


def analyze_batch(state: AnalysisState, analyzer, *, progress=None):
    results, calls = [], 0
    started, blocked = time.monotonic(), ''
    jobs = state['filtered']['jobs']
    for index, job in enumerate(jobs, 1):
        item = job_metadata(job)
        if job.get('listing_status') == 'closed':
            results.append({**item, 'status': 'skipped', 'reason': '岗位已关闭，未调用模型'})
            continue
        if job.get('issues') or job['missing_description']:
            results.append({**item, 'status': 'needs_info', 'questions': job.get('issues') or ['请补充完整岗位正文']})
            continue
        if len(job['description']) > 20000:
            results.append({**item, 'status': 'failed', 'error': 'JOB_TEXT_TOO_LONG'})
            continue
        if blocked or calls >= state['limit']:
            results.append({**item, 'status': 'deferred', 'reason':
                            f'批次已停止：{blocked}' if blocked else '本次模型调用上限已到'})
            continue
        calls += 1
        description = redact(job['description'])
        item_started = time.monotonic()
        event = {'index': index, 'total': len(jobs), 'title': job['title'], 'calls': calls, 'limit': state['limit']}
        if progress:
            progress({**event, 'phase': 'start', 'status': 'running', 'elapsed_seconds': 0.0})
        try:
            data = analyzer(state['resume'], description)
            analysis = validate_analysis(data, state['resume'], description)
            requirements = analysis['requirements']
            matches = [r for r in requirements if r['status'] == 'matched']
            gaps = [r for r in requirements if r['status'] == 'gap']
            unknown = [r for r in requirements if r['status'] == 'unknown']
            questions = [r['question'] for r in requirements if r['question']]
            if not requirements:
                questions.append('未提取到明确要求，请人工核对岗位正文')
            status = 'needs_info' if unknown or not requirements else 'has_gaps' if gaps else 'matched'
            results.append({**item, **analysis, 'matches': matches, 'gaps': gaps,
                            'questions': questions, 'status': status})
        except Exception as exc:
            code = str(exc) if isinstance(exc, WorkflowError) and str(exc) in ERRORS else 'ANALYSIS_FAILED'
            results.append({**item, 'status': 'failed', 'error': code, 'error_detail': error_info(code)})
            if code in BLOCKING_MODEL_ERRORS:
                blocked = code
        elapsed = round(time.monotonic() - item_started, 3)
        results[-1]['elapsed_seconds'] = elapsed
        if progress:
            progress({**event, 'phase': 'end', 'status': results[-1]['status'], 'elapsed_seconds': elapsed,
                      'error': results[-1].get('error', '')})
    failures = sum(item['status'] == 'failed' for item in results)
    if failures:
        status = 'failed' if failures == len(results) else 'partial'
    elif any(item['status'] == 'deferred' for item in results):
        status = 'partial'
    elif (state['filtered']['needs_info'] or any(item['status'] == 'needs_info' for item in results)
          or not any('requirements' in item for item in results)):
        status = 'needs_info'
    else:
        status = 'completed'
    summary = {s: sum(item['status'] == s for item in results) for s in ('needs_info', 'failed', 'deferred', 'skipped')}
    summary['needs_info'] += len(state['filtered']['needs_info'])
    summary['analyzed'] = sum('requirements' in item for item in results)
    summary.update({k: state['filtered']['counts'][k] for k in ('other_city', 'duplicates')})
    return {'results': results, 'calls': calls, 'status': status, 'summary': summary,
            'elapsed_seconds': round(time.monotonic() - started, 3)}


def save_analysis(state: AnalysisState):
    report = {'status': state['status'], 'model_calls': state['calls'],
              'mode': state.get('mode', 'learning'), 'model': state.get('model', ''),
              'elapsed_seconds': state.get('elapsed_seconds', 0), 'summary': state.get('summary', {}),
              'counts': state['filtered']['counts'], 'results': state['results'],
              'unknown_city': [job_metadata(j) for j in state['filtered']['needs_info']],
              'review_required': True}
    lines = ['# 第三周：岗位要求与简历证据', '', f"状态：{state['status']}；模型请求次数：{state['calls']}",
             f"模式：{report['mode']}；模型：{report['model']}；分析耗时：{report['elapsed_seconds']} 秒",
             f"汇总（已分析与信息不足可能交叉）：{json.dumps(report['summary'], ensure_ascii=False)}",
             '', '原文引用已程序校验；引用是否支持结论、要求是否遗漏，仍需人工复核。']
    for item in state['results']:
        lines += ['', f"## {item['title']} / {item['company'] or '公司未知'}", '',
                  f"状态：{item['status']}；城市：{item['city']}；薪资：{item['salary'] or '未知'}；链接：{item['url'] or '未提供'}"]
        if 'capturedAt' in item:
            lines += [f"采集时间：{item['capturedAt'] or '未提供'}；正文类型：{item['description_kind'] or '未提供'}；招聘状态：{item['listing_status']}"]
            if item['listing_status'] == 'unverified':
                lines.append('待确认：是否仍在招聘；页面可读不代表仍在招。')
        if not item['salary']:
            lines.append('待确认：薪资未提供。')
        if 'elapsed_seconds' in item:
            lines.append(f"本项耗时：{item['elapsed_seconds']} 秒")
        for r in item.get('requirements', []):
            lines += [f"- {r['requirement']}：{r['status']}", f"  - JD原文：{r['job_quote']}",
                      f"  - 简历原文：{r['resume_quote'] or '暂无证据'}", f"  - 原因：{r['reason']}"]
        for q in item.get('questions', []):
            lines.append(f'- 待确认：{q}')
        if item.get('error'):
            lines.append('- 错误：' + item['error'])
            if item.get('error_detail'):
                lines.append('- 处理建议：' + item['error_detail']['message'])
        if item.get('reason'):
            lines.append('- 说明：' + item['reason'])
    lines += ['', '## 城市待确认（未调用模型）', '']
    for j in report['unknown_city']:
        lines += [f"- {j['title']} / {j['company'] or '公司未知'}；链接：{j['url'] or '未提供'}",
                  f"  - 采集时间：{j.get('capturedAt', '未提供')}；正文类型：{j.get('description_kind', '未提供')}；招聘状态：{j.get('listing_status', 'unverified')}"]
        lines += [f'  - 待确认：{issue}' for issue in j.get('issues', ['请确认城市'])]
    if not report['unknown_city']:
        lines.append('无')
    directory = Path(state['root']) / 'output/jobpilot/week3' / uuid4().hex
    directory.mkdir(parents=True, exist_ok=False)
    path = directory / 'report.json'
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    path.with_suffix('.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    return {'report_path': str(path)}


def build_analysis_graph(analyzer, *, job_reader=read_jobs, progress=None):
    graph = StateGraph(AnalysisState)
    graph.add_node('load_inputs', lambda state: load_inputs(state, job_reader=job_reader))
    graph.add_node('analyze_jobs', lambda state: analyze_batch(state, analyzer, progress=progress))
    graph.add_node('save_report', save_analysis)
    graph.add_edge(START, 'load_inputs')
    graph.add_conditional_edges('load_inputs', lambda s: 'stop' if s.get('error') else 'analyze',
                                {'stop': END, 'analyze': 'analyze_jobs'})
    graph.add_edge('analyze_jobs', 'save_report')
    graph.add_edge('save_report', END)
    return graph.compile()


def run_model_learning(argv, root):
    from .practice import stream_analysis, print_progress, print_model_error
    parser = argparse.ArgumentParser(description='第三周：真实模型提取岗位要求并核对简历证据，会产生API费用')
    parser.add_argument('--resume', type=Path, default=Path('examples/jobpilot/resume.txt'))
    parser.add_argument('--jobs', type=Path, default=Path('examples/jobpilot/jobs.json'))
    parser.add_argument('--city', default='深圳')
    parser.add_argument('--limit', type=int, default=1, choices=range(1, 11))
    args = parser.parse_args(argv)
    if not args.city.strip():
        parser.error('城市不能为空')
    root = Path(root)
    print('学习模式：输入来源取决于 --resume 和 --jobs，不代表已经搜索招聘网站。', flush=True)
    for label, path in [('简历', args.resume), ('岗位', args.jobs)]:
        full = (root / path).resolve()
        kind = '内置样例' if full.is_relative_to((root / 'examples').resolve()) else '指定文件'
        print(f'{label}：{kind} {full}', flush=True)
    print('网络操作超时 45 秒，无自动重试。', flush=True)
    try:
        config, _ = load_model_config(root)
        analyzer = create_analyzer(config)
        initial = {'root': str(root), 'source': str(Path(root) / args.jobs),
                   'resume_path': str(Path(root) / args.resume), 'city': args.city.strip(), 'limit': args.limit,
                   'mode': 'learning', 'model': config['JOBPILOT_MODEL']}
        return stream_analysis(build_analysis_graph(analyzer, progress=print_progress), initial)
    except WorkflowError as exc:
        print_model_error(str(exc))
        return 1
    except OSError:
        print('INPUT_OR_REPORT_IO_FAILED', file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print('用户已中断；本阶段不保证中断后的报告保存。', file=sys.stderr)
        return 130
