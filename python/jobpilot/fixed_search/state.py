"""State 是节点共同使用的进度表；字段不是网页操作本身。"""
from typing import TypedDict

KEYWORD = "Java全栈开发工程师"
CITY = "current"  # 沿用页面当前城市，不约束为某个城市。
BANDS = ("exp_1_3", "exp_3_5")
MAX_CONTACTS = 150


class FixedSearchState(TypedDict, total=False):
    batch_id: str
    mode: str
    status: str
    stop_reason: str
    band_index: int
    candidates: list[dict]
    current_job: dict | None
    detail: dict
    attempt_id: str | None
    chat: dict
    view: dict
    seen_job_keys: list[str]
    advances: int
    no_new: int
    advancing: bool
    exhausted: bool
    step: int
    route: str
    report: dict
