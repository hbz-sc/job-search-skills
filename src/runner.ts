import {setTimeout as delay} from 'node:timers/promises';
import {randomUUID} from 'node:crypto';
import {guard,Stop,evidence,template as hashText,type BossPages,type RunConfig,type StopReason,type Template,type Account} from './domain.js';
import {assertAuthorized,type RunAuthorization} from './authorization.js';
import type {Store} from './storage/store.js';
import {greetOne,reconcile} from './greeting.js';
import {saveDiagnostic} from './diagnostics.js';
export type RunSummary={runId:string;discovered:number;opened:number;confirmed:number;unconfirmed:number;skipped:number;stopReason:StopReason};
export async function run(i:{config:RunConfig;pages:BossPages;store:Store;signal:AbortSignal;resume:boolean;authorization?:RunAuthorization;legacySent?:Set<string>;log?:(s:string)=>void}):Promise<RunSummary>{
 const {config:c,pages,store,signal}=i;const log=i.log??console.log;
 const result:RunSummary={runId:'',discovered:0,opened:0,confirmed:0,unconfirmed:0,skipped:0,stopReason:'exhausted'};
 const seen=new Set<string>();let processed=0;let t:Template|undefined;let account:Account|undefined;
 try{
  if(signal.aborted)throw new Stop('user','用户停止');
  account=await pages.account();const state=await pages.state();if(state.kind!=='ready')throw new Stop(state.kind,'页面阻断：'+state.kind,state.evidence);
  if(!account)throw new Stop('identity','无法从页面确认稳定账号标识，停止操作');
  if(c.mode==='send'){
   const latch=store.getQuota(account.key);
   if(latch?.reason==='legacy_unverified')throw new Stop('identity','旧额度记录的账号归属尚未确认');
   if(latch&&!i.resume)throw new Stop('quota','历史额度停止尚未主动恢复，请核对平台状态后使用 --resume');
   if(!i.authorization)throw new Stop('authorization','当前人工模式：需要本轮明确发送授权');
   t=await pages.readInitialTemplate();
  }
  result.runId=store.beginRun(account,c,t);
  log('模式：'+c.mode+'；城市：'+c.city+'；关键词：'+c.keywords.join('、'));
  if(t)log('本轮固定常用语：\n'+t.text);
  log('停止条件：平台上限、验证/登录、身份不符、发送待确认、结果耗尽、Ctrl+C'+(c.maxJobs?'、最多 '+c.maxJobs+' 个职位':''));
  if(t){await reconcile({pages,store,account,template:t,signal});if(store.pending(account.key).length)throw new Stop('identity','仍有待确认发送，请先人工核对记录，程序不会重发');await pages.restoreSearch();}
  let errors=0;
  const read=async<T>(f:()=>Promise<T>):Promise<T>=>{
   for(let n=0;;n++){await guard(pages,account!,signal);try{const v=await f();errors=0;return v;}catch(e){if(e instanceof Stop)throw e;errors++;if(errors>=c.consecutiveErrorLimit||n>=c.readRetries)throw new Stop('errors','读取连续失败，停止');}}
  };
  for(const keyword of c.keywords){
   const search=await read(()=>pages.search(c.city,keyword));log('实际网页筛选：'+search.filters);
   if(t){assertAuthorized(i.authorization,account,c,t,hashText(search.filters||'（无额外筛选）').hash);await guard(pages,account,signal);if(i.resume&&store.getQuota(account.key))store.releaseQuota(account.key,evidence('用户明确恢复；只读检查未见阻断，不保证平台额度已恢复'));}
   let idle=0;
   while(idle<c.noProgressLimit){
    const jobs=await read(()=>pages.visibleJobs());store.saveJobs(jobs);
    const fresh=jobs.filter(j=>!seen.has(j.key));idle=fresh.length?0:idle+1;
    for(const job of fresh){
     if(seen.has(job.key))continue;seen.add(job.key);result.discovered++;
     await guard(pages,account,signal);
     if(c.maxJobs!==undefined&&processed>=c.maxJobs)throw new Stop('maximum','达到本轮最大处理量');
     processed++;
     if(c.mode==='send'&&t){
      if(i.legacySent?.has(job.key)||i.legacySent?.has(job.url)||store.shouldSkip(account.key,job)){result.skipped++;continue;}
      await pages.assertSearchScope({city:c.city,keyword,filtersHash:i.authorization!.filtersHash});
      log('处理：'+job.company+' / '+job.title);
      const r=await greetOne({pages,store,account,job,template:t,runId:result.runId,signal,onOpened:()=>{result.opened++;}});
      result[r.status==='skipped'?'skipped':r.status]++;
      if(r.status==='unconfirmed')throw new Stop('errors','发送结果待确认，停止后续发送',r.evidence);
      await guard(pages,account,signal);await pages.restoreSearch();
      if(c.intervalMs)await delay(c.intervalMs,undefined,{signal});
     }
     if(c.maxJobs!==undefined&&processed>=c.maxJobs)throw new Stop('maximum','达到本轮最大处理量');
    }
    if(idle>=c.noProgressLimit)break;
    if(!await read(()=>pages.advanceList()))break;
    // Allow virtualized lists to render; this is bounded, abortable, and never a send retry.
    await delay(Math.min(c.intervalMs,500),undefined,{signal});
   }
  }
  store.stopRun(result.runId,'exhausted');
 }catch(e){
  const stop=signal.aborted?new Stop('user','用户停止'):e instanceof Stop?e:new Stop('errors',e instanceof Error?e.message:'未知异常');
  result.stopReason=stop.reason;
  const ev=stop.evidence??await pages.captureDiagnostic(stop.message).catch(()=>evidence(stop.message));
  if(result.runId)store.stopRun(result.runId,stop.reason,ev);
  if(stop.reason==='quota'&&account)store.latchQuota(account.key,'quota',ev);
  await saveDiagnostic({root:c.outputDir,accountKey:account?.key,runId:result.runId||randomUUID()},ev).catch(()=>{});log('停止：'+stop.message);
 }
 return result;
}
