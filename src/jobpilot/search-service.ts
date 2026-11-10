import {readFile} from 'node:fs/promises';import path from 'node:path';import {randomUUID} from 'node:crypto';import {setTimeout as delay} from 'node:timers/promises';
import {BossExtensionClient} from '../boss-extension/client.js';import {openPageWorkflowStore} from '../boss-extension/store.js';import {assertPageRunPolicy,shanghaiDate} from '../boss-extension/run-policy.js';import {acquireRunLock} from '../run-lock.js';
import {openJobpilotStore} from './store.js';import {openCheckpointer} from './checkpointer.js';import {createModelAdapter,type ModelAdapter} from './model.js';import type {JobpilotConfig} from './config.js';import {planResumeSearch,prepareSearchResume,queriesForPlan} from './search-plan.js';import {SEARCH_PROMPT_VERSION} from './search-prompts.js';import {createSearchGraph} from './search-graph.js';import {searchReport,exportSearchReport} from './search-report.js';import type {SearchStateData} from './search-state.js';import {reconcileSearchEffect} from './search-effects.js';import {disableExternalTracing} from './privacy.js';
import {hash} from './evidence.js';
import {canAutoRecover,recoveryCode} from './search-recovery.js';
import {searchBlockers} from './search-policy.js';
type SearchClient=Pick<BossExtensionClient,'inspect'|'startSearchWorkflow'|'searchAction'|'result'|'close'>;
export type SearchServiceOptions={root:string;config:JobpilotConfig;model?:ModelAdapter;clientFactory?:()=>Promise<SearchClient>;recoveryDelayMs?:number;onEvent?:(e:{batchId:string;node:string;status:string;stopReason?:string})=>void};
export async function createSearchService(options:SearchServiceOptions){
 disableExternalTracing();const {root,config}=options;const page=openPageWorkflowStore(path.join(root,'data/boss.sqlite')),store=page.search;const modelStore=openJobpilotStore(path.join(root,'data/jobpilot/search-model.sqlite'),config.limits);const cp=await openCheckpointer(path.join(root,'data/jobpilot/search-checkpoints.sqlite'));
 const factory=options.clientFactory??(()=>BossExtensionClient.connect(path.join(root,'private/boss-extension/discovery.json')));const controller=new AbortController();
 const withLock=async<T>(fn:()=>Promise<T>):Promise<T>=>{const release=await acquireRunLock(path.join(root,'private/boss-run-lock.sqlite'));try{return await fn();}finally{await release();}};
 const readProfile=async()=>{try{return JSON.parse(await readFile(path.join(root,'private/profile.json'),'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return {};throw e;}};
 async function executeOnce(batchId:string,resuming=false,retryHistoricalQuota=false){
  const b=store.getBatch(batchId),plan=store.getPlan(b.planId);if(b.status==='completed')return searchReport(store,batchId);
  if(!queriesForPlan(plan).length){store.setStatus(batchId,'completed','NO_ROLES');return searchReport(store,batchId);}
  let client:SearchClient|undefined;
  try{
   client=await factory();const inspected=await client.inspect(randomUUID());if(inspected.phase!=='observed'||!inspected.value)throw Error('PAGE_UNVERIFIED');if(inspected.value.blockers.length)throw Error('PAGE_BLOCKED');
   if(inspected.value.binding)store.bindRecoveryTarget(batchId,{sessionId:inspected.value.binding.sessionId,tabId:inspected.value.binding.tabId});
   const profile=await readProfile();if(b.mode==='run')assertPageRunPolicy({mode:'batch',maxContacts:b.maxContacts},profile,[],true,retryHistoricalQuota?{authorizedOn:shanghaiDate(),pageChecked:true}:undefined);
   await client.startSearchWorkflow({mode:b.mode,batchId,planHash:b.planHash,allowedKeywords:plan.roles.map(r=>r.keyword),city:'深圳',experienceBands:['exp_1_3','exp_3_5'],maxContacts:b.maxContacts-b.usedContacts,expectedPhraseHash:b.expectedPhraseHash});
   const graph=createSearchGraph({pageStore:page,client,checkpointer:cp.saver,signal:controller.signal,onEvent:options.onEvent});
   let data:SearchStateData={batchId,queryIndex:0,step:0,seenJobKeys:[],candidates:[],status:'running'};
   if(resuming){
    const saved=await graph.getState({configurable:{thread_id:batchId}});if(saved.values?.data)data={...saved.values.data,status:'running',stopReason:undefined};
    // New lease has no transient chat state. Resolve old effects without replay,
    // then restart the current query safely, retaining the frozen budget/history.
    for(const attempt of store.attempts(batchId).filter(a=>!['confirmed','failed','skipped'].includes(a.phase))){
     const ops=store.operations(batchId).filter(o=>o.payload.jobKey===attempt.job.key||o.payload.conversationKey===attempt.job.key);
     const sendOps=ops.filter(o=>['choose_first_phrase','submit_filled_phrase'].includes(o.tool));
     if(sendOps.length){
      const inspection=ops.filter(o=>o.tool==='inspect_send_result').at(-1);const r=inspection?await reconcileSearchEffect({store,client,signal:controller.signal},inspection.operationKey):null;
      if(r?.phase==='observed'&&['confirmed','failed'].includes(r.value?.status))page.updateAttempt(attempt.attemptId,r.value.status,{reconciled:true,status:r.value.status});
      else{page.updateAttempt(attempt.attemptId,'uncertain',{code:'RESULT_UNKNOWN'});throw Error('RESULT_UNKNOWN');}
     }else{
      const opened=ops.find(o=>o.tool==='open_chat');const r=opened?await reconcileSearchEffect({store,client,signal:controller.signal},opened.operationKey):null;
      if(opened&&r?.phase==='uncertain'){page.updateAttempt(attempt.attemptId,'uncertain',{code:'RESULT_UNKNOWN'});throw Error('RESULT_UNKNOWN');}
      page.updateAttempt(attempt.attemptId,'skipped',{code:'RECONNECTED_BEFORE_SEND',retry:false});
     }
    }
    const largestStep=Math.max(data.step,...store.operations(batchId).map(o=>Number(o.operationKey.split(':')[1])||0));
    data={...data,step:largestStep+10,candidates:[],currentJob:undefined,attemptId:undefined,chat:undefined,choice:undefined,view:undefined,skipCurrent:false,advance:false,seenJobKeys:[...new Set([...data.seenJobKeys,...store.attempts(batchId).map(a=>a.job.key)])]};
   }
   const blockers=searchBlockers(b.mode,page.getBlockers());if(blockers.length)throw Error(blockers[0]);
   await graph.invoke({data},{configurable:{thread_id:batchId},recursionLimit:12000,durability:'sync'});
  }catch(e){store.setStatus(batchId,'paused',recoveryCode(e));}
  finally{await client?.close().catch(()=>{});}
  return searchReport(store,batchId);
 }
 async function execute(batchId:string,resuming=false,retryHistoricalQuota=false){
  for(;;){
   const report=await executeOnce(batchId,resuming,retryHistoricalQuota);
   if(report.batch.status!=='paused'||!canAutoRecover(report.batch.stopReason)||controller.signal.aborted)return report;
   let attempt:number;try{attempt=store.reserveRecovery(batchId);}catch(e){store.setStatus(batchId,'paused',recoveryCode(e));return searchReport(store,batchId);}
   const remaining=1800000-store.getBatch(batchId).activeMs;
   const waitMs=Math.min(remaining,Math.max(0,Math.min(4000,options.recoveryDelayMs??4000)));
   const segment=`recovery:${batchId}:${attempt}`,start=performance.now();store.addActiveTime(batchId,segment,waitMs);
   options.onEvent?.({batchId,node:'auto_reconnect',status:`retry_${attempt}_of_3`,stopReason:report.batch.stopReason});
   try{await delay(waitMs,undefined,{signal:controller.signal});}catch{store.setStatus(batchId,'paused','USER_STOPPED');return searchReport(store,batchId);}finally{store.finishActiveSegment(batchId,segment,performance.now()-start);}
   resuming=true;
  }
 }
 return {
  async plan(resumeText:string){const release=await acquireRunLock(path.join(root,'private/jobpilot/search-plan-lock.sqlite'));try{const resume=prepareSearchResume(resumeText);const cached=store.findPlan(resume.hash,config.model||'injected',SEARCH_PROMPT_VERSION);if(cached)return cached;const scopeId=`search-plan:${resume.hash}:${config.model}:${SEARCH_PROMPT_VERSION}`;modelStore.recoverPending(scopeId);const plan=await planResumeSearch(resumeText,{model:options.model??createModelAdapter(config),store:modelStore,scopeId,operationId:scopeId,limits:config.limits},config.model||'injected');store.savePlan(plan);return plan;}finally{await release();}},
  async bindTemplate(file:string){return store.bindTemplate(await readFile(path.resolve(root,file),'utf8'),'explicit-file:'+path.basename(file));},
  async captureFirstTemplate(){return withLock(async()=>{const client=await factory();try{
   const inspected=await client.inspect(randomUUID());if(inspected.phase!=='observed'||inspected.value?.blockers?.length)throw Error('PAGE_UNVERIFIED');
   await client.startSearchWorkflow({mode:'preview',batchId:randomUUID(),planHash:hash('read-existing-first-saved-phrase'),allowedKeywords:['Java开发工程师'],city:'深圳',experienceBands:['exp_1_3','exp_3_5'],maxContacts:0,expectedPhraseHash:null});
   let text:string|undefined;for(let i=0;i<3;i++){const value=await client.searchAction('read_saved_phrase',{},randomUUID());const next=value?.text;if(typeof next!=='string'||!next.trim())throw Error('FIRST_PHRASE_NOT_VISIBLE');if(next.replace(/\s/g,'')==='我可以把我的简历发给您看看吗？')throw Error('DEFAULT_PHRASE_NOT_READY');if(text!==undefined&&text!==next)throw Error('FIRST_PHRASE_CHANGED');text=next;if(i<2)await delay(500);}return store.bindTemplate(text!,'user-selected-first:visible-saved-menu');
  }finally{await client.close();}});},
  preview(planId:string){return withLock(async()=>execute(store.createBatch(planId,null,'preview',0).batchId));},
  run(planId:string,templateId:string,maxContacts=10,retryHistoricalQuota=false){return withLock(async()=>execute(store.createBatch(planId,templateId,'run',maxContacts).batchId,false,retryHistoricalQuota));},
  resume(batchId:string,retryHistoricalQuota=false){return withLock(async()=>execute(batchId,true,retryHistoricalQuota));},
  async status(batchId:string){return searchReport(store,batchId);},
  async export(batchId:string){return exportSearchReport(root,searchReport(store,batchId));},
  async close(){controller.abort();await cp.close();modelStore.close();page.close();}
 };
}
export type SearchService=Awaited<ReturnType<typeof createSearchService>>;
