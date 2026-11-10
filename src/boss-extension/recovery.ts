import type {PageWorkflowStore,PageJob} from './store.js';
import type {ActionClient} from './workflow.js';
type Attempt=NonNullable<ReturnType<PageWorkflowStore['getAttempt']>>;
export function skipAuditedUnsent(store:PageWorkflowStore,id:string,audit:any){
 const attempt=store.getAttempt(id);if(!attempt)throw Error('ATTEMPT_NOT_FOUND');
 proveUnsentRecovery(attempt,audit);
 store.updateAttempt(id,'skipped',{reason:'opened_without_phrase_send',priorRun:attempt.runId,diagnosticRun:audit.diagnostic.runId,sendConfirmed:false});
}
export function proveUnsentRecovery(attempt:Attempt,audit:any){
 const events=audit?.diagnostic?.events;
 if(attempt.phase!=='uncertain'||attempt.phrase||audit?.workflow?.runId!==attempt.runId||audit?.workflow?.diagnosticRunId!==audit?.diagnostic?.runId||!Array.isArray(events)||!events.some((e:any)=>e.stage==='mcp_received'&&e.tool==='open_chat')||events.some((e:any)=>e.stage==='mcp_received'&&['choose_first_phrase','submit_filled_phrase'].includes(e.tool)))throw Error('RECOVERY_NOT_PROVEN_UNSENT');
}
export async function recoverGreeting(client:ActionClient,store:PageWorkflowStore,attempt:Attempt,audit:any,target:PageJob&{recruiter:string},signal:AbortSignal,log:(s:string)=>void=()=>{},currentChat=false){
 proveUnsentRecovery(attempt,audit);if(store.getRecoveryBlockers(attempt.id).length)throw Error('OTHER_RECOVERY_BLOCKERS');
 if(target.key!==attempt.job.key||target.title!==attempt.job.title||target.company!==attempt.job.company||!target.recruiter)throw Error('RECOVERY_TARGET_MISMATCH');
 let confirmed=false;const call=(tool:string,payload:Record<string,unknown>={})=>{signal.throwIfAborted();log(tool);return client.action(tool,payload);};
 try{
  let chat;
  if(currentChat)chat=await call('inspect_chat',{conversationKey:target.key});
  else{
   await call('restore_search');
   const detail=await call('open_job',{jobKey:target.key});
   if(!detail.alreadyContacted||detail.key!==target.key||detail.title!==target.title||detail.company!==target.company||detail.recruiter!==target.recruiter)throw Error('EXISTING_CHAT_NOT_PROVEN');
   chat=await call('open_chat',{jobKey:target.key});
  }
  if(chat.title!==target.title||chat.company!==target.company||chat.recruiter!==target.recruiter||chat.conversationKey!==target.key)throw Error('RECOVERY_CHAT_MISMATCH');
  const phrase=await call('read_first_phrase',{conversationKey:chat.conversationKey});
  if(!phrase.text?.trim()||!/^[a-f0-9]{64}$/.test(phrase.hash))throw Error('INVALID_PHRASE');
  store.pinPhrase(attempt.id,phrase);store.updateAttempt(attempt.id,'sending',{recovery:true},chat.conversationKey);
  const payload={conversationKey:chat.conversationKey,expectedHash:phrase.hash};
  const chosen=await call('choose_first_phrase',payload);
  if(chosen.status==='filled')await call('submit_filled_phrase',payload);else if(chosen.status!=='submitted')throw Error('SELECTION_UNKNOWN');
  const result=await call('inspect_send_result',payload);if(result.status!=='confirmed')throw Error('SEND_UNCONFIRMED');
  store.updateAttempt(attempt.id,'confirmed',{recovery:true,status:'confirmed'});confirmed=true;
  await call('restore_search');return {confirmed:1,stopReason:'RECOVERY_VERIFIED'};
 }catch(e){if(!confirmed)store.updateAttempt(attempt.id,'uncertain',{recovery:true,code:e instanceof Error?e.message:'RECOVERY_FAILED'});throw e;}
}
