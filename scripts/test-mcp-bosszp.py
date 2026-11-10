"""Read-only MCP smoke test. No login, browser access or BOSS HTTP requests."""
import asyncio
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
from datetime import timedelta

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "upstream/mcp-bosszp/boss_zhipin_fastmcp_v2.py"


def serve():
    import requests

    def reject_network(*args, **kwargs):
        raise RuntimeError("BOSS_NETWORK_DISABLED_IN_SMOKE_TEST")

    requests.Session.request = reject_network
    # Upstream creates ./static at import; keep it in a temporary directory.
    with tempfile.TemporaryDirectory(prefix="bosszp-smoke-") as directory:
        previous_directory = Path.cwd()
        try:
            os.chdir(directory)
            spec = importlib.util.spec_from_file_location("bosszp_smoke", SOURCE)
            module = importlib.util.module_from_spec(spec)
            sys.modules[spec.name] = module
            spec.loader.exec_module(module)
            module.mcp.run(transport="stdio", show_banner=False)
        finally:
            os.chdir(previous_directory)


async def test():
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client
    params = StdioServerParameters(
        command=sys.executable,
        args=[str(Path(__file__).resolve()), "--serve"],
        env={"PYTHONIOENCODING": "utf-8"},
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write, read_timeout_seconds=timedelta(seconds=20)) as client:
            init = await client.initialize()
            tools = (await client.list_tools()).tools
            schema = {t.name: sorted(t.inputSchema.get("properties", {})) for t in tools}
            assert "get_recommend_jobs_tool" in schema
            result = await client.call_tool("get_recommend_jobs_tool", {"page": 1})
            payload = json.loads(next(c.text for c in result.content if c.type == "text"))
            assert payload.get("error") == "未登录", "Unexpected unauthenticated response"
            return {
                "transport": "stdio (test wrapper; upstream defaults to HTTP)",
                "initialize": "passed",
                "server": init.serverInfo.name,
                "tool_count": len(tools),
                "tool_parameters": schema,
                "unauthenticated_recommendations": "login_required",
                "boss_http_requests": "disabled",
                "greeting_sent": False,
                "live_logged_in_flow": "not_tested",
            }


if __name__ == "__main__":
    if "--serve" in sys.argv:
        serve()
    else:
        report = asyncio.run(asyncio.wait_for(test(), timeout=40))
        destination = ROOT / "private/mcp-bosszp-test/result.json"
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(report, ensure_ascii=False, indent=2))
