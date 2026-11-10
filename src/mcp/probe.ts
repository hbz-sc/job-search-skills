import type {McpPort} from './client.js';
import {createHash} from 'node:crypto';
import {decodeToolResult} from './result.js';
export function protocolMetadata(line:string):{direction:string;id?:number;method?:string;session?:string;target?:string;url?:string}|undefined{
 const direction=line.match(/pw:protocol\s+(?:◀\s*)?(SEND|RECV)/)?.[1];if(!direction)return;
 const start=line.indexOf('{');if(start<0)return;
 try{const data=JSON.parse(line.slice(start));const hash=(s:unknown)=>typeof s==='string'?createHash('sha256').update(s).digest('hex').slice(0,12):undefined;
 const event=data.params??data.result;const target=event?.targetInfo;const frame=event?.frame;
 const raw=target?.url??frame?.url;let url:string|undefined;if(raw){try{const u=new URL(raw);if(u.origin==='https://www.zhipin.com')url=u.origin+u.pathname;}catch{}}
 return {direction,id:typeof data.id==='number'?data.id:undefined,method:typeof data.method==='string'&&/^[A-Za-z]+\.[A-Za-z]+$/.test(data.method)?data.method:undefined,...(data.sessionId?{session:hash(data.sessionId)}:{}),...(target?.targetId||event?.targetId?{target:hash(target?.targetId??event.targetId)}:{}),...(url?{url}:{})};}catch{return;}
}
function parseTabs(result:unknown){
 const r=result as {content?:Array<{type:string;text?:string}>};
 const text=(r.content??[]).filter(x=>x.type==='text').map(x=>x.text??'').join('\n');
 return [...text.matchAll(/^- (\d+):\s*(\(current\))?\s*\[.*\]\(([^\r\n]+)\)\s*$/gm)].flatMap(m=>{try{const u=new URL(m[3]);return [{index:Number(m[1]),url:u.href,current:!!m[2]}];}catch{return [];}});
}
export function tabSummary(result:unknown){return parseTabs(result).map(t=>{
 const u=new URL(t.url);const boss=u.origin==='https://www.zhipin.com'||u.origin==='https://zhipin.com';
 return {index:t.index,current:t.current,kind:boss?'boss':u.href==='about:blank'?'blank':u.protocol==='chrome-extension:'?'extension':'other',...(boss?{url:u.origin+u.pathname}:{})};
});}
export function parseBossTab(result:unknown):string{
 const all=parseTabs(result);if(!all.length)throw new Error('UNRECOGNIZED_TAB_RESULT');
 const tabs=all.filter(t=>new URL(t.url).origin==='https://www.zhipin.com');
 if(tabs.length===0)throw new Error('NO_BOSS_TARGET');if(tabs.length>1)throw new Error('MULTIPLE_BOSS_TARGETS');if(!tabs[0].current)throw new Error('BOSS_TARGET_REQUIRED');return tabs[0].url;
}
export function probeCode(stage:'metadata'|'dom',url:string){
 return `async (page) => {
 const expected=${JSON.stringify(url)};const ctx=page.context();
 const candidates=ctx.pages().filter(p=>{try{return new URL(p.url()).origin==='https://www.zhipin.com';}catch{return false;}});
 if(candidates.length!==1)throw new Error('AMBIGUOUS_TARGET');
 if(candidates[0]!==page||page.url()!==expected)throw new Error('TARGET_CHANGED');
 ${stage==='metadata'?`ctx.__bossDiagnosticTarget={page,url:expected};return {schemaVersion:1,value:{url:new URL(expected).origin+new URL(expected).pathname}};`:
 `if(ctx.__bossDiagnosticTarget?.page!==page||ctx.__bossDiagnosticTarget.url!==expected)throw new Error('TARGET_CHANGED');
 let timer;try {const value=await Promise.race([page.evaluate(()=>({textLength:document.body?.innerText.length??0,searchInputs:document.querySelectorAll('input[placeholder*="搜索"]').length})),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('DOM_EVALUATION_TIMEOUT')),5000);})]);return {schemaVersion:1,value};}finally{clearTimeout(timer);}`}
 }`;
}
export async function diagnose(port:McpPort,signal:AbortSignal,onEvent:(e:{stage:string;elapsedMs?:number;tabs?:ReturnType<typeof tabSummary>})=>void){
 const completed:Array<{stage:string;count?:number;url?:string;textLength?:number;searchInputs?:number}>=[];let url='';
 for(const stage of ['tabs','metadata','dom'] as const){signal.throwIfAborted();const start=Date.now();onEvent({stage:stage+'_start'});
  try{
   if(stage==='tabs'){const result=await port.call('browser_tabs',{action:'list'},signal,{timeoutMs:180000});onEvent({stage:'tabs_observed',tabs:tabSummary(result)});url=parseBossTab(result);completed.push({stage,count:1});}
   else{const result=decodeToolResult(await port.call('browser_run_code_unsafe',{code:probeCode(stage,url)},signal,{timeoutMs:15000}));const v=result.value as any;
    if(stage==='metadata'){const u=new URL(url);if(v?.url!==u.origin+u.pathname)throw new Error('TARGET_CHANGED');completed.push({stage,url:v.url});}
    else{if(!Number.isSafeInteger(v?.textLength)||!Number.isSafeInteger(v?.searchInputs)||v.textLength<0||v.searchInputs<0)throw new Error('INVALID_DOM_RESULT');completed.push({stage,textLength:v.textLength,searchInputs:v.searchInputs});}}
   onEvent({stage:stage+'_complete',elapsedMs:Date.now()-start});
  }catch(e){onEvent({stage:stage+'_failed',elapsedMs:Date.now()-start});throw e;}
 }
 return completed;
}
