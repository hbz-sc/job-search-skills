import {test,expect} from 'vitest';import {mkdtempSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import {DatabaseSync} from 'node:sqlite';
import {openPageWorkflowStore} from '../../src/boss-extension/store.js';import {fixturePlan} from '../fixtures/jobpilot/search.js';
const job=(key:string)=>({key,title:'Java',company:'测试公司',url:`https://www.zhipin.com/job_detail/${key}.html`});
function setup(file=':memory:'){const page=openPageWorkflowStore(file),s=page.search;const p=fixturePlan();s.savePlan(p);const t=s.bindTemplate('您好，想了解这个岗位。','explicit-file');return {page,s,p,t,b:s.createBatch(p.planId,t.templateId,'run',10)};}
test('one transaction reserves a globally unique job and consumes the whole batch budget only once',()=>{
 const x=setup();try{
 const first=x.s.reserveContact(x.b.batchId,job('j0'),'slot0');expect(first).not.toBeNull();expect(x.s.reserveContact(x.b.batchId,job('j0'),'slot0')?.attemptId).toBe(first?.attemptId);
 for(let i=1;i<10;i++)x.s.reserveContact(x.b.batchId,job('j'+i),'slot'+i);
 expect(x.s.getBatch(x.b.batchId).usedContacts).toBe(10);expect(()=>x.s.reserveContact(x.b.batchId,job('j10'),'slot10')).toThrow('CONTACT_LIMIT');
 const next=x.s.createBatch(x.p.planId,x.t.templateId,'run',10);expect(x.s.reserveContact(next.batchId,job('j0'),'new')).toBeNull();expect(x.s.getBatch(next.batchId).usedContacts).toBe(0);
 }finally{x.page.close();}
});
test('reopening retains budget and another connection cannot reserve the same job',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'search-store-')),file=path.join(dir,'boss.sqlite');const x=setup(file);const y=openPageWorkflowStore(file);try{
 x.s.reserveContact(x.b.batchId,job('shared'),'slot');expect(y.search.reserveContact(x.b.batchId,job('shared'),'other')).toBeNull();
 for(let i=1;i<10;i++)y.search.reserveContact(x.b.batchId,job('j'+i),'slot'+i);
 x.page.close();const reopened=openPageWorkflowStore(file);try{expect(reopened.search.getBatch(x.b.batchId).usedContacts).toBe(10);expect(()=>reopened.search.reserveContact(x.b.batchId,job('extra'),'extra')).toThrow('CONTACT_LIMIT');}finally{reopened.close();}
 }finally{y.close();}
});
test('existing v2 attempts and legacy CSV remain global dedup sources',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'search-history-'));writeFileSync(path.join(dir,'jobs.csv'),'source_url,status\nhttps://www.zhipin.com/job_detail/legacy.html,user_sent_greeting\n');
 const x=setup(path.join(dir,'boss.sqlite'));try{const old=x.page.beginRun({mode:'batch',maxContacts:1});x.page.reserveContact(old,job('old'));expect(x.s.reserveContact(x.b.batchId,job('old'),'old')).toBeNull();expect(x.page.shouldSkip('legacy')).toBe(true);expect(x.s.reserveContact(x.b.batchId,job('legacy'),'legacy')).toBeNull();}finally{x.page.close();}
});
test('missing template and modified frozen plan cannot authorize a run',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'search-hash-')),file=path.join(dir,'boss.sqlite');const x=setup(file);try{
 expect(()=>x.s.createBatch(x.p.planId,null,'run',10)).toThrow('TEMPLATE_REQUIRED');
 expect(x.s.getTemplate(x.t.templateId).expectedText).toBe('您好，想了解这个岗位。');
 const raw=new DatabaseSync(file);raw.prepare('UPDATE search_plans SET value=? WHERE id=?').run(JSON.stringify({...x.p,city:'北京'}),x.p.planId);raw.close();expect(()=>x.s.getPlan(x.p.planId)).toThrow();
 }finally{x.page.close();}
});
test('operations reject changed payload and preserve request envelope/results; active segments do not reset',()=>{
 const x=setup();try{const o=x.s.beginOperation(x.b.batchId,'open','open_chat',{jobKey:'j'});x.s.markDispatched(o.operationId,{context:{requestId:o.requestId}});x.s.finishOperation(o.operationId,{phase:'observed',value:{ok:true}});
 expect(x.s.getOperation('open')?.result).toEqual({phase:'observed',value:{ok:true}});expect(()=>x.s.beginOperation(x.b.batchId,'open','open_chat',{jobKey:'other'})).toThrow('OPERATION_CONFLICT');
 x.s.addActiveTime(x.b.batchId,'s1',500);x.s.addActiveTime(x.b.batchId,'s1',500);expect(x.s.getBatch(x.b.batchId).activeMs).toBe(500);
 }finally{x.page.close();}
});
