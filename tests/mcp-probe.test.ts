import {test,expect} from 'vitest';
import {diagnose,protocolMetadata,parseBossTab,probeCode,tabSummary} from '../src/mcp/probe.js';
import type {McpPort} from '../src/mcp/client.js';
test('diagnosis stops at the first failed read without retry or a full snapshot',async()=>{
 const calls:string[]=[];const events:any[]=[];
 const port={call:async(name:string)=>{calls.push(name);if(calls.length===1)return {content:[{type:'text',text:'- 0: (current) [BOSS](https://www.zhipin.com/web/geek/jobs)'}]};throw new Error('hung');}} as unknown as McpPort;
 await expect(diagnose(port,new AbortController().signal,e=>events.push(e))).rejects.toThrow('hung');
 expect(calls).toEqual(['browser_tabs','browser_run_code_unsafe']);
 expect(events.map(e=>e.stage)).toEqual(['tabs_start','tabs_observed','tabs_complete','metadata_start','metadata_failed']);
});
test('target diagnosis distinguishes blank/extension and multiple targets without leaking queries',()=>{
 const result={content:[{type:'text',text:'### Result\n- 0: (current) [](about:blank)\n- 1: [Welcome](chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm/connect.html?token=SECRET)'}]};
 expect(tabSummary(result)).toEqual([{index:0,current:true,kind:'blank'},{index:1,current:false,kind:'extension'}]);
 expect(()=>parseBossTab(result)).toThrow('NO_BOSS_TARGET');
 expect(()=>parseBossTab({content:[{type:'text',text:'- 0: (current) [BOSS](https://www.zhipin.com/web/geek/jobs)\n- 1: [BOSS](https://www.zhipin.com/web/geek/chat)'}]})).toThrow('MULTIPLE_BOSS_TARGETS');
});
test('tab listing rejects no target, wrong origin and multiple BOSS tabs before DOM access',()=>{
 const response=(s:string)=>({content:[{type:'text',text:s}]});
 for(const text of ['','- 0: (current) [Other](https://example.com)','- 0: [BOSS](https://www.zhipin.com/web/geek/jobs)\n- 1: (current) [BOSS](https://www.zhipin.com/web/geek/chat)'])expect(()=>parseBossTab(response(text))).toThrow();
 expect(parseBossTab(response('- 0: (current) [BOSS](https://www.zhipin.com/web/geek/jobs?secret=hidden)'))).toBe('https://www.zhipin.com/web/geek/jobs?secret=hidden');
});
test('bound target refuses another same-origin page before evaluate',async()=>{
 let reads=0;const ctx:any={pages:()=>[first]};const first={context:()=>ctx,url:()=> 'https://www.zhipin.com/web/geek/jobs',evaluate:()=>{reads++;}};
 const second={...first};await new Function('page','return ('+probeCode('metadata',first.url())+')(page)')(first);
 ctx.pages=()=>[second];await expect(new Function('page','return ('+probeCode('dom',first.url())+')(page)')(second)).rejects.toThrow('TARGET_CHANGED');expect(reads).toBe(0);
});
test('successful diagnostics return only summaries, never raw tab queries or DOM bodies',async()=>{
 const results=[{content:[{type:'text',text:'- 0: (current) [BOSS](https://www.zhipin.com/web/geek/jobs?token=SECRET)'}]}, {content:[{type:'text',text:JSON.stringify({schemaVersion:1,value:{url:'https://www.zhipin.com/web/geek/jobs'}})}]}, {content:[{type:'text',text:JSON.stringify({schemaVersion:1,value:{textLength:123,searchInputs:1,unexpected:'MESSAGE'}})}]}];
 const port={call:async()=>results.shift()} as unknown as McpPort;
 const result=JSON.stringify(await diagnose(port,new AbortController().signal,()=>{}));expect(result).not.toMatch(/SECRET|MESSAGE|token/);
});
test('protocol metadata discards params and response bodies',()=>{
 const s='2026-10-27 pw:protocol SEND ► {"id":12,"method":"Runtime.evaluate","params":{"expression":"token=SECRET"},"sessionId":"PRIVATE"}';
 expect(protocolMetadata(s)).toMatchObject({direction:'SEND',id:12,method:'Runtime.evaluate'});
 expect(JSON.stringify(protocolMetadata(s))).not.toContain('PRIVATE');
 expect(JSON.stringify(protocolMetadata(s))).not.toContain('SECRET');
 expect(protocolMetadata('arbitrary SECRET')).toBeUndefined();
});
test('actual Playwright receive prefix is parsed',()=>{
 expect(protocolMetadata('pw:protocol ◀ RECV {"id":12,"result":{"secret":"hidden"}}')).toEqual({direction:'RECV',id:12,method:undefined});
});
test('navigation evidence retains only BOSS origin/path and opaque session identifiers',()=>{
 const event=protocolMetadata('pw:protocol RECV ◀ '+JSON.stringify({method:'Page.frameNavigated',sessionId:'private-session',params:{frame:{url:'https://www.zhipin.com/shenzhen/?token=SECRET',id:'target-private'}}}));
 expect(event).toMatchObject({method:'Page.frameNavigated',url:'https://www.zhipin.com/shenzhen/'});
 expect(JSON.stringify(event)).not.toMatch(/SECRET|private-session|target-private/);
});
