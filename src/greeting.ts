import {guard,Stop,evidence,type BossPages,type Account,type Job,type Template,type SendResult} from './domain.js';
import type {Store} from './storage/store.js';
type Base={pages:BossPages;store:Store;account:Account;template:Template;signal:AbortSignal};
export async function greetOne(i:Base & {runId:string;job:Job;onOpened?:()=>void}):Promise<SendResult>{
 const {pages,store,account,job,template,signal}=i;
 if(store.shouldSkip(account.key,job))return {status:'skipped',evidence:evidence('已有操作记录，避免重复',job.url)};
 await guard(pages,account,signal);
 const a=store.reserve(i.runId,account.key,job,template);
 try{
  await guard(pages,account,signal);
  const c=await pages.openChat(job);
  i.onOpened?.();
  store.updateAttempt(a.id,'chat_open',evidence('已打开会话；不代表目标常用语已发送',c.url),c.key,c.url);
  await guard(pages,account,signal);
  const view=await pages.inspectChat(c,template);
  if(!view.identityMatches)throw new Stop('identity','会话身份无法核对',view.evidence);
  if(view.platformGreeting)store.recordEvent(account.key,a.id,'platform_greeting',view.evidence);
  if(store.shouldSkip(account.key,job,c.key,a.id)){
   store.updateAttempt(a.id,'skipped',view.evidence);return {status:'skipped',evidence:view.evidence};
  }
  if(view.templateStatus!=='absent'){
   const status=view.templateStatus==='confirmed'?'confirmed':'unconfirmed';store.updateAttempt(a.id,status==='confirmed'?'skipped':status,view.evidence);
   return {status:status==='confirmed'?'skipped':status,evidence:view.evidence};
  }
  if(view.existingConversation)throw new Stop('identity','已有会话无法排除重复沟通，停止发送',view.evidence);
  await guard(pages,account,signal);store.updateAttempt(a.id,'sending');
  const selection=await pages.chooseTemplate(template);
  if(selection==='filled'){await guard(pages,account,signal);await pages.submitFilledTemplate(template);}
  const result=selection==='unknown'?{status:'unconfirmed' as const,evidence:evidence('选择后的状态不明确，未追加发送',c.url)}:await pages.verifyTemplate(template);
  store.updateAttempt(a.id,result.status==='skipped'?'confirmed':result.status,result.evidence);return result;
 }catch(e){
  store.updateAttempt(a.id,'unconfirmed',e instanceof Stop&&e.evidence?e.evidence:evidence(e instanceof Error?e.message:'未知异常',job.url));
  // A write may have reached the server. Do not replay this job.
  throw e;
 }
}
export async function reconcile(i:Base):Promise<void>{
 for(const a of i.store.pending(i.account.key)){
  await guard(i.pages,i.account,i.signal);
  if(a.templateHash!==i.template.hash)continue;
  const c=await i.pages.reopenAttempt(a);if(!c)continue;
  await guard(i.pages,i.account,i.signal);
  const view=await i.pages.inspectChat(c,i.template);
  if(view.identityMatches&&view.templateStatus==='confirmed')i.store.updateAttempt(a.id,'confirmed',view.evidence,c.key,c.url);
  else i.store.updateAttempt(a.id,'unconfirmed',view.evidence);
 }
}
