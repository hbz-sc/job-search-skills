import {test,expect} from 'vitest';import {mkdtempSync,writeFileSync,mkdirSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import {createSearchService} from '../../src/jobpilot/search-service.js';import {loadJobpilotConfig} from '../../src/jobpilot/config.js';import {acquireRunLock} from '../../src/run-lock.js';
import {openPageWorkflowStore} from '../../src/boss-extension/store.js';import {fixturePlan} from '../fixtures/jobpilot/search.js';
test('unresolved historical contact blocks sending while zero-contact preview remains available without changing history',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'search-preview-policy-'));const page=openPageWorkflowStore(path.join(root,'data/boss.sqlite'));const plan=fixturePlan();page.search.savePlan(plan);const old=page.beginRun({mode:'batch',maxContacts:1});const id=page.reserveContact(old,{key:'historic',title:'旧岗位',company:'甲',url:'https://www.zhipin.com/job_detail/historic.html'});page.updateAttempt(id,'uncertain',{code:'RESULT_UNKNOWN'});const template=page.search.bindTemplate('已有常用语','test');let calls:string[]=[];
 const client:any={async inspect(){return {phase:'observed',value:{blockers:[]}};},async startSearchWorkflow(){},async searchAction(tool:string,q:any){calls.push(tool);if(tool!=='search_jobs')throw Error('NO_CONTACT');return {observedCity:'深圳',observedKeyword:q.keyword,observedExperience:q.experience,filterEvidence:{keyword:q.keyword,city:'深圳',experience:q.experience,results:'empty'},jobs:[],exhausted:true};},async result(){return {};},async close(){}};
 const service=await createSearchService({root,config:loadJobpilotConfig({}),clientFactory:async()=>client});try{
 expect((await service.preview(plan.planId)).batch.status).toBe('completed');expect(calls).toEqual(['search_jobs','search_jobs']);calls=[];
 expect((await service.run(plan.planId,template.templateId,1)).batch.stopReason).toBe('UNRESOLVED_CONTACT');expect(calls).toEqual([]);expect(page.getAttempt(id)?.phase).toBe('uncertain');
 page.stop('QUOTA_REACHED',{});expect((await service.preview(plan.planId)).batch.stopReason).toBe('QUOTA_REACHED');expect(calls).toEqual([]);
 }finally{await service.close();page.close();}
});
test('empty model plan needs no browser and preview never contacts; status is a pure projection',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'search-service-'));let connections=0;
 const service=await createSearchService({root,config:{...loadJobpilotConfig({}),model:'fixture'},model:{async request(){return {content:'{"roles":[]}',toolCalls:[]};}},clientFactory:async()=>{connections++;throw Error('NO_BROWSER');}});
 try{const p=await service.plan('有商务销售经验。');const b=await service.preview(p.planId);expect(b.batch.status).toBe('completed');expect(b.batch.stopReason).toBe('NO_ROLES');expect(connections).toBe(0);expect(await service.status(b.batch.batchId)).toEqual(b);}finally{await service.close();}
});

test('platform fallback with layout whitespace cannot become the pinned saved phrase',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'search-default-'));
 const s=await createSearchService({root,config:loadJobpilotConfig({}),clientFactory:async()=>({async inspect(){return {phase:'observed',value:{blockers:[]}};},async close(){},async startSearchWorkflow(){},async searchAction(){return {text:'\n我可以把我的简历发给您看看吗？\n'};},async result(){return {};}} as any)});
 try{await expect(s.captureFirstTemplate()).rejects.toThrow('DEFAULT_PHRASE_NOT_READY');}finally{await s.close();}
});
test('scope cannot run without bound phrase and global old/new run lock is shared',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'search-lock-'));const s=await createSearchService({root,config:{...loadJobpilotConfig({}),model:'fixture'},model:{async request(){return {content:'{"roles":[]}',toolCalls:[]};}}});
 try{const p=await s.plan('销售经验。');await expect(s.run(p.planId,'missing',10)).rejects.toThrow();const release=await acquireRunLock(path.join(root,'private/boss-run-lock.sqlite'));try{await expect(s.preview(p.planId)).rejects.toThrow('已有实例');}finally{await release();}}finally{await s.close();}
});
test('first-phrase binding captures the existing visible phrase without generating or sending text',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'search-first-'));let reads=0,leases=0;
 const s=await createSearchService({root,config:loadJobpilotConfig({}),clientFactory:async()=>({async inspect(){return {phase:'observed',value:{blockers:[]}};},async close(){},async startSearchWorkflow(scope:any){expect(scope.mode).toBe('preview');expect(scope.maxContacts).toBe(0);leases++;},async searchAction(tool:string){expect(tool).toBe('read_saved_phrase');reads++;return {text:'用户自己保存的第一条'};},async result(){return {};}} as any)});
 try{const t=await s.captureFirstTemplate();expect(t.expectedText).toBe('用户自己保存的第一条');expect(reads).toBe(3);expect(leases).toBe(1);}finally{await s.close();}
});
