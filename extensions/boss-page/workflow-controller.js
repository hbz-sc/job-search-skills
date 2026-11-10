import {CurrentListSession} from './current-list-session.js';
import {ActionExecutor,validateScope,validateSearchScope,validateCurrentListScope} from './action-executor.js';
import {ExtensionJournal} from './journal.js';
import {allowedUrl} from './binding.js';
import {ExperiencePointer} from './experience-pointer.js';
const pointerFailure=e=>/^(DEBUGGER_|EXPERIENCE_|MANUAL_EXPERIENCE_REQUIRED|JOB_EXPERIENCE_CHANGED)/.test(e.message);

export class WorkflowController{
 constructor(owner,api){this.owner=owner;this.api=api;this.executor=new ActionExecutor(new ExtensionJournal(api.storage?.local));this.state={};this.navigation=null;this.created=[];this.pointer=new ExperiencePointer(api);this.pointerRunId=null;this.currentList=new CurrentListSession(this);}
 createdTab(tab){if(this.navigation?.tool==='open_chat'&&tab.openerTabId===this.navigation.sourceTab)this.created.push(tab.id);}
 expectedUrl(url){
  if(!this.navigation||Date.now()>this.navigation.until)return false;
  try{const u=new URL(url);if(u.origin!=='https://www.zhipin.com')return false;
   if(this.navigation.tool==='open_chat')return u.pathname==='/web/geek/chat';
   if(u.pathname!=='/web/geek/jobs')return false;
   if(this.executor.run?.version===4)return ['open_job','advance_list','restore_list'].includes(this.navigation.tool);
   if(['search_jobs','restore_search'].includes(this.navigation.tool)&&this.navigation.returnToJobs)return true;
   return u.searchParams.get('query')===(this.navigation.keyword??'AI应用开发工程师')&&(this.executor.run?.version===3&&this.executor.run.scope.city==='current'||!u.searchParams.has('city')||u.searchParams.get('city')==='101280600');
  }catch{return false;}
 }
 changed(stage,d){
  if(!this.navigation)return false;
  if(stage==='tab_removed'){this.executor.stop(this.executor.run?.runId);return false;}
  if(d.frameId&&d.frameId!==0)return false;
  if(d.tabId!==this.navigation.sourceTab&&!this.created.includes(d.tabId))return false;
  if(d.url&&!this.expectedUrl(d.url)){this.stop(this.executor.run?.runId);return false;}
  return true;
 }
 stop(runId,reason='RUN_STOPPED'){if(this.pointerRunId===runId)this.pointer.cancel(reason);this.executor.stop(runId,reason);this.state={};this.activeClick=null;const b=this.owner.binding;if(b)void this.api.tabs?.sendMessage(b.tabId,{kind:'cancel_run',runId,reason},{documentId:b.documentId}).catch(()=>{});}
 authorizeClick(requestId){
  if(!this.activeClick||this.activeClick.context.requestId!==requestId)throw Error('NO_ACTIVE_CLICK');
  this.executor.assert(this.activeClick);return {allowed:true};
 }
 async message(c,stage,state){
  await this.owner.frameMatches(this.owner.binding);
  this.executor.assert(c);
  this.activeClick=stage==='perform'||stage==='pointer'?c:null;
  const r=await this.api.tabs.sendMessage(this.owner.binding.tabId,{kind:'action',command:{...c,context:{...c.context,binding:this.owner.binding}},stage,state:{...state,experienceMode:this.executor.run?.scope.experienceMode??'manual'}},{documentId:this.owner.binding.documentId});
  if(r?.error)throw Object.assign(Error(r.error),r.error==='LIST_CONDITIONS_CHANGED'?{details:r.details}:{});if(!r||!Object.hasOwn(r,'value'))throw Error('INVALID_CONTENT_RESULT');return r.value;
 }
 async performPointer(c,check){
  if(c.version!==3||this.executor.run?.scope.experienceMode!=='auto'||!['search_jobs','restore_search'].includes(c.tool))throw Error('SCOPE_DENIED');
  const binding=structuredClone(this.owner.binding);
  const assertCurrent=()=>{
   check();this.executor.assert(c);
   if(['sessionId','tabId','frameId','documentId'].some(k=>binding[k]!==this.owner.binding?.[k]))throw Error('BINDING_CHANGED');
  };
  const verify=async()=>{
   assertCurrent();const run=this.executor.assert(c);
   if(!run.scope.allowedKeywords.includes(c.payload.keyword)||!run.scope.experienceBands.includes(c.payload.experience)||c.payload.city!==run.scope.city)throw Error('SCOPE_DENIED');
   await this.owner.frameMatches(binding);check();this.executor.assert(c);
   const tab=await this.api.tabs.get(binding.tabId);check();this.executor.assert(c);
   if(!allowedUrl(tab?.url)||new URL(tab.url).pathname!=='/web/geek/jobs')throw Error('BINDING_CHANGED');
   await this.owner.frameMatches(binding);check();this.executor.assert(c);
   return tab;
  };
  const foreground=async assertPreparing=>{
   const ensure=async()=>{assertPreparing();const value=await verify();assertPreparing();return value;};
   try{
   const tab=await ensure();
   if(!Number.isSafeInteger(tab.windowId)||!this.api.windows?.get)throw Error('EXPERIENCE_FOREGROUND_UNAVAILABLE');
   const window=await this.api.windows.get(tab.windowId);let fresh=await ensure();
   if(fresh.windowId!==tab.windowId)throw Error('BINDING_CHANGED');
   if(!fresh.active){await this.api.tabs.update(binding.tabId,{active:true});fresh=await ensure();}
   if(fresh.windowId!==tab.windowId)throw Error('BINDING_CHANGED');
   if(!window.focused||window.state==='minimized'){await this.api.windows.update(tab.windowId,{focused:true,...(window.state==='minimized'?{state:'normal'}:{})});await ensure();}
   const current=await this.api.windows.get(tab.windowId);fresh=await ensure();
   if(fresh.windowId!==tab.windowId||!fresh.active||!current.focused||current.state==='minimized')throw Error('EXPERIENCE_FOREGROUND_UNAVAILABLE');
   }catch(e){if(/^(DOCUMENT_CHANGED|BINDING_CHANGED|RUN_STOPPED|LEASE_EXPIRED|DEADLINE_EXPIRED|SCOPE_DENIED|EXPERIENCE_FOREGROUND_UNAVAILABLE)$/.test(e.message))throw e;throw Error('EXPERIENCE_FOREGROUND_UNAVAILABLE');}
  };
  this.pointerRunId=c.context.runId;
  try{return await this.pointer.select({binding,deadline:Date.parse(c.context.deadline),check:verify,assertCurrent,prepare:foreground,onPhase:phase=>{void this.owner.event('experience_pointer',c.context.requestId,{phase}).catch(()=>{});},observe:(step,label)=>this.message(c,'pointer',{step,label})});}
  finally{this.pointerRunId=null;}
 }
 async performMessage(c,state,check){
  const value=await this.message(c,'perform',state);
  if(value.requiresPointer){if(this.executor.run?.scope.experienceMode!=='auto')throw Error('MANUAL_EXPERIENCE_REQUIRED');await this.performPointer(c,check);}
  return value;
 }
 async adopt(tabId){
  const frame=await this.api.webNavigation.getFrame({tabId,frameId:0});if(!frame||!allowedUrl(frame.url))throw Error('TARGET_NOT_READY');
  const b={...this.owner.binding,tabId,documentId:frame.documentId};
  await this.api.scripting.executeScript({target:{tabId,documentIds:[frame.documentId]},files:['content.bundle.js']});
  if((await this.api.webNavigation.getFrame({tabId,frameId:0}))?.documentId!==frame.documentId)throw Error('DOCUMENT_CHANGED');
  this.owner.binding=b;this.executor.rebind(b);this.owner.port.postMessage({kind:'bind',binding:b,workflowVersion:1,searchVersion:1,currentListVersion:1});
 }
 async perform(c,check){
  if(c.version===4&&c.tool==='restore_list')await this.currentList.restore(c,check);
  // Reinject the packaged adapter when resuming an existing conversation.
  // It is a fixed local file, never caller-supplied code or selectors.
  if(c.tool==='inspect_chat'&&!this.state.chat){check();await this.adopt(this.owner.binding.tabId);c.context.binding=this.owner.binding;}
  const sourceTab=this.owner.binding.tabId,sourceDocument=this.owner.binding.documentId;const tool=c.tool;
  if(tool==='restore_search'&&this.state.listTab!==undefined){
   const t=await this.api.tabs.get(this.state.listTab);
   if(!allowedUrl(t.url))throw Error('LIST_PAGE_UNAVAILABLE');
   if(new URL(t.url).pathname.startsWith('/web/geek/jobs')){await this.api.tabs.update(t.id,{active:true});await this.adopt(t.id);c.context.binding=this.owner.binding;}
  }
  check();let state=await this.message(c,'prepare',this.state);
  this.navigation=['search_jobs','open_job','open_chat','restore_search','list_jobs','advance_list'].includes(tool)?{sourceTab:this.owner.binding.tabId,requestId:c.context.requestId,tool,keyword:c.version===3?(c.payload.keyword??this.state.query?.keyword):undefined,until:Date.parse(c.context.deadline),returnToJobs:state.returnToJobs}:null;this.created=[];
  const end=Math.min(Date.now()+15000,Date.parse(c.context.deadline));
  try{
   check();
   try{await this.performMessage(c,state,check);}catch(e){
    // A navigation may close the response channel after the click. Never repeat
    // perform; observation below is the only allowed recovery.
    if(!this.navigation||pointerFailure(e)||['SCOPE_DENIED','RUN_STOPPED','LEASE_EXPIRED'].includes(e.message))throw e;
   }
   let last='ACTION_NOT_OBSERVED',filterPasses=0;
   while(Date.now()<end){
    check();await new Promise(r=>setTimeout(r,200));
    const candidates=[];
    for(const id of this.created){const t=await this.api.tabs.get(id).catch(()=>null);if(t?.url&&t.url!=='about:blank'){if(!this.expectedUrl(t.url))throw Error('UNEXPECTED_NAVIGATION');candidates.push(id);}}
    if(candidates.length>1)throw Error('TARGET_AMBIGUOUS');
    const tabId=candidates[0]??this.owner.binding.tabId;
    const frame=await this.api.webNavigation.getFrame({tabId,frameId:0});
    if(tool==='open_chat'&&tabId===sourceTab&&frame?.documentId===sourceDocument&&new URL(frame.url).pathname==='/web/geek/jobs'){last='CHAT_NAVIGATION_PENDING';continue;}
     if(['search_jobs','restore_search'].includes(tool)&&state.returnToJobs&&tabId===sourceTab&&frame?.documentId===sourceDocument&&new URL(frame.url).pathname==='/web/geek/chat'){last='JOBS_NAVIGATION_PENDING';continue;}
    if(frame&&(tabId!==this.owner.binding.tabId||frame.documentId!==this.owner.binding.documentId)){if(!this.expectedUrl(frame.url))throw Error('UNEXPECTED_NAVIGATION');await this.adopt(tabId);c.context.binding=this.owner.binding;}
    try{
     const value=await this.message(c,'observe',state);
     if(c.version===3&&value.requiresFilters){if(++filterPasses>2)throw Error('FILTER_UNVERIFIED');const prior=state;state=await this.message(c,'prepare',{});if(prior.queryChanged||prior.needKeyword)state={...state,queryChanged:true,before:prior.before};check();await this.performMessage(c,state,check);continue;}
      if(value.requiresSearch&&['search_jobs','restore_search'].includes(tool)&&state.returnToJobs){state=await this.message(c,'prepare',{});if(state.returnToJobs)throw Error('LIST_PAGE_UNAVAILABLE');check();await this.performMessage(c,state,check);continue;}
     if(tool==='search_jobs'||tool==='restore_search')this.state.listTab=this.owner.binding.tabId;
     if(c.version===3&&['search_jobs','restore_search','list_jobs'].includes(tool))this.state.query={keyword:c.payload.keyword,city:c.payload.city,experience:c.payload.experience,experienceMode:this.executor.run?.scope.experienceMode??'manual'};
     if(c.version===4&&['inspect_current_list','advance_list','restore_list'].includes(tool))await this.currentList.observe(value);
     if(c.version===4&&tool==='open_chat'){this.currentList.original.chatTabId=this.owner.binding.tabId;await this.currentList.save();}
     if(tool==='open_job')this.state.job=value;
     if(tool==='open_chat'||tool==='inspect_chat')this.state.chat=value;
     if(tool==='read_first_phrase')this.state.phrase=value;
     if(tool==='choose_first_phrase'||tool==='submit_filled_phrase')this.state.selection={...state,result:value};
     await this.owner.event('dom_action_complete',c.context.requestId,{});
     return {...value,binding:this.owner.binding};
    }catch(e){last=e.message;if(pointerFailure(e)||/QUOTA|LOGIN|VERIFICATION|MISMATCH|AMBIGUOUS|CHANGED|RUN_STOPPED|SCOPE_DENIED|LEASE_EXPIRED/.test(last))throw e;}
   }
   throw Error('POSTCONDITION_TIMEOUT:'+last);
  }finally{this.navigation=null;this.created=[];this.activeClick=null;}
 }
 async execute(c){
  let result;
  try{
   await this.owner.event('extension_received',c.context.requestId,{});
   await this.owner.frameMatches(c.context.binding);
   await this.owner.event('validated',c.context.requestId,{...c.context.binding,tool:c.tool});
   if(c.tool==='start_run'||c.tool==='renew_run'){
    if(Date.parse(c.context.deadline)<=Date.now())throw Error('DEADLINE_EXPIRED');
    if(c.tool==='start_run'){(c.version===4?validateCurrentListScope:c.version===3?validateSearchScope:validateScope)(c.payload);this.executor.start(c.context.runId,c.context.leaseId,c.payload,c.context.binding,c.version);this.state={};if(c.version===4){try{await this.currentList.start(c.payload.batchId);}catch(e){this.executor.stop(c.context.runId);throw e;}}}
    else{this.executor.assert(c);this.executor.renew(c.context.runId,c.context.leaseId);}
    result={requestId:c.context.requestId,phase:'observed',value:{leaseId:c.context.leaseId,binding:this.owner.binding},evidenceIds:[]};
   }else result=await this.executor.execute(c,(command,check)=>this.perform(command,check));
  }catch(e){result={requestId:c?.context?.requestId,phase:'rejected',error:{code:e.message,message:e.message,...(e.message==='LIST_CONDITIONS_CHANGED'?{details:e.details}:{})},evidenceIds:[]};}
  this.owner.status=result.phase==='observed'?'已连接：'+c.tool:result.error?.code;
  this.owner.port?.postMessage({kind:'result',result});
 }
}
