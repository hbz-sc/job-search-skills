"""业务账本：复用旧项目去重记录。它不是LangGraph checkpoint。"""
import csv
import hashlib
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4
from .errors import WorkflowError


def now():
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def run_lock(path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if (path.parent / "boss-run.lock").exists():
        raise WorkflowError("LEGACY_RUN_LOCK_PRESENT")
    db = sqlite3.connect(path, timeout=0)
    try:
        try:
            db.execute("BEGIN IMMEDIATE")  # 与TS入口使用同一SQLite锁
        except sqlite3.Error:
            raise WorkflowError("ANOTHER_RUN_ACTIVE") from None
        yield
    finally:
        db.rollback()
        db.close()


class Ledger:
    def __init__(self, path, mode):
        if mode not in {"demo", "preview", "run"}:
            raise WorkflowError("INVALID_MODE")
        self.path, self.mode, self.run_id = Path(path), mode, str(uuid4())
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.path, timeout=5, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.executescript("""
          CREATE TABLE IF NOT EXISTS page_runs(id TEXT PRIMARY KEY,scope TEXT NOT NULL,createdAt TEXT NOT NULL,summary TEXT);
          CREATE TABLE IF NOT EXISTS page_attempts(id TEXT PRIMARY KEY,runId TEXT NOT NULL REFERENCES page_runs(id),jobKey TEXT NOT NULL UNIQUE,job TEXT NOT NULL,conversationKey TEXT,phrase TEXT,phase TEXT NOT NULL,evidence TEXT,updatedAt TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS page_stops(reason TEXT PRIMARY KEY,evidence TEXT NOT NULL,createdAt TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS python_reports(id TEXT PRIMARY KEY,created_at TEXT NOT NULL,value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS python_actions(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,command TEXT NOT NULL,result TEXT);
        """)
        self.db.execute("INSERT INTO page_runs VALUES(?,?,?,NULL)", (self.run_id, json.dumps({"mode": "search_only" if mode == "preview" else "greet_once", "maxContacts": 0 if mode == "preview" else 1}), now()))

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.db.close()

    def table_exists(self, table):
        return self.db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone() is not None

    def should_skip(self, key):
        if self.db.execute("SELECT 1 FROM page_attempts WHERE jobKey=?", (key,)).fetchone():
            return True
        if self.table_exists("attempts") and self.db.execute("SELECT 1 FROM attempts WHERE jobKey=?", (key,)).fetchone():
            return True
        for filename in ("jobs.csv", "conversations.csv"):
            path = self.path.parent / filename
            if path.exists():
                with path.open(encoding="utf-8-sig", newline="") as stream:
                    for row in csv.DictReader(stream):
                        if row.get("status") in {"user_sent_greeting", "resume_sent", "awaiting_reply"} and (row.get("job_id", "").strip() == key or row.get("source_url", "").split("?")[0].split("#")[0] == f"https://www.zhipin.com/job_detail/{key}.html"):
                            return True
        return False

    def check_blockers(self):
        if self.db.execute("SELECT 1 FROM page_stops LIMIT 1").fetchone():
            raise WorkflowError("ACCOUNT_STOPPED")
        if self.table_exists("account_stops") and self.db.execute("SELECT 1 FROM account_stops LIMIT 1").fetchone():
            raise WorkflowError("ACCOUNT_STOPPED")
        if self.db.execute("SELECT 1 FROM page_attempts WHERE phase NOT IN ('confirmed','failed','skipped','deferred') LIMIT 1").fetchone():
            raise WorkflowError("UNRESOLVED_CONTACT")
        if self.table_exists("attempts") and self.db.execute("SELECT 1 FROM attempts WHERE phase IN ('opening','chat_open','sending','unconfirmed') LIMIT 1").fetchone():
            raise WorkflowError("LEGACY_UNRESOLVED_CONTACT")

    def reserve(self, job):
        if self.mode not in {"run", "demo"}:
            raise WorkflowError("SEND_NOT_AUTHORIZED")
        self.db.execute("BEGIN IMMEDIATE")
        try:
            self.check_blockers()
            if self.should_skip(job["key"]):
                raise WorkflowError("JOB_ALREADY_RECORDED")
            if self.db.execute("SELECT 1 FROM page_attempts WHERE runId=?", (self.run_id,)).fetchone():
                raise WorkflowError("CONTACT_LIMIT")
            attempt = str(uuid4())
            self.db.execute("INSERT INTO page_attempts(id,runId,jobKey,job,phase,updatedAt) VALUES(?,?,?,?,?,?)", (attempt, self.run_id, job["key"], json.dumps(job, ensure_ascii=False), "opening", now()))
            self.db.commit()
            return attempt
        except BaseException:
            self.db.rollback()
            raise

    def finish(self, attempt, phase, evidence):
        if phase not in {"confirmed", "failed", "uncertain", "chat_open", "sending"}:
            raise WorkflowError("INVALID_PHASE")
        self.db.execute("UPDATE page_attempts SET phase=?,evidence=?,updatedAt=? WHERE id=? AND runId=?", (phase, json.dumps(evidence, ensure_ascii=False), now(), attempt, self.run_id))

    def stop_quota(self):
        self.db.execute("INSERT OR REPLACE INTO page_stops VALUES('QUOTA_REACHED',?,?)", (json.dumps({"source": "python-live-page"}), now()))

    def load_template(self, template_id=None):
        if not self.table_exists("greeting_templates"):
            raise WorkflowError("SAVED_TEMPLATE_REQUIRED")
        rows = self.db.execute("SELECT value FROM greeting_templates WHERE id=?", (template_id,)).fetchall() if template_id else self.db.execute("SELECT value FROM greeting_templates ORDER BY rowid DESC").fetchall()
        for row in rows:
            template = json.loads(row[0])
            text = template.get("expectedText", "")
            if not template.get("source", "").startswith("user-selected-first:"):
                continue
            if not isinstance(text, str) or not text.strip() or template.get("normalizedHash") != hashlib.sha256(text.encode()).hexdigest():
                raise WorkflowError("TEMPLATE_CHANGED")
            return template
        raise WorkflowError("SAVED_TEMPLATE_REQUIRED")

    def before_action(self, command):
        self.db.execute("INSERT INTO python_actions VALUES(?,?,?,NULL)", (command["context"]["requestId"], self.run_id, json.dumps(command)))

    def after_action(self, request_id, result):
        self.db.execute("UPDATE python_actions SET result=? WHERE id=? AND run_id=?", (json.dumps(result, ensure_ascii=False), request_id, self.run_id))

    def save_report(self, report):
        report = {**report, "run_id": self.run_id}
        self.db.execute("INSERT OR REPLACE INTO python_reports VALUES(?,?,?)", (self.run_id, now(), json.dumps(report, ensure_ascii=False)))
        self.db.execute("UPDATE page_runs SET summary=? WHERE id=?", (json.dumps(report, ensure_ascii=False), self.run_id))
