import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {HiddenStdioTransport} from './stdio.js';

export type ToolInfo={name:string;inputSchema:Record<string,unknown>};
export type McpEvent={stage:string;tool?:string;requestId?:number;elapsedMs?:number;code?:number};
export type McpOptions={root:string;browser?:'chrome'|'msedge';profileDirName?:string;timeoutMs:number;onEvent?:(e:McpEvent)=>void;onStderr?:(line:string)=>void};
export interface McpPort {
 tools():Promise<ToolInfo[]>;
 call(name:string,args:Record<string,unknown>,signal:AbortSignal,options?:{timeoutMs:number}):Promise<unknown>;
 close():Promise<void>;
}
const allowed=new Set(['browser_snapshot','browser_tabs','browser_run_code_unsafe','browser_take_screenshot']);
export async function connectTransport(transport:Transport,timeoutMs:number,signal:AbortSignal,onEvent?:(e:McpEvent)=>void):Promise<McpPort>{
 signal.throwIfAborted();
 const client=new Client({name:'boss-job-search',version:'0.2.0'},{capabilities:{}});
 let closed=false;let closing:Promise<void>|undefined;
 let requestId=0;const emit=(e:McpEvent)=>{try{onEvent?.(e);}catch{}};
 const close=()=>{closed=true;return closing??=(client.close().catch(()=>{}));};
 client.onclose=()=>{closed=true;emit({stage:'disconnected'});};
 try{
  emit({stage:'initializing'});await client.connect(transport,{signal,timeout:Math.max(timeoutMs,2000)});
  const list=await client.listTools({}, {signal,timeout:Math.max(timeoutMs,2000)});
  const tools=list.tools.map(t=>({name:t.name,inputSchema:t.inputSchema}));
  for(const name of ['browser_snapshot','browser_tabs','browser_run_code_unsafe']){
   if(!tools.some(t=>t.name===name))throw new Error('MCP 缺少工具：'+name);
  }
  const props=tools.find(t=>t.name==='browser_run_code_unsafe')!.inputSchema.properties as Record<string,{type?:string}>|undefined;
  if(props?.code?.type!=='string')throw new Error('MCP 代码工具 schema 不兼容');
  emit({stage:'protocol_ready'});return {
   tools:async()=>tools,
   async call(name,args,callSignal,options){
    if(closed)throw new Error('MCP closed / 已断开');callSignal.throwIfAborted();
    if(!allowed.has(name)||!tools.some(t=>t.name===name))throw new Error('MCP 工具不在允许列表');
    if(name==='browser_tabs'&&!['list','select'].includes(String(args.action)))throw new Error('禁止创建或关闭用户标签页');
    if(name==='browser_run_code_unsafe'&&(typeof args.code!=='string'||'filename' in args))throw new Error('仅允许固定代码参数');
    let result;const id=++requestId,start=Date.now();emit({stage:'call_start',tool:name,requestId:id});
    try{result=await client.callTool({name,arguments:args},undefined,{signal:callSignal,timeout:options?.timeoutMs??timeoutMs});}
    catch(e){emit({stage:'call_failed',tool:name,requestId:id,elapsedMs:Date.now()-start,code:typeof (e as any)?.code==='number'?(e as any).code:undefined});await close();throw e;}
    callSignal.throwIfAborted();
    if(result.isError){emit({stage:'tool_failed',tool:name,requestId:id,elapsedMs:Date.now()-start});const detail=(result.content as any[]).filter(x=>x.type==='text').map(x=>x.text).join('\n');const reason=['TARGET_CHANGED','BOSS_TARGET_REQUIRED','AMBIGUOUS_TARGET','DOM_EVALUATION_TIMEOUT'].find(x=>detail.includes(x))??'TOOL_ERROR';throw new Error(reason);}
    emit({stage:'call_complete',tool:name,requestId:id,elapsedMs:Date.now()-start});
    return result;
   },close
  };
 }catch(e){await close();throw e;}
}
export async function connectMcp(o:McpOptions,signal:AbortSignal):Promise<McpPort>{
 if(!o.profileDirName||!/^Default$|^Profile \d+$/.test(o.profileDirName))throw new Error('请指定已核实的 Edge profile（--profile）');
 const args=[path.join(o.root,'node_modules/@playwright/mcp/cli.js'),'--extension','--browser',o.browser??'chrome','--profile-dir-name',o.profileDirName,'--no-webmcp','--image-responses','omit','--output-dir',path.join(o.root,'output/playwright-mcp')];
 return connectTransport(new HiddenStdioTransport(process.execPath,args,o.root,o.onStderr),o.timeoutMs,signal,o.onEvent);
}
