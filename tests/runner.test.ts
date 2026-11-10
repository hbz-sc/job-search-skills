import {test,expect} from 'vitest';
import {run} from '../src/runner.js';
import {openStore} from '../src/storage/store.js';
import {loadConfig} from '../src/config.js';
import {evidence,template,type BossPages,type PageState} from '../src/domain.js';
import type {RunAuthorization} from '../src/authorization.js';
const a={key:'account1',displayName:'用户'},t=template('你好');
const j=(id:string)=>({key:id,url:'https://www.zhipin.com/job_detail/'+id+'.html',company:'公司',title:'AI',collectedAt:new Date().toISOString()});
function fake(){let opened=0,sent=0,scrolls=0,kind:PageState['kind']='ready';let current='1';const p:BossPages={
 state:async()=>({kind,evidence:evidence(kind)}),account:async()=>a,search:async()=>({filters:'深圳'}),assertSearchScope:async()=>{},visibleJobs:async()=>[j('1'),j('2')],advanceList:async()=>{scrolls++;return true;},restoreSearch:async()=>{},readInitialTemplate:async()=>t,
 openChat:async job=>{opened++;current=job.key;return {key:'chat'+current,jobKey:current,company:'公司',title:'AI',url:'https://www.zhipin.com/web/geek/chat?bossId='+current};},
 inspectChat:async()=>({identityMatches:true,existingConversation:false,templateStatus:'absent',evidence:evidence('空会话')}),chooseTemplate:async()=>{sent++;return 'submitted';},submitFilledTemplate:async()=>{sent++;},verifyTemplate:async()=>({status:'confirmed',evidence:evidence('送达')}),reopenAttempt:async()=>undefined,captureDiagnostic:async r=>evidence(r),close:async()=>{}
 };return {p,stats:()=>({opened,sent,scrolls}),quota:()=>{kind='quota';}};
}
const config=(extra={})=>loadConfig({keywords:['AI','AI'],intervalMs:0,...extra},process.cwd());
const auth=(max?:number):RunAuthorization=>({accountKey:a.key,city:'深圳',keywords:['AI'],templateHash:t.hash,filtersHash:template('深圳').hash,limit:max?{kind:'jobs',count:max}:{kind:'platform_quota'},issuedAt:new Date().toISOString()});
test('manual default denies sending without this-run authorization',async()=>{const f=fake(),s=openStore(':memory:');try{const r=await run({config:config({mode:'send'}),pages:f.p,store:s,signal:new AbortController().signal,resume:false,log:()=>{}});expect(r.stopReason).toBe('authorization');expect(f.stats().opened).toBe(0);expect(f.stats().sent).toBe(0);}finally{s.close();}});
test('quota before runId is latched and a collect cannot clear it',async()=>{
 const f=fake(),s=openStore(':memory:');f.quota();const args={config:config({mode:'send'}),pages:f.p,store:s,signal:new AbortController().signal,resume:false,authorization:auth(),log:()=>{}};
 try{const stopped=await run(args);expect(stopped.runId).toBe('');expect(s.getQuota('account1')?.reason).toBe('quota');
  f.p.state=async()=>({kind:'ready',evidence:evidence('正常')});await run({...args,config:config()});expect((await run(args)).stopReason).toBe('quota');expect(f.stats().sent).toBe(0);
 }finally{s.close();}
});
test('collect never opens a conversation, deduplicates and stops after 3 no-progress scans',async()=>{const f=fake(),s=openStore(':memory:');try{const r=await run({config:config(),pages:f.p,store:s,signal:new AbortController().signal,resume:false,log:()=>{}});expect(r.discovered).toBe(2);expect(r.stopReason).toBe('exhausted');expect(f.stats()).toEqual({opened:0,sent:0,scrolls:3});}finally{s.close();}});
test('maxJobs limits distinct processed jobs',async()=>{const f=fake(),s=openStore(':memory:');try{const r=await run({config:config({mode:'send',maxJobs:1}),pages:f.p,store:s,signal:new AbortController().signal,resume:false,authorization:auth(1),log:()=>{}});expect(r.stopReason).toBe('maximum');expect(f.stats().sent).toBe(1);}finally{s.close();}});
test('quota blocks later jobs and persists through collection; resume checks live state',async()=>{
 const f=fake(),s=openStore(':memory:');const args={config:config({mode:'send'}),pages:f.p,store:s,signal:new AbortController().signal,resume:false,authorization:auth(),log:()=>{}};
 const original=f.p.chooseTemplate;f.p.chooseTemplate=async t=>{const r=await original(t);f.quota();return r;};
 try{const r=await run(args);expect(r.stopReason).toBe('quota');expect(f.stats().sent).toBe(1);const next=await run({...args,resume:true});expect(next.stopReason).toBe('quota');expect(f.stats().sent).toBe(1);}finally{s.close();}
});
test('identity change or aborted signal causes zero writes',async()=>{
 for(const aborted of [true,false]){const f=fake(),s=openStore(':memory:'),c=new AbortController();if(aborted)c.abort();else{let n=0;f.p.account=async()=>++n===1?a:{...a,key:'other'};}
 try{const r=await run({config:config({mode:'send'}),pages:f.p,store:s,signal:c.signal,resume:false,authorization:auth(),log:()=>{}});expect(r.stopReason).toBe(aborted?'user':'identity');expect(f.stats().sent).toBe(0);}finally{s.close();}}
});
test('old unresolved intent never gets replayed',async()=>{const f=fake(),s=openStore(':memory:'),c=config({mode:'send'});const id=s.beginRun(a,c,t);const intent=s.reserve(id,a.key,j('1'),t);s.updateAttempt(intent.id,'sending');try{const r=await run({config:c,pages:f.p,store:s,signal:new AbortController().signal,resume:true,authorization:auth(),log:()=>{}});expect(r.stopReason).toBe('identity');expect(f.stats().sent).toBe(0);expect(s.pending(a.key)).toHaveLength(1);}finally{s.close();}});
test('shared conversation skips second job; existing delivery is not a new success',async()=>{
 const f=fake(),s=openStore(':memory:');f.p.openChat=async job=>({key:'shared',jobKey:job.key,company:'公司',title:'AI',url:'https://www.zhipin.com/web/geek/chat'});
 try{const r=await run({config:config({mode:'send'}),pages:f.p,store:s,signal:new AbortController().signal,resume:false,authorization:auth(),log:()=>{}});expect(r.confirmed).toBe(1);expect(r.skipped).toBe(1);expect(f.stats().sent).toBe(1);}finally{s.close();}
});
test('changing filters after first greeting prevents opening the second job',async()=>{
 const f=fake(),s=openStore(':memory:');let changed=false;
 f.p.assertSearchScope=async()=>{if(changed)throw new Error('筛选改变');};const choose=f.p.chooseTemplate;f.p.chooseTemplate=async t=>{const r=await choose(t);changed=true;return r;};
 try{await run({config:config({mode:'send'}),pages:f.p,store:s,signal:new AbortController().signal,resume:false,authorization:auth(),log:()=>{}});expect(f.stats().opened).toBe(1);expect(f.stats().sent).toBe(1);}finally{s.close();}
});
