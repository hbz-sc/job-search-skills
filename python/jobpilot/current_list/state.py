from typing import TypedDict


class CurrentListState(TypedDict, total=False):
    batch_id: str
    mode: str
    status: str
    stop_reason: str
    route: str
    step: int
    view: dict
    candidates: list[dict]
    seen_job_keys: list[str]
    current_job: dict | None
    attempt_id: str | None
    advances: int
    no_new: int
    exhausted: bool
    advancing: bool
    report: dict
