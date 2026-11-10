"""Python直接调用现有MCP桥；不启动Node、不操作任意URL/脚本。"""
import asyncio
import hashlib
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4
import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from .errors import WorkflowError


def checked_binding(value):
    if not isinstance(value, dict) or set(value) != {"sessionId", "tabId", "frameId", "documentId"} or type(value.get("tabId")) is not int or value["tabId"] < 0 or value.get("frameId") != 0 or not all(isinstance(value.get(k), str) and value[k] for k in ("sessionId", "documentId")):
        raise WorkflowError("INVALID_BINDING")
    return dict(value)


class BossBridge:
    schema_file = "boss-search-v3.schema.json"
    capability_field = "searchVersion"
    hash_field = "searchSchemaHash"
    def __init__(self, binding, transport, ledger=None):
        self.binding, self.transport, self.ledger = checked_binding(binding), transport, ledger
        self.run_id, self.lease_id = str(uuid4()), str(uuid4())
        self.started = False

    @classmethod
    def connect(cls, root, ledger):
        root = Path(root)
        try:
            d = json.loads((root / "private/boss-extension/discovery.json").read_text(encoding="utf-8"))
            if d.get("protocolVersion") != 1 or type(d.get("port")) is not int or not 1 <= d["port"] <= 65535 or not isinstance(d.get("token"), str) or len(d["token"]) < 32 or not isinstance(d.get("sessionId"), str):
                raise ValueError()
            base = f"http://127.0.0.1:{d['port']}"
            headers = {"Authorization": "Bearer " + d["token"], "X-Boss-Session": d["sessionId"]}
            with httpx.Client(timeout=5, trust_env=False, follow_redirects=False) as client:
                response = client.get(base + "/health", headers=headers)
                response.raise_for_status()
                health = response.json()
        except Exception:
            raise WorkflowError("BOSS_NOT_CONNECTED") from None
        expected = hashlib.sha256((root / "contracts" / cls.schema_file).read_bytes()).hexdigest()
        if health.get("sessionId") != d["sessionId"] or health.get("protocolVersion") != 1 or health.get("writeEnabled") is not False or health.get(cls.capability_field) != 1 or health.get(cls.hash_field) != expected:
            raise WorkflowError("BRIDGE_CONTRACT_MISMATCH")

        async def call_async(tool, args):
            async with asyncio.timeout(25):
                async with httpx.AsyncClient(headers=headers, timeout=25, trust_env=False, follow_redirects=False) as client:
                    async with streamable_http_client(base + "/mcp", http_client=client) as (read, write, _):
                        async with ClientSession(read, write) as session:
                            await session.initialize()
                            result = await session.call_tool(tool, args, read_timeout_seconds=timedelta(seconds=23))
                            if result.isError:
                                raise WorkflowError("MCP_CALL_FAILED")
                            if result.structuredContent is not None:
                                return result.structuredContent
                            return json.loads(next(c.text for c in result.content if c.type == "text"))

        return cls(health.get("binding"), lambda tool, args: asyncio.run(call_async(tool, args)), ledger)

    def _execute(self, tool, payload, version=3, *, request_id=None):
        request_id = request_id or str(uuid4())
        self.last_request_id = request_id
        context = {"runId": self.run_id, "requestId": request_id, "binding": self.binding,
                   "deadline": (datetime.now(timezone.utc) + timedelta(seconds=20)).isoformat()}
        if version in {3, 4}:
            context["leaseId"] = self.lease_id
        command = {"version": version, "tool": tool, "context": context, "payload": payload}
        if self.ledger:
            self.ledger.before_action(command)  # 派发前保存意图和原requestId
        try:
            result = self.transport("inspect_session" if version == 1 else "execute_action", {"command": command})
        except Exception:
            try:
                result = self.transport("get_action_result", {"requestId": request_id})
            except Exception:
                result = {"requestId": request_id, "phase": "uncertain"}
        return self._read_result(request_id, result)

    def _read_result(self, request_id, result, *, adopt=True):
        if not isinstance(result, dict) or result.get("requestId") != request_id:
            raise WorkflowError("RESULT_ID_MISMATCH")
        if self.ledger:
            self.ledger.after_action(request_id, result)
        if result.get("phase") != "observed":
            code = result.get("error", {}).get("code")
            known = {"MANUAL_EXPERIENCE_REQUIRED", "LOGIN_REQUIRED", "VERIFICATION_REQUIRED", "QUOTA_REACHED", "FILTER_UNVERIFIED", "JOB_EXPERIENCE_CHANGED", "CONTACT_LIMIT", "CITY_MISMATCH"}
            if result.get("phase") == "rejected" and code == "INVALID_SCOPE":
                raise WorkflowError("INVALID_SCOPE")
            diagnostic = isinstance(code, str) and re.fullmatch(r"(?:EXPERIENCE_|DEBUGGER_|POSTCONDITION_TIMEOUT:)[A-Z_:]+", code)
            raise WorkflowError(code if code in known or diagnostic else "ACTION_UNKNOWN")
        value = result.get("value")
        binding = checked_binding(value.get("binding") if isinstance(value, dict) else None)
        if binding["sessionId"] != self.binding["sessionId"]:
            raise WorkflowError("SESSION_CHANGED")
        if adopt:
            self.binding = binding
        return value

    def recover(self, request_id):
        """仅查询原动作；绝不重新发送 execute_action，也不采用旧文档绑定。"""
        try:
            result = self.transport("get_action_result", {"requestId": request_id})
        except Exception:
            raise WorkflowError("ACTION_UNKNOWN") from None
        return self._read_result(request_id, result, adopt=False)

    def inspect(self):
        return self._execute("inspect_session", {}, 1)

    def start(self, roles, mode, phrase_hash=None, *, batch_id=None, max_contacts=None, experience_mode=None, city="深圳"):
        if self.started:
            self.close()
            self.run_id, self.lease_id = str(uuid4()), str(uuid4())
        scope = {"mode": "run" if mode == "run" else "preview", "batchId": batch_id or self.run_id,
                 "planHash": hashlib.sha256(json.dumps(roles).encode()).hexdigest(),
                 "allowedKeywords": roles, "city": city, "experienceBands": ["exp_1_3", "exp_3_5"],
                 "maxContacts": (1 if max_contacts is None else max_contacts) if mode == "run" else 0, "expectedPhraseHash": phrase_hash}
        if experience_mode is not None:
            scope["experienceMode"] = experience_mode
        self._execute("start_run", scope)
        self.started = True

    def action(self, tool, payload, *, request_id=None):
        if not self.started:
            raise WorkflowError("RUN_NOT_STARTED")
        self._execute("renew_run", {})
        return self._execute(tool, payload, request_id=request_id)

    def close(self):
        try:
            self.transport("stop_run", {"runId": self.run_id})
        except Exception:
            pass  # 关闭错误不能引发重新派发；服务端租约仍会过期。
