import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {BossExtensionClient} from './client.js';
import {openPageWorkflowStore} from './store.js';
import {assertPageRunPolicy,shanghaiDate} from './run-policy.js';
import {proveUnsentRecovery,recoverGreeting} from './recovery.js';
import {acquireRunLock} from '../run-lock.js';
const args=process.argv.slice(3);let id='',prior='',authorized=false,retry=false;
for(let i=0;i<args.length;i++){if(args[i]==='--attempt')id=args[++i];else if(args[i]==='--diagnostic-run')prior=args[++i];else if(args[i]==='--confirm-send')authorized=true;else if(args[i]==='--retry-historical-quota')retry=true;else throw Error('INVALID_OPTION');}
if(![id,prior].every(v=>/^[a-zA-Z0-9_-]{1,100}$/.test(v))||!authorized)throw Error('RECOVERY_ARGUMENTS_REQUIRED');
const unlock=await acquireRunLock(path.resolve('private/boss-run-lock.sqlite')),store=openPageWorkflowStore(path.resolve('data/boss.sqlite'));
let client:BossExtensionClient|undefined,runId:string|undefined;const abort=new AbortController();const stop=()=>{abort.abort();void client?.close().catch(()=>{});};process.once('SIGINT',stop);process.once('SIGTERM',stop);
try{
 const attempt=store.getAttempt(id);if(!attempt)throw Error('ATTEMPT_NOT_FOUND');
 const directory=path.resolve('private/boss-extension/diagnostics',prior);
 const audit={workflow:JSON.parse(await readFile(path.join(directory,'workflow.json'),'utf8')),diagnostic:JSON.parse(await readFile(path.join(directory,'summary.json'),'utf8'))};
 proveUnsentRecovery(attempt,audit);const blockers=store.getRecoveryBlockers(id),profile=JSON.parse(await readFile('private/profile.json','utf8'));
 const scope={mode:'greet_once' as const,maxContacts:1};assertPageRunPolicy(scope,retry?{}:profile,blockers,authorized);
 client=await BossExtensionClient.connect(path.resolve('private/boss-extension/discovery.json'));
 const detailEvent=[...audit.diagnostic.events].reverse().find((e:any)=>e.stage==='mcp_received'&&e.tool==='open_job');
 if(!detailEvent?.requestId)throw Error('PRIOR_DETAIL_MISSING');const priorDetail=await client.result(detailEvent.requestId) as any;
 if(priorDetail.phase!=='observed'||priorDetail.value?.key!==attempt.job.key||!priorDetail.value?.recruiter)throw Error('PRIOR_TARGET_NOT_PROVEN');
 const target=priorDetail.value;
 const read=await client.inspect(randomUUID()),page=read.value as any;
 if(read.phase!=='observed'||!['chat','jobs'].includes(page?.pageKind)||page.blockers.length)throw Error('CURRENT_PAGE_NOT_READY');
 const header=page.chatLayoutProbe?.headerNodes;
 if(page.pageKind==='chat'&&(!Array.isArray(header)||![target.title,target.company,target.recruiter].every(v=>header.some((n:any)=>n.text===v))))throw Error('CURRENT_CHAT_TARGET_MISMATCH');
 assertPageRunPolicy(scope,profile,blockers,authorized,retry?{authorizedOn:shanghaiDate(),pageChecked:true}:undefined);
 runId=await client.startWorkflow(scope);console.log('恢复已有会话；不创建新联系。诊断 runId='+runId);
 let checkedBundle=false;const activeClient=client;
 const transport={action:async(tool:string,payload:Record<string,unknown>={})=>{const value=await activeClient.action(tool,payload);if(['restore_search','inspect_chat'].includes(tool)&&!checkedBundle){const state=await activeClient.inspect(randomUUID());if(state.phase!=='observed'||state.value?.adapterVersion!=='boss-dom-0.3.18')throw Error('CONTENT_UPDATE_NOT_LOADED');checkedBundle=true;console.log('已加载页面脚本 0.3.18');}return value;}};
 const result=await recoverGreeting(transport,store,attempt,audit,target,abort.signal,s=>console.log('步骤：'+s),page.pageKind==='chat');
 const dir=path.resolve('private/boss-extension/diagnostics',runId);await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'recovery.json'),JSON.stringify({...result,attemptId:id,priorDiagnosticRun:prior},null,2)+'\n');
 console.log(JSON.stringify(result));
}catch(e){console.error(e instanceof Error?e.message:'RECOVERY_FAILED');process.exitCode=1;}
finally{if(client&&runId)await client.diagnostics(runId).catch(()=>{});await client?.close().catch(()=>{});store.close();await unlock();process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
