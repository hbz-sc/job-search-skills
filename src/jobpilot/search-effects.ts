import {randomUUID} from 'node:crypto';import {setTimeout as delay} from 'node:timers/promises';
import type {SearchStore} from './search-store.js';import {normalizePhrase} from './search-store.js';import {hash} from './evidence.js';import type {GreetingTemplate} from './search-types.js';
import {canAutoRecover,recoveryCode} from './search-recovery.js';
export type SearchEffectResult={phase:'observed'|'uncertain'|'rejected';value?:any;error?:{code:string}};
export interface SearchActionClient{searchAction(tool:string,payload:Record<string,unknown>,requestId:string,beforeDispatch?:(envelope:unknown)=>void):Promise<any>;result(requestId:string):Promise<unknown>}
export type SearchEffectDependencies={store:SearchStore;client:SearchActionClient;signal:AbortSignal};
const pointerDiagnostic=/^(?:DEBUGGER_(?:PERMISSION_REQUIRED|ATTACH_FAILED|ATTACH_TIMEOUT|DETACHED|INPUT_TIMEOUT|INPUT_FAILED|CHECK_TIMEOUT|CLEANUP_FAILED)|EXPERIENCE_(?:POINTER_BUSY|CONTROL_AMBIGUOUS|TARGET_HIDDEN|TARGET_OFFSCREEN|TARGET_COVERED|TARGET_MOVED|MENU_NOT_OPEN|OPTION_AMBIGUOUS|SELECTION_UNVERIFIED|SELECTION_UNCHANGED|SELECTION_CHANGED|INVALID_POINT|QUERY_MISMATCH|OBSERVE_TIMEOUT|FOREGROUND_UNAVAILABLE))$/;
export async function reconcileSearchEffect(deps:SearchEffectDependencies,operationKey:string):Promise<SearchEffectResult>{
 const op=deps.store.getOperation(operationKey);if(!op)throw Error('OPERATION_NOT_FOUND');deps.signal.throwIfAborted();
 if(op.result?.phase==='observed'||op.result?.phase==='rejected')return op.result;
 try{const r=await deps.client.result(op.requestId) as any;
 if(r?.requestId===op.requestId&&r.phase==='uncertain'&&['search_jobs','restore_search','list_jobs'].includes(op.tool)&&(pointerDiagnostic.test(r.error?.code??'')||r.error?.code==='MANUAL_EXPERIENCE_REQUIRED')){
  const result:SearchEffectResult={phase:'uncertain',error:{code:r.error.code}};deps.store.finishOperation(op.operationId,result);return result;
 }
 if(r?.requestId===op.requestId&&['observed','rejected'].includes(r.phase)){
  const result:SearchEffectResult={phase:r.phase,...(r.phase==='observed'?{value:r.value}:{error:{code:r.error?.code??'ACTION_REJECTED'}})};deps.store.finishOperation(op.operationId,result);return result;
 }}catch{}
 return {phase:'uncertain',error:{code:'RESULT_UNKNOWN'}};
}
export async function executeSearchEffect(deps:SearchEffectDependencies,batchId:string,operationKey:string,tool:string,payload:Record<string,unknown>):Promise<SearchEffectResult>{
 deps.signal.throwIfAborted();const existed=deps.store.getOperation(operationKey);const op=deps.store.beginOperation(batchId,operationKey,tool,payload);
 if(existed)return reconcileSearchEffect(deps,operationKey);
 const remaining=1800000-deps.store.getBatch(batchId).activeMs;if(remaining<=0)throw Error('ACTIVE_TIME_LIMIT');
 const segmentId=randomUUID(),reserved=Math.min(60000,remaining);deps.store.addActiveTime(batchId,segmentId,reserved);const start=performance.now(),until=Date.now()+reserved;
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  const value=await Promise.race([deps.client.searchAction(tool,payload,op.requestId,envelope=>{
   deps.signal.throwIfAborted();if(Date.now()>=until)throw Error('ACTIVE_TIME_LIMIT');
   const e=envelope as {context?:{deadline?:string}};if(e.context?.deadline)e.context.deadline=new Date(Math.min(until,Date.parse(e.context.deadline))).toISOString();
   deps.store.markDispatched(op.operationId,envelope);
  }),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('ACTION_TIMEOUT')),reserved);})]);
  const result:SearchEffectResult={phase:'observed',value};deps.store.finishOperation(op.operationId,result);return result;
 }catch(e){
  const result=await reconcileSearchEffect(deps,operationKey);const code=recoveryCode(e);
  if(result.phase==='uncertain'&&canAutoRecover(code)){
   const sent=Boolean(deps.store.getOperation(operationKey)?.envelope);
   const safe=['search_jobs','list_jobs','restore_search','open_job','read_first_phrase','inspect_chat','inspect_send_result'].includes(tool);
   if(!sent||safe){const classified:SearchEffectResult={phase:sent?'uncertain':'rejected',error:{code}};deps.store.finishOperation(op.operationId,classified);return classified;}
  }
  deps.store.finishOperation(op.operationId,result);return result;
 }finally{if(timer)clearTimeout(timer);deps.store.finishActiveSegment(batchId,segmentId,performance.now()-start);}
}
export async function verifyExpectedPhrase(client:SearchActionClient,conversationKey:string,template:GreetingTemplate,signal:AbortSignal,intervalMs=500){
 for(let i=0;i<6;i++){
  signal.throwIfAborted();const phrase=await client.searchAction('read_first_phrase',{conversationKey},randomUUID());
  if(typeof phrase?.text==='string'&&phrase.text.trim()&&hash(phrase.text)===phrase.hash&&hash(normalizePhrase(phrase.text))===template.normalizedHash)return {text:phrase.text,hash:phrase.hash};
  if(i<5)await delay(intervalMs,undefined,{signal});
 }throw Error('FIRST_PHRASE_CHANGED');
}
