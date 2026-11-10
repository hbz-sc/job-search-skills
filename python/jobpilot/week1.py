"""第一周：只用 Python 标准库处理岗位，不调用模型或浏览器。

阅读顺序：read_jobs → filter_jobs → write_report → run_learning。
这些函数以后可以包装成 LangGraph 节点；当前流程由普通函数调用驱动。
"""
import argparse
import json
import sys
from pathlib import Path
from uuid import uuid4


def text_field(row, name):
    """输入边界：缺字段允许留空，类型错误必须指出，不能当作正常数据。"""
    value = row.get(name, "")
    if not isinstance(value, str):
        raise ValueError(f"字段 {name} 必须是字符串")
    return value.strip()


def read_jobs(path):
    """读取两种格式：旧样例 summaries/details，或 preview 的 jobs 列表。"""
    payload = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    if not isinstance(payload, dict):
        raise ValueError("JSON 顶层必须是对象")
    rows = payload.get("jobs", payload.get("summaries"))
    if not isinstance(rows, list):
        raise ValueError("需要 jobs 或 summaries 数组")
    details = payload.get("details", [])
    if not isinstance(details, list):
        raise ValueError("details 必须是数组")
    descriptions = {}
    for detail in details:
        if not isinstance(detail, dict):
            raise ValueError("details 中每项必须是对象")
        job_id = text_field(detail, "jobId")
        if not job_id or job_id in descriptions:
            raise ValueError("详情 jobId 不能为空或重复")
        descriptions[job_id] = text_field(detail, "description")

    jobs = []
    for number, row in enumerate(rows, start=1):
        if not isinstance(row, dict):
            raise ValueError(f"第 {number} 项岗位必须是对象")
        title = text_field(row, "title")
        if not title:
            raise ValueError(f"第 {number} 项岗位缺少 title")
        query = row.get("query", {})
        if not isinstance(query, dict):
            raise ValueError(f"第 {number} 项 query 必须是对象")
        job_id = text_field(row, "jobId") or text_field(row, "key")
        url = text_field(row, "url")
        city = text_field(row, "city") or text_field(query, "city")
        description = text_field(row, "description") or descriptions.get(job_id, "")
        jobs.append({
            "jobId": job_id, "url": url, "title": title,
            "company": text_field(row, "company"), "city": city,
            "salary": text_field(row, "salary"), "description": description,
            "missing_description": not bool(description),
            "missing_identity": not bool(url or job_id),
        })
    return jobs


def filter_jobs(jobs, city):
    """业务边界：城市完全匹配；未知城市单列；缺正文不等于不匹配。"""
    matched, needs_info = [], []
    seen = set()
    counts = {"input": len(jobs), "matched": 0, "duplicates": 0,
              "other_city": 0, "unknown_city": 0}
    for job in jobs:
        # 有链接按完整链接判重；否则用 ID。同名岗位不能直接当成同一岗位。
        if job["url"]:
            identity = ("url", job["url"])
        elif job["jobId"]:
            identity = ("id", job["jobId"])
        else:
            identity = None
        if identity is not None and identity in seen:
            counts["duplicates"] += 1
            continue
        if identity is not None:
            seen.add(identity)
        if not job["city"]:
            needs_info.append(job)
            counts["unknown_city"] += 1
        elif job["city"] != city:
            counts["other_city"] += 1
        else:
            matched.append(job)
            counts["matched"] += 1
    return {"city": city, "counts": counts, "jobs": matched, "needs_info": needs_info}


def write_report(report, root):
    """文件边界：每次新建报告目录，不覆盖输入和真实投递记录。"""
    directory = Path(root) / "output/jobpilot/week1" / uuid4().hex
    directory.mkdir(parents=True, exist_ok=False)
    path = directory / "report.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = ["# 岗位筛选学习报告", "", f"目标城市：{report['city']}",
             "", "统计：" + json.dumps(report["counts"], ensure_ascii=False),
             "", "只做资料整理；不表示已匹配简历或已联系招聘方。"]
    for label, jobs in (("符合城市条件", report["jobs"]), ("城市待确认", report["needs_info"])):
        lines += ["", f"## {label}", ""]
        if not jobs:
            lines.append("无")
        for job in jobs:
            lines += [f"- {job['title']} / {job['company'] or '公司未知'} / {job['city'] or '城市未知'} / {job['salary'] or '薪资未知'}",
                      f"  - 链接：{job['url'] or '未提供'}；岗位 ID：{job['jobId'] or '未提供'}",
                      f"  - 正文：{'待补充' if job['missing_description'] else '已提供'}；判重身份：{'缺失，保留此条' if job['missing_identity'] else '已提供'}"]
    path.with_suffix(".md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def run_learning(argv, root):
    parser = argparse.ArgumentParser(description="第一周：离线读取、城市筛选、去重、生成报告")
    parser.add_argument("--jobs", type=Path, default=Path("examples/python/week1-jobs.json"))
    parser.add_argument("--city", default="深圳")
    args = parser.parse_args(argv)
    if not args.city.strip():
        parser.error("城市不能为空")
    try:
        # 状态：贯穿流程的普通字典。不是 LangGraph 自动维护的 State。
        state = {"source": str(Path(root) / args.jobs), "city": args.city.strip()}
        state["jobs"] = read_jobs(state["source"])
        print(f"[读取] {len(state['jobs'])} 条岗位")
        state["report"] = filter_jobs(state["jobs"], state["city"])
        print("[筛选与去重]", json.dumps(state["report"]["counts"], ensure_ascii=False))
        path = write_report(state["report"], root)
        print("[报告]", path)
        print("[阅读版]", path.with_suffix(".md"))
        return 0
    except (OSError, ValueError) as exc:
        print(f"学习流程失败：{exc}", file=sys.stderr)
        return 1
