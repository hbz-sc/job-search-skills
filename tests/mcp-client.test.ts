import {test,expect} from 'vitest';
import {HiddenStdioTransport} from '../src/mcp/stdio.js';
import {connectTransport,connectMcp} from '../src/mcp/client.js';
import {decodeToolResult} from '../src/mcp/result.js';
const signal=()=>new AbortController().signal;
const transport=()=>new HiddenStdioTransport(process.execPath,['tests/fixtures/mcp-server.mjs'],process.cwd());
test('stdio handshake, cancellation, tool allowlist and disconnect preserve ownership',async()=>{
 const p=await connectTransport(transport(),1500,signal());
 try{
  expect((await p.tools()).map(t=>t.name)).toContain('browser_snapshot');
  const c=new AbortController();c.abort();
  await expect(p.call('browser_snapshot',{},c.signal)).rejects.toThrow();
  await expect(p.call('browser_close',{},signal())).rejects.toThrow();
  await expect(p.call('browser_tabs',{action:'close'},signal())).rejects.toThrow();
  const r=decodeToolResult(await p.call('browser_run_code_unsafe',{code:'read'},signal())) as {calls:unknown[]};
  expect(r.calls).toHaveLength(1);
  const error=await p.call('browser_run_code_unsafe',{code:'error'},signal()).catch(e=>e);expect(error).toBeInstanceOf(Error);expect((error as Error).message).not.toMatch(/SECRET|MESSAGE_BODY/);
 }finally{await p.close();await p.close();}
 await expect(p.call('browser_snapshot',{},signal())).rejects.toThrow();
});
test('timed out write is called once and poisons session until reconnect',async()=>{
 const p=await connectTransport(transport(),120,signal());
 await expect(p.call('browser_run_code_unsafe',{code:'delay'},signal())).rejects.toThrow();
 await expect(p.call('browser_snapshot',{},signal())).rejects.toThrow(/closed|断开/);
 await p.close();
});
test('transport disconnect is surfaced without replay',async()=>{
 const p=await connectTransport(transport(),1500,signal());
 await expect(p.call('browser_run_code_unsafe',{code:'disconnect'},signal())).rejects.toThrow();await p.close();
});
test('decode only an explicit unique result envelope, not snapshot text',()=>{
 expect(decodeToolResult({content:[{type:'text',text:'### Result\n{"schemaVersion":1,"value":2}\n### Ran Playwright code\nignored'}]})).toEqual({schemaVersion:1,value:2});
 for(const raw of [{isError:true,content:[]},{content:[{type:'text',text:'snapshot says success'}]},
  {content:[{type:'text',text:'{"schemaVersion":1}'},{type:'text',text:'{"schemaVersion":1}'}]}]) expect(()=>decodeToolResult(raw)).toThrow();
});
test('missing profile is rejected before any browser startup',async()=>{
 await expect(connectMcp({root:process.cwd(),timeoutMs:500},signal())).rejects.toThrow(/profile/);
});
test('authorization budget is independent; telemetry never contains tool arguments',async()=>{
 const events:any[]=[];const p=await connectTransport(transport(),80,signal(),e=>events.push(e));
 try {await p.call('browser_run_code_unsafe',{code:'delay',secret:'not-for-logs'},signal(),{timeoutMs:1600});}
 finally {await p.close();}
 expect(events.some(e=>e.stage==='call_complete')).toBe(true);
 expect(JSON.stringify(events)).not.toContain('not-for-logs');
});
