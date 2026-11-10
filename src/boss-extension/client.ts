import {readFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import type {PageScope} from './run-policy.js';
import {parseSearchScope,type SearchScope} from './search-protocol.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {parseBinding,parseCommand,parseResult,type Binding,type SessionView,type ActionResult} from './protocol.js';

export class BossExtensionClient{
 private runs=new Set<string>();private closed=false;
 private constructor(private sdk:Client,public binding:Binding,private workflowReady=false,private searchReady=false){}
 private workflowVersion:2|3=2;
 private workflowRun?:{runId:string;leaseId:string};private heartbeat?:ReturnType<typeof setInterval>;private busy=false;private leaseFailure?:Error;
 static async connect(discoveryPath:string):Promise<BossExtensionClient>{
  let d:any;try{d=JSON.parse(await readFile(discoveryPath,'utf8'));}catch{throw Error('HOST_NOT_CONNECTED：请在已登录的 BOSS 标签上点击扩展“连接此页面”');}
  if(d.protocolVersion!==1||!Number.isSafeInteger(d.port)||d.port<1||d.port>65535||typeof d.token!=='string'||d.token.length<32||typeof d.sessionId!=='string')throw Error('INVALID_DISCOVERY');
  const base=`http://127.0.0.1:${d.port}`;const headers={Authorization:`Bearer ${d.token}`,'X-Boss-Session':d.sessionId};
  let health:any;
  try{const response=await fetch(base+'/health',{headers,signal:AbortSignal.timeout(5000),redirect:'error'});if(!response.ok)throw Error();health=await response.json();}catch{throw Error('HOST_HANDSHAKE_FAILED：连接文件可能过期；请重新连接扩展');}
  if(health.protocolVersion!==1||health.sessionId!==d.sessionId||health.writeEnabled!==false)throw Error('SESSION_MISMATCH');
  if(!health.binding)throw Error('BOSS_TAB_NOT_BOUND：当前没有有效的页面绑定');
  const binding=parseBinding(health.binding);const sdk=new Client({name:'boss-job-search-extension',version:'0.1.0'});
  try{
   await sdk.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp'),{requestInit:{headers,redirect:'error'}}));
   const tools=await sdk.listTools();const expected=['inspect_session','get_action_result','get_diagnostics','stop_run'];
   if(tools.tools.some(t=>![...expected,'execute_action'].includes(t.name))||expected.some(name=>!tools.tools.some(t=>t.name===name)))throw Error('TOOL_CONTRACT_MISMATCH');
   const action=tools.tools.find(t=>t.name==='execute_action');
   const hash=createHash('sha256').update(await readFile(path.resolve('contracts/boss-workflow-v2.schema.json'))).digest('hex');
   const workflowReady=health.workflowVersion===1&&health.schemaHash===hash&&!!action&&action.inputSchema?.properties?.command!==undefined;
   const searchHash=createHash('sha256').update(await readFile(path.resolve('contracts/boss-search-v3.schema.json'))).digest('hex');
   return new BossExtensionClient(sdk,binding,workflowReady,workflowReady&&health.searchVersion===1&&health.searchSchemaHash===searchHash);
  }catch(e){await sdk.close().catch(()=>{});throw e;}
 }
 private async call(name:string,args:Record<string,unknown>):Promise<unknown>{
  if(this.closed)throw Error('CLIENT_CLOSED');
  const r=await this.sdk.callTool({name,arguments:args},undefined,{timeout:name==='execute_action'?25000:15000});
  if(r.isError)throw Error('MCP_TOOL_FAILED: '+name);
  if(r.structuredContent)return r.structuredContent;
  const content=r.content as {type:string;text?:string}[];
  const text=content.find(x=>x.type==='text')?.text;if(!text)throw Error('MCP_RESULT_MISSING');return JSON.parse(text);
 }
 async inspect(runId:string):Promise<ActionResult<SessionView>>{
  this.runs.add(runId);
  const command=parseCommand({version:1,tool:'inspect_session',context:{runId,requestId:randomUUID(),binding:this.binding,deadline:new Date(Date.now()+10000).toISOString()},payload:{}});
  const result=parseResult<SessionView>(await this.call('inspect_session',{command}));
  if(result.requestId!==command.context.requestId)throw Error('RESULT_ID_MISMATCH');
  if(result.phase==='observed'){
   const v=result.value;if(!v||JSON.stringify(parseBinding(v.binding))!==JSON.stringify(this.binding)||v.writeEnabled!==false||!Number.isInteger(v.searchBox?.count)||!Array.isArray(v.jobs)||!Array.isArray(v.blockers))throw Error('PAGE_CONTRACT_MISMATCH');
  }
  return result;
 }
 diagnostics(runId:string):Promise<unknown>{return this.call('get_diagnostics',{runId});}
 async startWorkflow(scope:PageScope):Promise<string>{
  this.workflowVersion=2;return this.start(scope);
 }
 async startSearchWorkflow(raw:SearchScope):Promise<string>{
  const scope=parseSearchScope(raw);if(!this.searchReady)throw Error('EXTENSION_UPDATE_REQUIRED');
  this.workflowVersion=3;return this.start(scope);
 }
 private async start(scope:PageScope|SearchScope):Promise<string>{
  if(!this.workflowReady)throw Error('EXTENSION_UPDATE_REQUIRED：请更新扩展并重新连接');
  if(this.workflowRun)throw Error('RUN_BUSY');
  this.workflowRun={runId:randomUUID(),leaseId:randomUUID()};this.runs.add(this.workflowRun.runId);
  try{await this.execute('start_run',scope);}catch(e){this.workflowRun=undefined;throw e;}
  this.heartbeat=setInterval(()=>{if(!this.busy&&!this.closed)void this.renew().catch(e=>{this.leaseFailure=e;});},5000);
  return this.workflowRun.runId;
 }
 private async execute(tool:string,payload:Record<string,unknown>,requestId:string=randomUUID(),beforeDispatch?:(envelope:unknown)=>void):Promise<any>{
  if(!this.workflowRun)throw Error('RUN_NOT_STARTED');
  const command={version:this.workflowVersion,tool,payload,context:{...this.workflowRun,requestId,binding:this.binding,deadline:new Date(Date.now()+20000).toISOString()}};
  beforeDispatch?.(command);
  const result=parseResult<any>(await this.call('execute_action',{command}));
  if(result.requestId!==command.context.requestId)throw Error('RESULT_ID_MISMATCH');
  if(result.phase!=='observed')throw Error(result.error?.code||'ACTION_UNCONFIRMED');
  if(!result.value?.binding)throw Error('RESULT_BINDING_MISSING');
  const next=parseBinding(result.value.binding);if(next.sessionId!==this.binding.sessionId)throw Error('SESSION_MISMATCH');this.binding=next;
  return result.value;
 }
 private async renew(){if(this.busy)return;this.busy=true;try{await this.execute('renew_run',{});}finally{this.busy=false;}}
 async action(tool:string,payload:Record<string,unknown>={}):Promise<any>{
  if(this.leaseFailure)throw this.leaseFailure;
  // Do not race a renewal carrying the old document binding against navigation.
  while(this.busy)await new Promise(r=>setTimeout(r,20));
  this.busy=true;try{await this.execute('renew_run',{});return await this.execute(tool,payload);}finally{this.busy=false;}
 }
 async searchAction(tool:string,payload:Record<string,unknown>,requestId:string,beforeDispatch?:(envelope:unknown)=>void):Promise<any>{
  if(this.workflowVersion!==3)throw Error('VERSION_MISMATCH');if(this.leaseFailure)throw this.leaseFailure;
  while(this.busy)await new Promise(r=>setTimeout(r,20));this.busy=true;
  try{await this.execute('renew_run',{});return await this.execute(tool,payload,requestId,beforeDispatch);}finally{this.busy=false;}
 }
 result(requestId:string):Promise<unknown>{return this.call('get_action_result',{requestId});}
 async close():Promise<void>{
  if(this.closed)return;
  clearInterval(this.heartbeat);
  try{for(const runId of this.runs)await this.call('stop_run',{runId});}finally{this.closed=true;await this.sdk.close();}
 }
}
