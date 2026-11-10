import type {BaseCheckpointSaver} from '@langchain/langgraph';
import {searchBlockers} from './search-policy.js';
import type {PageWorkflowStore,PageJob} from '../boss-extension/store.js';import {parseSearchView} from '../boss-extension/search-protocol.js';import {queriesForPlan} from './search-plan.js';import {executeSearchEffect,verifyExpectedPhrase,type SearchActionClient} from './search-effects.js';import type {SearchStateData} from './search-state.js';
export type SearchGraphDependencies={pageStore:PageWorkflowStore;client:SearchActionClient;signal:AbortSignal;checkpointer:BaseCheckpointSaver;onEvent?:(event:{batchId:string;node:string;status:string;stopReason?:string})=>void};
export function searchNodes(deps:SearchGraphDependencies){
 const store=deps.pageStore.search;
 const call=async(s:SearchStateData,tool:string,payload:Record<string,unknown>={},suffix='')=>{const r=await executeSearchEffect({store,client:deps.client,signal:deps.signal},s.batchId,`${s.batchId}:${s.step}:${tool}${suffix}`,tool,payload);if(r.phase!=='observed')throw Error(r.error?.code??'RESULT_UNKNOWN');return r.value;};
 const check=(s:SearchStateData)=>{deps.signal.throwIfAborted();const b=store.getBatch(s.batchId);if(b.activeMs>=1800000)throw Error('ACTIVE_TIME_LIMIT');return b;};
 const safe=(node:string,fn:(s:SearchStateData)=>Promise<SearchStateData>)=>async({data}:{data:SearchStateData})=>{
  deps.onEvent?.({batchId:data.batchId,node,status:'running'});
  try{if(node!=='summarize')check(data);const next=await fn({...data});return {data:{...next,step:data.step+1}};}catch(e){
   const code=e instanceof Error&&/^[A-Z_]+(?::[A-Z_]+)?$/.test(e.message)?e.message:'ACTION_UNVERIFIED';
   if(data.attemptId){const prior=deps.pageStore.getAttempt(data.attemptId);if(prior&&!['confirmed','failed','skipped'].includes(prior.phase)){
    const ops=store.operations(data.batchId);const maybeSent=ops.some(o=>o.operationKey.startsWith(`${data.batchId}:`)&&['choose_first_phrase','submit_filled_phrase'].includes(o.tool)&&o.payload.conversationKey===data.chat?.conversationKey&&o.envelope);
    const unknownOpen=ops.some(o=>o.tool==='open_chat'&&o.payload.jobKey===data.currentJob?.key&&o.result?.phase!=='observed');
    deps.pageStore.updateAttempt(data.attemptId,maybeSent||unknownOpen?'uncertain':'skipped',{code});
   }}
   if(code.includes('QUOTA'))deps.pageStore.stop('QUOTA_REACHED',{code});
   store.setStatus(data.batchId,'paused',code);deps.onEvent?.({batchId:data.batchId,node,status:'paused',stopReason:code});return {data:{...data,status:'paused' as const,stopReason:code,step:data.step+1}};
  }
 };
 return {
  load_plan:safe('load_plan',async s=>{store.getPlan(store.getBatch(s.batchId).planId);return s;}),
  preflight:safe('preflight',async s=>{const blockers=searchBlockers(store.getBatch(s.batchId).mode,s.attemptId?deps.pageStore.getRecoveryBlockers(s.attemptId):deps.pageStore.getBlockers());if(blockers.length)throw Error(blockers[0]);store.setStatus(s.batchId,'running');return s;}),
  select_query:safe('select_query',async s=>{const b=store.getBatch(s.batchId),queries=queriesForPlan(store.getPlan(b.planId));if(b.mode==='run'&&b.usedContacts>=b.maxContacts)return {...s,status:'completed',stopReason:'CONTACT_LIMIT'};if(s.queryIndex>=queries.length)return {...s,status:'completed',stopReason:queries.length?'QUERIES_EXHAUSTED':'NO_ROLES'};return {...s,query:queries[s.queryIndex],queryDone:false,advance:false,candidates:[],currentJob:undefined,attemptId:undefined,chat:undefined,choice:undefined};}),
  search_and_filter:safe('search_and_filter',async s=>{const tool=s.advance?'list_jobs':'search_jobs';const raw=await call(s,tool,{...s.query!,...(s.advance?{advance:true}:{})});let view;try{view=parseSearchView(raw,s.query!);}catch{throw Error('FILTER_UNVERIFIED');}return {...s,view,advance:false,countNoNew:!!s.advance};}),
  collect_candidates:safe('collect_candidates',async s=>{
   const p=store.getQueryProgress(s.batchId,s.queryIndex);const replay=p as typeof p&{lastStep?:number;fresh?:PageJob[]};
   if(replay.lastStep===s.step)return {...s,candidates:replay.fresh??[],queryDone:p.exhausted};
   const page=s.view!,known=new Set(p.seenJobKeys),global=new Set(s.seenJobKeys);const fresh:PageJob[]=[];
   for(const raw of page.jobs){if(!known.has(raw.key)&&known.size<100)known.add(raw.key);if(known.has(raw.key)&&!global.has(raw.key)&&!fresh.some(j=>j.key===raw.key))fresh.push({...raw,url:raw.url??`https://www.zhipin.com/job_detail/${raw.key}.html`});}
   const noNew=known.size!==p.seenJobKeys.length?0:s.countNoNew?p.noNew+1:p.noNew;
   const exhausted=page.exhausted||known.size>=100||p.advances>=20||noNew>=3;
   store.saveQueryProgress(s.batchId,s.queryIndex,{seenJobKeys:[...known],advances:p.advances,noNew,exhausted,lastStep:s.step,fresh} as any);
   return {...s,candidates:fresh,queryDone:exhausted};
  }),
  select_candidate:safe('select_candidate',async s=>{
   const b=store.getBatch(s.batchId);if(b.mode==='preview')return {...s,candidates:[],queryDone:true,queryIndex:s.queryIndex+1};
   if(b.usedContacts>=b.maxContacts)return {...s,status:'completed',stopReason:'CONTACT_LIMIT'};
   const seen=new Set(s.seenJobKeys);while(s.candidates.length){const [job,...rest]=s.candidates;s.candidates=rest;seen.add(job.key);if(deps.pageStore.shouldSkip(job.key))continue;const detail=await call(s,'open_job',{jobKey:job.key});
    if(detail?.status==='unavailable'||detail?.alreadyContacted)return {...s,seenJobKeys:[...seen],currentJob:undefined,skipCurrent:true};
    if(detail?.key!==job.key||!detail?.recruiter)throw Error('JOB_IDENTITY_UNVERIFIED');
    return {...s,seenJobKeys:[...seen],currentJob:job,skipCurrent:false};
   }
   if(!s.queryDone){const p=store.getQueryProgress(s.batchId,s.queryIndex);store.saveQueryProgress(s.batchId,s.queryIndex,{...p,advances:p.advances+1});return {...s,seenJobKeys:[...seen],currentJob:undefined,advance:true};}
   return {...s,seenJobKeys:[...seen],currentJob:undefined,queryIndex:s.queryIndex+1};
  }),
  reserve_contact:safe('reserve_contact',async s=>{const r=store.reserveContact(s.batchId,s.currentJob!,`${s.batchId}:contact:${s.currentJob!.key}`);return {...s,attemptId:r?.attemptId,skipCurrent:!r};}),
  open_chat:safe('open_chat',async s=>{const chat=await call(s,'open_chat',{jobKey:s.currentJob!.key});if(chat?.status==='unavailable'){deps.pageStore.updateAttempt(s.attemptId!,'skipped',{code:chat.reason});return {...s,skipCurrent:true};}if(chat?.conversationKey!==s.currentJob!.key||!chat?.recruiter)throw Error('CHAT_IDENTITY_UNVERIFIED');deps.pageStore.updateAttempt(s.attemptId!,'chat_open',undefined,chat.conversationKey);return {...s,chat};}),
  verify_phrase:safe('verify_phrase',async s=>{const t=store.getTemplate(store.getBatch(s.batchId).templateId!);let poll=0;const reader:SearchActionClient={result:id=>deps.client.result(id),searchAction:(tool,payload)=>call(s,tool,payload,`:${poll++}`)};const phrase=await verifyExpectedPhrase(reader,s.chat!.conversationKey,t,deps.signal);if(phrase.hash!==t.normalizedHash)throw Error('FIRST_PHRASE_CHANGED');return s;}),
  send_once:safe('send_once',async s=>{deps.pageStore.updateAttempt(s.attemptId!,'sending');const b=store.getBatch(s.batchId);const payload={conversationKey:s.chat!.conversationKey,expectedHash:b.expectedPhraseHash!};const chosen=await call(s,'choose_first_phrase',payload);if(chosen?.status==='filled'){const sent=await call(s,'submit_filled_phrase',payload);if(sent?.status!=='submitted')throw Error('SEND_UNCONFIRMED');}else if(chosen?.status!=='submitted')throw Error('SELECTION_UNKNOWN');return {...s,choice:'submitted'};}),
  inspect_result:safe('inspect_result',async s=>{const result=await call(s,'inspect_send_result',{conversationKey:s.chat!.conversationKey,expectedHash:store.getBatch(s.batchId).expectedPhraseHash!});if(!['confirmed','failed'].includes(result?.status))throw Error('SEND_UNCONFIRMED');deps.pageStore.updateAttempt(s.attemptId!,result.status,{status:result.status});return s;}),
  restore_search:safe('restore_search',async s=>{const raw=await call(s,'restore_search',{...s.query!});try{parseSearchView(raw,s.query!);}catch{throw Error('FILTER_UNVERIFIED');}return {...s,view:raw,countNoNew:false,currentJob:undefined,attemptId:undefined,chat:undefined,choice:undefined,skipCurrent:false,candidates:[]};}),
  summarize:safe('summarize',async s=>{const status=s.status==='paused'?'paused':'completed';store.setStatus(s.batchId,status,s.stopReason??'QUERIES_EXHAUSTED');return {...s,status};})
 };
}
