import {safeListUrl} from './current-list-actions.js';
import {allowedUrl,validateTarget} from './binding.js';
import {WorkflowController} from './workflow-controller.js';
export class Controller{
 constructor(api,log,{recoveryDelayMs=750}={}){this.api=api;this.log=log;this.binding=null;this.port=null;this.busy=false;this.connecting=false;this.status='未连接';this.workflow=new WorkflowController(this,api);this.authorized=null;this.recoveryGeneration=0;this.recoveryDelayMs=recoveryDelayMs;}
 async connect(){
  if((this.port&&this.binding)||this.connecting||this.busy)throw Error('HOST_BUSY');this.connecting=true;
  const generation=++this.recoveryGeneration;this.authorized=null;const check=()=>{if(generation!==this.recoveryGeneration)throw Error('CONNECTION_CANCELLED');};
  try{
   const [tab]=await this.api.tabs.query({active:true,currentWindow:true});check();
   if(!tab||!allowedUrl(tab.url))throw Error('请先选中 BOSS 职位页或聊天页');
   const frame=await this.api.webNavigation.getFrame({tabId:tab.id,frameId:0});check();
   if(!frame?.documentId||!allowedUrl(frame.url))throw Error('DOCUMENT_UNAVAILABLE');
   const binding={sessionId:crypto.randomUUID(),tabId:tab.id,frameId:0,documentId:frame.documentId};
   await this.api.scripting.executeScript({target:{tabId:tab.id,documentIds:[frame.documentId]},files:['content.bundle.js']});check();
   const currentFrame=await this.api.webNavigation.getFrame({tabId:tab.id,frameId:0});check();
   if(currentFrame?.documentId!==frame.documentId)throw Error('DOCUMENT_CHANGED');
   this.authorized={...binding};this.binding=binding;
   if(!this.port){
    const port=this.api.runtime.connectNative('com.jobsearch.boss_bridge');this.port=port;
    this.status='正在连接本地服务';
    port.onMessage.addListener(m=>{if(this.port!==port)return;if(m.kind==='ready'){this.status='已连接（待运行）';}else if(m.kind==='command')void this.execute(m.command);else if(m.kind==='stop')this.workflow.stop(m.runId);});
    port.onDisconnect.addListener(()=>{const error=this.api.runtime.lastError?.message;if(this.port!==port)return;this.status=error||'已断开';this.port=null;this.binding=null;void this.log('native_disconnected',{});});
   }else{this.status='已重新绑定（只读）';}
   this.port.postMessage({kind:'bind',binding,workflowVersion:1,searchVersion:1,currentListVersion:1});await this.log('extension_bound',binding);
   return this.snapshot();
  }finally{this.connecting=false;}
 }
 snapshot(){return {status:this.status,binding:this.binding,writeEnabled:false};}
 async frameMatches(binding){
  validateTarget(binding,this.binding);
  const frame=await this.api.webNavigation.getFrame({tabId:binding.tabId,frameId:0});
  if(frame?.documentId!==binding.documentId||!allowedUrl(frame?.url))throw Error('DOCUMENT_CHANGED');
 }
 async execute(command){
  if(command?.version===2||command?.version===3||command?.version===4)return this.workflow.execute(command);
  const id=command?.context?.requestId;const port=this.port;
  const send=result=>{try{port?.postMessage({kind:'result',result});}catch{}};
  let executing=false;let owned=false;let timer;
  try{
   if(this.busy)throw Error('ACTION_BUSY');
   if(command?.version!==1||command.tool!=='inspect_session'||!command.payload||Object.keys(command.payload).length)throw Error('TOOL_NOT_ENABLED');
   const remaining=Date.parse(command.context.deadline)-Date.now();if(!Number.isFinite(remaining)||remaining<=0)throw Error('DEADLINE_EXPIRED');
   this.busy=true;owned=true;this.status='读取当前页面';
   await this.event('extension_received',id,{});await this.frameMatches(command.context.binding);
   await this.event('validated',id,command.context.binding);executing=true;
   const response=await Promise.race([this.api.tabs.sendMessage(command.context.binding.tabId,{kind:'read',command},{documentId:command.context.binding.documentId}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('CONTENT_RESPONSE_TIMEOUT')),Math.min(remaining,10000));})]);
   await this.frameMatches(command.context.binding);
   if(port!==this.port)throw Error('NATIVE_DISCONNECTED');
   if(response?.error)throw Error(response.error);
   if(!response?.value||response.value.writeEnabled!==false)throw Error('INVALID_CONTENT_RESULT');
   send({requestId:id,phase:'observed',value:{...response.value,binding:this.binding},evidenceIds:[]});
   this.status='已连接（只读）';
  }catch(error){
   const known=['ACTION_BUSY','TOOL_NOT_ENABLED','DEADLINE_EXPIRED','DOCUMENT_CHANGED','BINDING_CHANGED','NATIVE_DISCONNECTED','CONTENT_RESPONSE_TIMEOUT','DOM_READ_FAILED','INVALID_CONTENT_RESULT'];
   const code=known.includes(error.message)?error.message:'CONTENT_CHANNEL_FAILED';
   this.status=code;send({requestId:id,phase:executing?'uncertain':'rejected',error:{code,message:code},evidenceIds:[]});
   await this.log('action_error',{requestId:id,code});
  }finally{clearTimeout(timer);if(owned)this.busy=false;}
 }
 async event(stage,requestId,meta){if(meta?.url){meta={...meta};try{const u=new URL(meta.url);meta.url=u.pathname==='/web/geek/jobs'?safeListUrl(meta.url):u.origin+u.pathname;}catch{delete meta.url;}}await this.log(stage,{...meta,requestId});try{this.port?.postMessage({kind:'event',stage,requestId,meta});}catch{}}
 async recoverBinding(generation){
  const target=this.authorized;const current=()=>this.authorized===target&&this.recoveryGeneration===generation&&Boolean(this.port);
  for(let attempt=1;attempt<=3&&current();attempt++){
   this.status=`页面变化，自动重连 ${attempt}/3`;
   await new Promise(r=>setTimeout(r,this.recoveryDelayMs));if(!current())return;
   let timer;
   try{
    const tab=await this.api.tabs.get(target.tabId);if(!current())return;
    if(!tab||!allowedUrl(tab.url)){this.authorized=null;this.status='已离开授权页面，自动重连停止';return;}
    const frame=await this.api.webNavigation.getFrame({tabId:target.tabId,frameId:0});
    if(!frame?.documentId||!allowedUrl(frame.url))throw Error('DOCUMENT_UNAVAILABLE');
    const binding={...target,documentId:frame.documentId};
    await this.api.scripting.executeScript({target:{tabId:target.tabId,documentIds:[frame.documentId]},files:['content.bundle.js']});if(!current())return;
    const command={version:1,tool:'inspect_session',payload:{},context:{runId:crypto.randomUUID(),requestId:crypto.randomUUID(),binding,deadline:new Date(Date.now()+4000).toISOString()}};
    const response=await Promise.race([this.api.tabs.sendMessage(target.tabId,{kind:'read',command},{documentId:frame.documentId}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('PAGE_NOT_READY')),4000);})]);
    if(!current())return;const value=response?.value;
    if(value?.blockers?.length){this.status='页面需要登录、验证或处理限制；自动重连停止';return;}
    if(value?.writeEnabled!==false||!Array.isArray(value.blockers)||!(value.pageKind==='jobs'&&value.searchBox?.count===1||value.pageKind==='chat'&&value.chatLayoutProbe?.headerNodes?.length))throw Error('PAGE_NOT_READY');
    const latest=await this.api.webNavigation.getFrame({tabId:target.tabId,frameId:0});if(!current())return;
    if(latest?.documentId!==frame.documentId||!allowedUrl(latest.url))throw Error('DOCUMENT_CHANGED');
    this.binding=binding;this.port.postMessage({kind:'bind',binding,workflowVersion:1,searchVersion:1,currentListVersion:1});this.status='已自动重连（等待任务恢复）';await this.log('auto_rebound',{tabId:target.tabId,documentId:frame.documentId});return;
   }catch{if(!current())return;}finally{clearTimeout(timer);}
  }
  if(current())this.status='自动重连失败（已尝试3次），请检查页面后连接';
 }
 async changed(stage,details){
  if(this.workflow.changed(stage,details)){await this.event('expected_navigation',this.workflow.navigation?.requestId,{...details,correlation:'matches_expected_destination',tool:this.workflow.navigation?.tool});return;}
  if(details.tabId!==(this.authorized?.tabId??this.binding?.tabId)||details.frameId&&details.frameId!==0)return;
  if(stage==='document_changed'||stage==='tab_removed'){
   const generation=++this.recoveryGeneration;const runId=this.workflow.executor.run?.runId;if(runId)this.workflow.stop(runId,stage==='document_changed'&&(!details.url||allowedUrl(details.url))?'DOCUMENT_CHANGED':'RUN_STOPPED');
   this.binding=null;
   if(stage==='tab_removed'||details.url&&!allowedUrl(details.url))this.authorized=null;
   this.status=this.authorized?'页面已变化，正在自动重连':'授权页面已关闭或离开，已停止';
   await this.event(stage,undefined,{tabId:details.tabId,documentId:details.documentId,url:details.url,correlation:'uncorrelated'});
   if(this.authorized)await this.recoverBinding(generation);return;
  }
  await this.event(stage,undefined,{tabId:details.tabId,documentId:details.documentId,url:details.url,transitionType:details.transitionType,correlation:'uncorrelated'});
 }
 disconnect(){this.recoveryGeneration++;this.authorized=null;this.workflow.stop(this.workflow.executor.run?.runId);const p=this.port;this.port=null;this.binding=null;this.status='已停止/断开';p?.disconnect();}
}
