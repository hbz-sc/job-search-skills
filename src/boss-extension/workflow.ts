import {assertPageRunPolicy,type PageScope,type QuotaRetry} from './run-policy.js';
import type {PageWorkflowStore,PageJob,Phrase} from './store.js';
export type ActionClient={action(tool:string,payload?:Record<string,unknown>):Promise<any>};
export type WorkflowOptions={continueOnSendFailure?:boolean;continueOnPendingSend?:boolean};
export async function runWorkflow(client:ActionClient,store:PageWorkflowStore,scope:PageScope,profile:Record<string,unknown>,sendAuthorized:boolean,signal:AbortSignal,log:(message:string)=>void=()=>{},quotaRetry?:QuotaRetry,options:WorkflowOptions={}){
 assertPageRunPolicy(scope,profile,store.getBlockers(),sendAuthorized,quotaRetry);
 const run=store.beginRun(scope);const seen=new Set<string>();const traversedWithoutNew=new Set<string>();
 const summary={runId:run,discovered:0,skipped:0,contacted:0,confirmed:0,failed:0,pending:0,uncertain:0,stopReason:''};let active:string|undefined;let pinned:string|undefined;
 let sendDispatched=false;
 const call=async(tool:string,payload:Record<string,unknown>={})=>{
  signal.throwIfAborted();log(tool);
  // Mark before dispatch: a transport timeout does not prove the send failed.
  if(tool==='choose_first_phrase'||tool==='submit_filled_phrase')sendDispatched=true;
  return client.action(tool,payload);
 };
 try{
  let page=await call('search_jobs',{city:'深圳',keyword:'AI应用开发工程师'});
  if(scope.mode==='search_only'){
   summary.discovered=page.jobs.length;
   if(page.jobs.length){
    const detail=await call('open_job',{jobKey:page.jobs[0].key});
    if(detail.status==='unavailable'){summary.skipped++;await call('restore_search');summary.stopReason='JOB_LIST_CHANGED';return summary;}
   }
   await call('restore_search');summary.stopReason=page.jobs.length?'SEARCH_VERIFIED':'NO_RESULTS';return summary;
  }
  while(!signal.aborted){
   if(!Array.isArray(page.jobs))throw Error('INVALID_JOB_PAGE');
   const fresh:PageJob[]=page.jobs.filter((j:PageJob)=>!seen.has(j.key));
   if(!fresh.length){
    const signature=JSON.stringify(page.jobs.map((j:PageJob)=>j.key));
    if(page.exhausted||traversedWithoutNew.has(signature)){summary.stopReason='NO_NEW_JOBS';break;}
    traversedWithoutNew.add(signature);page=await call('list_jobs',{advance:true});continue;
   }
   traversedWithoutNew.clear();let restored=false;
   for(const job of fresh){
    seen.add(job.key);summary.discovered++;
    if(store.shouldSkip(job.key)){summary.skipped++;continue;}
    assertPageRunPolicy(scope,profile,store.getBlockers(),sendAuthorized,quotaRetry);
    if(summary.contacted>=scope.maxContacts){summary.stopReason='CONTACT_LIMIT';break;}
    const detail=await call('open_job',{jobKey:job.key});
    if(detail.status==='unavailable'){
     summary.skipped++;log('职位列表已更新，跳过旧职位并重新读取：'+detail.reason);
     page=await call('list_jobs',{advance:false});restored=true;break;
    }
    if(detail.alreadyContacted){summary.skipped++;continue;}
    active=store.reserveContact(run,job);sendDispatched=false;summary.contacted++;
    const chat=await call('open_chat',{jobKey:job.key});
    if(chat.status==='unavailable'){
     store.updateAttempt(active,'skipped',{reason:'detail_unavailable_before_communication',code:chat.reason,retry:false});
     active=undefined;summary.skipped++;log('未发送，跳过当前职位：'+chat.reason);
     page=await call('restore_search');restored=true;
     if(summary.contacted>=scope.maxContacts)summary.stopReason='CONTACT_LIMIT';
     break;
    }
    store.updateAttempt(active,'chat_open',{existingMessages:chat.existingMessages??0},chat.conversationKey);
    let phrase:Phrase=await call('read_first_phrase',{conversationKey:chat.conversationKey});
    // BOSS briefly renders default phrases before saved phrases arrive.
    // Re-read only; never click a different phrase during that transition.
    if(!pinned){
     let stable=false;
     for(let poll=0;poll<5;poll++){
      await new Promise(r=>setTimeout(r,500));
      const next:Phrase=await call('read_first_phrase',{conversationKey:chat.conversationKey});
      stable=next.hash===phrase.hash;phrase=next;if(stable)break;
     }
     if(!stable)throw Error('FIRST_PHRASE_NOT_STABLE');
    }
    for(let poll=0;pinned&&pinned!==phrase.hash&&poll<5;poll++){
     await new Promise(r=>setTimeout(r,500));
     phrase=await call('read_first_phrase',{conversationKey:chat.conversationKey});
    }
    if(!phrase.text?.trim()||!phrase.hash)throw Error('EMPTY_PHRASE');
    if(pinned&&pinned!==phrase.hash)throw Error('FIRST_PHRASE_CHANGED');pinned=phrase.hash;store.pinPhrase(active,phrase);
    store.updateAttempt(active,'sending');const payload={conversationKey:chat.conversationKey,expectedHash:phrase.hash};
    const chosen=await call('choose_first_phrase',payload);
    if(chosen.status==='filled')await call('submit_filled_phrase',payload);
    else if(chosen.status!=='submitted')throw Error('SELECTION_UNKNOWN');
    let sent=await call('inspect_send_result',payload);
    for(let poll=0;sent.status==='pending'&&poll<2;poll++){await new Promise(r=>setTimeout(r,1000));sent=await call('inspect_send_result',payload);}
    if(sent.status==='confirmed'){store.updateAttempt(active,'confirmed',{status:'confirmed',jobKey:job.key});summary.confirmed++;}
    else if(sent.status==='failed'&&options.continueOnSendFailure){store.updateAttempt(active,'failed',{status:'failed',jobKey:job.key,retry:false});summary.failed++;}
    else if(sent.status==='pending'&&options.continueOnPendingSend){store.updateAttempt(active,'deferred',{status:'pending',jobKey:job.key,retry:false,userAuthorizedContinue:true});summary.pending++;}
    else throw Error('SEND_UNCONFIRMED');
    active=undefined;log(`进度：${summary.contacted}/${scope.maxContacts}，送达 ${summary.confirmed}，失败 ${summary.failed}，待确认 ${summary.pending}`);
    page=await call('restore_search');restored=true;
    if(summary.contacted>=scope.maxContacts){summary.stopReason='CONTACT_LIMIT';break;}
    // Rebuild candidates from the actually restored list. Same-tab navigation
    // may have reset pagination; never act on the previous page's snapshot.
    break;
   }
   if(summary.stopReason)break;
   if(restored)continue;
   page=await call('list_jobs',{advance:true});
  }
  if(signal.aborted)throw Error('USER_STOPPED');
 }catch(e){
  summary.stopReason=signal.aborted?'USER_STOPPED':e instanceof Error?e.message:'UNKNOWN_FAILURE';
  if(active){
   if(sendDispatched){store.updateAttempt(active,'uncertain',{code:summary.stopReason});summary.uncertain++;}
   else{
    store.updateAttempt(active,'skipped',{code:summary.stopReason,reason:'before_phrase_send',retry:false});
    summary.skipped++;
   }
  }
  if(summary.stopReason.includes('QUOTA'))store.stop('QUOTA_REACHED',{code:summary.stopReason});
 }finally{store.finishRun(run,summary);}
 return summary;
}
