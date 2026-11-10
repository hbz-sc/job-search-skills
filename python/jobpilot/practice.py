"""实战命令：连接诊断与真实文件分析，不调用招聘网站工具。"""
import argparse
import sys
from pathlib import Path
from .errors import WorkflowError
from .model_connection import load_model_config, validate_model_config, check_model, error_info
from .practice_inputs import read_practice_jobs
from .week3 import build_analysis_graph
from .week3_model import create_analyzer


def print_model_error(code):
    info = error_info(code)
    print(f"{info['code']}：{info['message']}", file=sys.stderr, flush=True)


def print_progress(event):
    if event['phase'] == 'start':
        print(f"正在分析 {event['index']}/{event['total']}：{event['title']}；请求 {event['calls']}/{event['limit']}", flush=True)
    else:
        print(f"本项结果：{event['status']}；耗时 {event['elapsed_seconds']:.3f} 秒", flush=True)
        if event.get('error'):
            print_model_error(event['error'])


def stream_analysis(graph, initial):
    status, has_report = 'failed', False
    for event in graph.stream(initial, stream_mode='updates'):
        for node, update in event.items():
            if update.get('error'):
                print(f"[{node}] 输入失败：{update['error']}", file=sys.stderr, flush=True)
                return 1
            print(f'[{node}] 执行结束', flush=True)
            status = update.get('status', status)
            if 'summary' in update:
                counts = update['summary']
                print(f"已分析 {counts['analyzed']}；信息不足 {counts['needs_info']}；失败 {counts['failed']}；"
                      f"未执行 {counts['deferred']}；已关闭 {counts['skipped']}；分析耗时 {update['elapsed_seconds']:.3f} 秒", flush=True)
                print('已分析与信息不足可能交叉；请查看逐项结果。', flush=True)
            if 'report_path' in update:
                has_report = True
                print('状态：', status, flush=True)
                print('[报告]', update['report_path'], flush=True)
                print('[阅读版]', Path(update['report_path']).with_suffix('.md'), flush=True)
    return 0 if has_report and status in {'completed', 'needs_info'} else 1


def run_check_model(argv: list[str], root: Path) -> int:
    parser = argparse.ArgumentParser(description='用一次小型请求诊断模型连接，可能产生 API 费用；不发送简历或岗位资料')
    parser.parse_args(argv)
    try:
        config, sources = load_model_config(root)
        for field, source in sources.items():
            print(f'{field}：{"已配置" if config[field] else "未配置"}；来源 {source}', flush=True)
        config = validate_model_config(config)
        print('模型：', config['JOBPILOT_MODEL'], flush=True)
        print('接口：', config['JOBPILOT_BASE_URL'], flush=True)
        print('即将发起 1 次模型诊断请求，可能产生 API 费用；网络操作超时 45 秒，无自动重试。', flush=True)
        result = check_model(config)
        print('模型诊断成功；请求次数：', result['model_calls'], flush=True)
        return 0
    except WorkflowError as exc:
        print_model_error(str(exc))
        return 1
    except (OSError, UnicodeError):
        print('配置文件读取失败，请检查本地 .env。', file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print('用户已中断；本次诊断未完成。', file=sys.stderr)
        return 130


def run_practice(argv: list[str], root: Path) -> int:
    parser = argparse.ArgumentParser(description='实战：真实简历与有来源的完整岗位正文分析，按实际请求产生 API 费用')
    parser.add_argument('--resume', type=Path, required=True)
    parser.add_argument('--jobs', type=Path, required=True)
    parser.add_argument('--city', default='深圳')
    parser.add_argument('--limit', type=int, choices=range(1, 11), default=1)
    args = parser.parse_args(argv)
    if not args.city.strip():
        parser.error('城市不能为空')
    root = Path(root)
    print(f'实战模式；简历：{root / args.resume}；岗位：{root / args.jobs}', flush=True)
    print(f'城市：{args.city.strip()}；模型调用上限：{args.limit}；网络操作超时 45 秒，无自动重试。', flush=True)
    try:
        config, _ = load_model_config(root)
        config = validate_model_config(config)
        analyzer = create_analyzer(config)
        graph = build_analysis_graph(analyzer, job_reader=read_practice_jobs, progress=print_progress)
        initial = {'root': str(root), 'source': str(root / args.jobs), 'resume_path': str(root / args.resume),
                   'city': args.city.strip(), 'limit': args.limit, 'mode': 'practice', 'model': config['JOBPILOT_MODEL']}
        return stream_analysis(graph, initial)
    except WorkflowError as exc:
        print_model_error(str(exc))
        return 1
    except (OSError, UnicodeError):
        print('INPUT_OR_REPORT_IO_FAILED：输入或报告文件读写失败。', file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print('用户已中断；本阶段不保证中断后的报告保存或断点续跑。', file=sys.stderr)
        return 130
