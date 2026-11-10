import {test,expect} from 'vitest';import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import {openPageWorkflowStore} from '../../src/boss-extension/store.js';import {fixturePlan} from '../fixtures/jobpilot/search.js';import {createSearchService} from '../../src/jobpilot/search-service.js';import {loadJobpilotConfig} from '../../src/jobpilot/config.js';
function seed(){const root=mkdtempSync(path.join(tmpdir(),'search-auto-')),p=fixturePlan(),file=path.join(root,'data/boss.sqlite');const page=openPageWorkflowStore(file);page.search.savePlan(p);const batch=page.search.createBatch(p.planId,null,'preview',0);page.close();return {root,file,p,batch};}
function ready(){return {async inspect(){return {phase:'observed',value:{blockers:[],binding:{sessionId:'session',tabId:7}}};},async startSearchWorkflow(){},async searchAction(_tool:string,q:any){return {observedCity:'深圳',observedKeyword:q.keyword,observedExperience:q.experience,filterEvidence:{keyword:q.keyword,city:'深圳',experience:q.experience,results:'empty'},jobs:[],exhausted:true};},async result(){return {phase:'uncertain'};},async close(){}} as any;}
test('a temporary missing binding automatically reconnects and completes the same frozen preview',async()=>{
 const x=seed();let connections=0;const s=await createSearchService({root:x.root,config:loadJobpilotConfig({}),recoveryDelayMs:0,clientFactory:async()=>{if(++connections===1)throw Error('BOSS_TAB_NOT_BOUND：页面正在刷新');return ready();}} as any);
 try{const r=await s.resume(x.batch.batchId);expect(r.batch.status).toBe('completed');expect(r.batch.batchId).toBe(x.batch.batchId);expect(connections).toBe(2);expect(r.batch.usedContacts).toBe(0);}finally{await s.close();}
});
test('three recovery attempts are persistent and cannot reset when service restarts',async()=>{
 const x=seed();let connections=0;for(let pass=0;pass<2;pass++){const s=await createSearchService({root:x.root,config:loadJobpilotConfig({}),recoveryDelayMs:0,clientFactory:async()=>{connections++;throw Error('BOSS_TAB_NOT_BOUND');}} as any);try{const r=await s.resume(x.batch.batchId);expect(r.batch.stopReason).toBe('AUTO_RECOVERY_LIMIT');}finally{await s.close();}}
 expect(connections).toBe(5);const page=openPageWorkflowStore(x.file);try{expect(page.search.getRecovery(x.batch.batchId).attempts).toBe(3);}finally{page.close();}
});
test.each(['USER_STOPPED','FIRST_PHRASE_CHANGED','RESULT_UNKNOWN','PAGE_BLOCKED'])('does not auto-resume a non-connection pause: %s',async code=>{
 const x=seed();let calls=0;const s=await createSearchService({root:x.root,config:loadJobpilotConfig({}),recoveryDelayMs:0,clientFactory:async()=>{calls++;throw Error(code);}} as any);try{const r=await s.resume(x.batch.batchId);expect(r.batch.stopReason).toBe(code);expect(calls).toBe(1);}finally{await s.close();}
});
test('new authorized tab cannot take over a recovering batch',async()=>{
 const x=seed();let n=0;const s=await createSearchService({root:x.root,config:loadJobpilotConfig({}),recoveryDelayMs:0,clientFactory:async()=>{const c=ready();if(++n===1)c.startSearchWorkflow=async()=>{throw Error('BINDING_CHANGED');};else c.inspect=async()=>({phase:'observed',value:{blockers:[],binding:{sessionId:'other',tabId:8}}});return c;}} as any);try{const r=await s.resume(x.batch.batchId);expect(r.batch.stopReason).toBe('RECOVERY_TARGET_CHANGED');expect(n).toBe(2);}finally{await s.close();}
});

test.each([false,true])('a connection failure after send never duplicates a greeting (unknown=%s)',async unknown=>{
 const x=seed();const page=openPageWorkflowStore(x.file);const template=page.search.bindTemplate('用户已有常用语','test');const b=page.search.createBatch(x.p.planId,template.templateId,'run',10);page.close();let connections=0,sends=0,opens=0;
 const service=await createSearchService({root:x.root,config:loadJobpilotConfig({}),recoveryDelayMs:0,clientFactory:async()=>{const c=ready(),connection=++connections;c.searchAction=async(tool:string,q:any,id:string,before?:any)=>{before?.({context:{requestId:id}});
  if(tool==='restore_search'&&connection===1)throw Error('BINDING_CHANGED');
  if(['search_jobs','restore_search','list_jobs'].includes(tool))return {observedCity:'深圳',observedKeyword:q.keyword,observedExperience:q.experience,filterEvidence:{keyword:q.keyword,city:'深圳',experience:q.experience,results:'visible'},jobs:[{key:'one',title:'Java',company:'甲'}],exhausted:true};
  if(tool==='open_job')return {key:'one',recruiter:'招聘人',alreadyContacted:false};
  if(tool==='open_chat'){opens++;return {conversationKey:'one',title:'Java',company:'甲',recruiter:'招聘人'};}
  if(tool==='read_first_phrase')return {text:template.expectedText,hash:template.normalizedHash};
  if(tool==='choose_first_phrase'){sends++;if(unknown)throw Error('BINDING_CHANGED');return {status:'submitted'};}
  if(tool==='inspect_send_result')return {status:'confirmed'};throw Error('UNEXPECTED');};return c;}});
 try{const result=await service.resume(b.batchId);expect(result.batch.status).toBe(unknown?'paused':'completed');expect(sends).toBe(1);expect(opens).toBe(1);expect(connections).toBe(unknown?1:2);expect(result.batch.usedContacts).toBe(1);}finally{await service.close();}
});

test('recovery wait consumes active time and a crash reservation survives reopening',()=>{
 const x=seed();let page=openPageWorkflowStore(x.file);const n=page.search.reserveRecovery(x.batch.batchId);page.search.addActiveTime(x.batch.batchId,`recovery:${n}`,4000);page.close();page=openPageWorkflowStore(x.file);try{expect(page.search.getRecovery(x.batch.batchId).attempts).toBe(1);expect(page.search.getBatch(x.batch.batchId).activeMs).toBe(4000);page.search.addActiveTime(x.batch.batchId,'rest',1796000);expect(()=>page.search.reserveRecovery(x.batch.batchId)).toThrow('ACTIVE_TIME_LIMIT');}finally{page.close();}
});
