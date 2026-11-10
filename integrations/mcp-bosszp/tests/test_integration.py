import asyncio
from datetime import datetime,timedelta,timezone
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from fastmcp import Client
from fastmcp.client.transports import StreamableHttpTransport
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from boss_bridge.native import encode_native

class IntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_process_native_frames_mcp_response_and_eof_shutdown(self):
        root=Path(__file__).resolve().parents[3]
        with tempfile.TemporaryDirectory(prefix='boss bridge 测试 ') as td:
            process=await asyncio.create_subprocess_exec(sys.executable,'-m','boss_bridge.main','--root',td,cwd=root/'integrations/mcp-bosszp',stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE)
            async def read(timeout=12):
                header=await asyncio.wait_for(process.stdout.readexactly(4),timeout)
                return json.loads(await process.stdout.readexactly(struct.unpack('=I',header)[0]))
            try:
                ready=await read(45);self.assertEqual(ready['kind'],'ready')
                binding={'sessionId':'s','tabId':3,'frameId':0,'documentId':'d'}
                process.stdin.write(encode_native({'kind':'bind','binding':binding}));await process.stdin.drain()
                discovery=json.loads((Path(td)/'discovery.json').read_text())
                headers={'Authorization':'Bearer '+discovery['token'],'X-Boss-Session':discovery['sessionId']}
                async with Client(StreamableHttpTransport(f"http://127.0.0.1:{discovery['port']}/mcp",headers=headers)) as client:
                    tools=await client.list_tools();self.assertEqual({t.name for t in tools},{'inspect_session','execute_action','get_action_result','get_diagnostics','stop_run'})
                    c={'version':1,'tool':'inspect_session','context':{'runId':'r','requestId':'q','binding':binding,'deadline':(datetime.now(timezone.utc)+timedelta(seconds=8)).isoformat()},'payload':{}}
                    call=asyncio.create_task(client.call_tool('inspect_session',{'command':c}))
                    request=await read();self.assertEqual(request['command']['context']['requestId'],'q')
                    process.stdin.write(encode_native({'kind':'result','result':{'requestId':'q','phase':'observed','value':{'writeEnabled':False},'evidenceIds':[]}}));await process.stdin.drain()
                    result=await call;self.assertFalse(result.is_error)
                    self.assertEqual(result.data['phase'],'observed')
                process.stdin.close()
                self.assertEqual(await asyncio.wait_for(process.wait(),8),0)
                self.assertFalse((Path(td)/'discovery.json').exists())
                stderr=(await process.stderr.read()).decode(errors='replace')
                self.assertNotIn(discovery['token'],stderr)
            finally:
                if process.returncode is None:process.kill();await process.wait()
