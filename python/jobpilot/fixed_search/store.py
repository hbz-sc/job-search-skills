"""外部动作账本：额度、去重、原请求；与 LangGraph checkpoint 分工不同。"""
import json
import re
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4
from ..errors import WorkflowError
from ..ledger import Ledger, now
from .state import KEYWORD, CITY, BANDS, MAX_CONTACTS

TERMINAL = ("confirmed", "failed", "skipped", "deferred")


class BatchStore(Ledger):
    def __init__(self, path, batch_id=None, mode="run", max_contacts=150):
        if batch_id is None and (mode not in {"run", "preview"} or type(max_contacts) is not int or not 1 <= max_contacts <= MAX_CONTACTS):
            raise WorkflowError("INVALID_CONTACT_LIMIT")
        if batch_id is not None:
            if not isinstance(batch_id, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", batch_id):
                raise WorkflowError("INVALID_BATCH_ID")
            self.path, self.run_id = Path(path), batch_id
            if not self.path.is_file():
                raise WorkflowError("BATCH_NOT_FOUND")
            self.db = sqlite3.connect(self.path, isolation_level=None, timeout=5)
            self.db.row_factory = sqlite3.Row
            self.db.execute("PRAGMA foreign_keys=ON")
            try:
                self.mode = self.batch()["config"]["mode"]
            except Exception:
                self.db.close()
                raise
            return
        super().__init__(path, mode)
        self.db.executescript("""
          CREATE TABLE IF NOT EXISTS fixed_batches(
            id TEXT PRIMARY KEY REFERENCES page_runs(id), config TEXT NOT NULL,
            status TEXT NOT NULL, stop_reason TEXT NOT NULL DEFAULT '',
            binding TEXT, template TEXT, updated_at TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS fixed_effects(
            batch_id TEXT NOT NULL REFERENCES fixed_batches(id), op_key TEXT NOT NULL,
            tool TEXT NOT NULL, payload TEXT NOT NULL, request_id TEXT NOT NULL UNIQUE,
            value TEXT, PRIMARY KEY(batch_id,op_key));
          CREATE TABLE IF NOT EXISTS fixed_events(
            batch_id TEXT NOT NULL, event_key TEXT NOT NULL, value TEXT NOT NULL,
            PRIMARY KEY(batch_id,event_key));
        """)
        config = {"mode": mode, "keyword": KEYWORD, "city": CITY, "experience_bands": list(BANDS),
                  "max_contacts": max_contacts if mode == "run" else 0}
        self.db.execute("INSERT INTO fixed_batches(id,config,status,updated_at) VALUES(?,?,'ready',?)", (self.run_id, json.dumps(config, ensure_ascii=False), now()))
        self.db.execute("UPDATE page_runs SET scope=? WHERE id=?", (json.dumps({"mode": "batch" if mode == "run" else "search_only", "maxContacts": config["max_contacts"]}), self.run_id))

    def batch(self):
        if not self.table_exists("fixed_batches"):
            raise WorkflowError("BATCH_NOT_FOUND")
        row = self.db.execute("SELECT * FROM fixed_batches WHERE id=?", (self.run_id,)).fetchone()
        if row is None:
            raise WorkflowError("BATCH_NOT_FOUND")
        value = dict(row)
        for key in ("config", "binding", "template"):
            value[key] = json.loads(value[key]) if value[key] else None
        return value

    def set_status(self, status, reason=""):
        self.db.execute("UPDATE fixed_batches SET status=?,stop_reason=?,updated_at=? WHERE id=?", (status, reason, now(), self.run_id))

    def pin(self, *, binding=None, template=None):
        if binding is not None:
            self.db.execute("UPDATE fixed_batches SET binding=? WHERE id=?", (json.dumps(binding), self.run_id))
        if template is not None:
            self.db.execute("UPDATE fixed_batches SET template=? WHERE id=?", (json.dumps(template, ensure_ascii=False), self.run_id))

    def check_blockers(self, exclude_attempt=None):
        # 历史额度保留；过期记录不证明当前额度，工具仍须核验当前网页。
        today = datetime.now(timezone(timedelta(hours=8))).date()
        for table in ("page_stops", "account_stops"):
            if self.table_exists(table):
                for row in self.db.execute(f"SELECT * FROM {table}"):
                    data = dict(row)
                    stamp = data.get("createdAt", data.get("created_at", ""))
                    try:
                        date = datetime.fromisoformat(stamp.replace("Z", "+00:00")).astimezone(timezone(timedelta(hours=8))).date()
                    except (ValueError, AttributeError):
                        raise WorkflowError("QUOTA_DATE_UNVERIFIED") from None
                    if str(data.get("reason", "")).upper() not in {"QUOTA", "QUOTA_REACHED"} or date >= today:
                        raise WorkflowError("QUOTA_REACHED")
        if self.db.execute("SELECT 1 FROM page_attempts WHERE phase NOT IN ('confirmed','failed','skipped','deferred') AND id<>? LIMIT 1", (exclude_attempt or "",)).fetchone():
            raise WorkflowError("UNRESOLVED_CONTACT")
        if self.table_exists("attempts") and self.db.execute("SELECT 1 FROM attempts WHERE phase IN ('opening','chat_open','sending','unconfirmed','uncertain') LIMIT 1").fetchone():
            raise WorkflowError("LEGACY_UNRESOLVED_CONTACT")

    def reserve(self, job):
        if self.mode != "run":
            raise WorkflowError("SEND_NOT_AUTHORIZED")
        self.db.execute("BEGIN IMMEDIATE")
        try:
            prior = self.db.execute("SELECT id FROM page_attempts WHERE jobKey=? AND runId=?", (job["key"], self.run_id)).fetchone()
            if prior:
                self.db.commit()
                return prior["id"]
            self.check_blockers()
            if self.should_skip(job["key"]):
                self.db.commit()
                return None
            used = self.db.execute("SELECT count(*) FROM page_attempts WHERE runId=?", (self.run_id,)).fetchone()[0]
            if used >= self.batch()["config"]["max_contacts"]:
                raise WorkflowError("CONTACT_LIMIT")
            attempt = str(uuid4())
            self.db.execute("INSERT INTO page_attempts(id,runId,jobKey,job,phase,updatedAt) VALUES(?,?,?,?,?,?)", (attempt, self.run_id, job["key"], json.dumps(job, ensure_ascii=False), "opening", now()))
            self.db.commit()
            return attempt
        except BaseException:
            self.db.rollback()
            raise

    def attempt(self, attempt_id):
        row = self.db.execute("SELECT * FROM page_attempts WHERE id=? AND runId=?", (attempt_id, self.run_id)).fetchone()
        if not row:
            raise WorkflowError("ATTEMPT_NOT_FOUND")
        return {**dict(row), "job": json.loads(row["job"])}

    def pending(self):
        rows = self.db.execute("SELECT id FROM page_attempts WHERE runId=? AND phase NOT IN ('confirmed','failed','skipped','deferred')", (self.run_id,)).fetchall()
        return [self.attempt(row["id"]) for row in rows]

    def finish(self, attempt, phase, evidence):
        if phase not in (*TERMINAL, "opening", "chat_open", "sending", "uncertain"):
            raise WorkflowError("INVALID_PHASE")
        previous = self.attempt(attempt)
        # checkpoint 回放不能把 confirmed 退回 sending。
        if previous["phase"] in TERMINAL:
            return
        self.db.execute("UPDATE page_attempts SET phase=?,evidence=?,updatedAt=? WHERE id=? AND runId=?", (phase, json.dumps(evidence, ensure_ascii=False), now(), attempt, self.run_id))

    def event(self, key, value):
        self.db.execute("INSERT OR IGNORE INTO fixed_events VALUES(?,?,?)", (self.run_id, key, json.dumps(value, ensure_ascii=False)))

    def effect(self, key, tool, payload):
        encoded = json.dumps(payload, sort_keys=True, ensure_ascii=False)
        request_id = str(uuid4())
        inserted = self.db.execute("INSERT OR IGNORE INTO fixed_effects(batch_id,op_key,tool,payload,request_id) VALUES(?,?,?,?,?)", (self.run_id, key, tool, encoded, request_id)).rowcount
        row = dict(self.db.execute("SELECT * FROM fixed_effects WHERE batch_id=? AND op_key=?", (self.run_id, key)).fetchone())
        if row["tool"] != tool or row["payload"] != encoded:
            raise WorkflowError("ACTION_CONFLICT")
        row["value"] = json.loads(row["value"]) if row["value"] is not None else None
        return row, bool(inserted)

    def observed(self, key, value):
        self.db.execute("UPDATE fixed_effects SET value=? WHERE batch_id=? AND op_key=?", (json.dumps(value, ensure_ascii=False), self.run_id, key))

    def summary(self):
        batch = self.batch()
        phases = dict(self.db.execute("SELECT phase,count(*) FROM page_attempts WHERE runId=? GROUP BY phase", (self.run_id,)))
        events = [json.loads(r[0]) for r in self.db.execute("SELECT value FROM fixed_events WHERE batch_id=?", (self.run_id,))]
        attempts = [{"job": json.loads(r["job"]), "phase": r["phase"], "attempt_id": r["id"], "evidence": json.loads(r["evidence"]) if r["evidence"] else None} for r in self.db.execute("SELECT * FROM page_attempts WHERE runId=? ORDER BY rowid", (self.run_id,))]
        return {"batch_id": self.run_id, **batch["config"], "status": batch["status"], "stop_reason": batch["stop_reason"],
                "used_contacts": sum(phases.values()), "confirmed_count": phases.get("confirmed", 0), "failed_count": phases.get("failed", 0),
                "uncertain_count": sum(n for p, n in phases.items() if p not in TERMINAL),
                "skipped_count": sum(e.get("status") == "skipped" for e in events) + phases.get("skipped", 0),
                "observed_cities": sorted({e["city"] for e in events if e.get("status") == "city_observed"}),
                "attempts": attempts, "events": events}

    @classmethod
    def read_summary(cls, path, batch_id):
        if not Path(path).is_file():
            raise WorkflowError("BATCH_NOT_FOUND")
        obj = cls.__new__(cls)
        obj.path, obj.run_id = Path(path), batch_id
        obj.db = sqlite3.connect(Path(path).resolve().as_uri() + "?mode=ro", uri=True)
        obj.db.row_factory = sqlite3.Row
        try:
            return obj.summary()
        finally:
            obj.db.close()
