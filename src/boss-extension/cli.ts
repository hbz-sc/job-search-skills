import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {BossExtensionClient} from './client.js';
import {assertPageRunPolicy,shanghaiDate,type PageScope,type QuotaRetry} from './run-policy.js';
import {openPageWorkflowStore} from './store.js';
import {runWorkflow,type WorkflowOptions} from './workflow.js';
import {acquireRunLock} from '../run-lock.js';

const [command='doctor',...args]=process.argv.slice(2);
if(command==='doctor')await import('./doctor.js');
else if(command==='resume-greeting')await import('./recover-cli.js');
else{
 if(!['search-test','greet-once','batch'].includes(command))throw Error('支持 doctor / search-test / greet-once / batch');
 const scope:PageScope={mode:command==='search-test'?'search_only':command==='greet-once'?'greet_once':'batch',maxContacts:command==='greet-once'?1:0};
 let authorized=false,retryHistorical=false;let quotaRetry:QuotaRetry|undefined;const options:WorkflowOptions={};
 for(let i=0;i<args.length;i++){
  if(args[i]==='--confirm-send')authorized=true;
  else if(args[i]==='--continue-on-send-failure'&&command==='batch')options.continueOnSendFailure=true;
  else if(args[i]==='--continue-on-pending-send'&&command==='batch')options.continueOnPendingSend=true;
  else if(args[i]==='--retry-historical-quota'&&command!=='search-test')retryHistorical=true;
  else if(args[i]==='--max-contacts'&&command==='batch'){scope.maxContacts=Number(args[++i]);}
  else throw Error('INVALID_OPTION:'+args[i]);
 }
 const profile=JSON.parse(await readFile('private/profile.json','utf8'));
 const unlock=await acquireRunLock(path.resolve('private/boss-run-lock.sqlite'));
 const abort=new AbortController();let client:BossExtensionClient|undefined;let store:ReturnType<typeof openPageWorkflowStore>|undefined;let runId:string|undefined;
 const stop=()=>{abort.abort();void client?.close().catch(()=>{});};process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{
  store=openPageWorkflowStore(path.resolve('data/boss.sqlite'));
  // An explicit new request may retry an older dated quota, never a current
  // stop or unresolved contact. Keep the historical profile unchanged.
  assertPageRunPolicy(scope,retryHistorical?{}:profile,store.getBlockers(),authorized);
  client=await BossExtensionClient.connect(path.resolve('private/boss-extension/discovery.json'));
  if(retryHistorical){
   const preflightId=randomUUID(),reading=await client.inspect(preflightId);
   const page=reading.value;
   if(reading.phase!=='observed'||!page||page.pageKind!=='jobs'||page.searchBox.count!==1||page.blockers.length)throw Error('QUOTA_RETRY_PAGE_NOT_READY');
   quotaRetry={authorizedOn:shanghaiDate(),pageChecked:true};
   assertPageRunPolicy(scope,profile,store.getBlockers(),authorized,quotaRetry);
   const dir=path.resolve('private/boss-extension/diagnostics',preflightId);await mkdir(dir,{recursive:true});
   await writeFile(path.join(dir,'quota-preflight.json'),JSON.stringify({historicalDate:profile.greeting_quota_exhausted_date,...quotaRetry,binding:page.binding,blockers:page.blockers,availability:'unknown_until_platform_action'},null,2)+'\n');
  }
  runId=await client.startWorkflow(scope);
  console.log('操作当前已连接页面；关键词：AI应用开发工程师；城市：深圳；范围：'+scope.mode+'；诊断 runId='+runId);
  const summary=await runWorkflow(client,store,scope,profile,authorized,abort.signal,s=>console.log('步骤：'+s),quotaRetry,options);
  await client.diagnostics(runId);
  const dir=path.resolve('private/boss-extension/diagnostics',runId);await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'workflow.json'),JSON.stringify({...summary,diagnosticRunId:runId,scope,options},null,2)+'\n');
  console.log(JSON.stringify(summary,null,2));console.log('诊断记录：'+dir);
  if(!['SEARCH_VERIFIED','NO_RESULTS','CONTACT_LIMIT','NO_NEW_JOBS'].includes(summary.stopReason))process.exitCode=1;
 }catch(e){console.error(e instanceof Error?e.message:'WORKFLOW_FAILED');if(client&&runId)await client.diagnostics(runId).catch(()=>{});process.exitCode=1;}
 finally{await client?.close().catch(()=>{});store?.close();await unlock();process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
