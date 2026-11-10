import {test,expect} from 'vitest';import {openPageWorkflowStore} from '../../src/boss-extension/store.js';import {fixturePlan} from '../fixtures/jobpilot/search.js';
import {executeSearchEffect,reconcileSearchEffect,verifyExpectedPhrase} from '../../src/jobpilot/search-effects.js';import {hash} from '../../src/jobpilot/evidence.js';
function setup(){const page=openPageWorkflowStore(':memory:'),store=page.search,p=fixturePlan();store.savePlan(p);const template=store.bindTemplate('已保存的第一条常用语','user-selected-first');const batch=store.createBatch(p.planId,template.templateId,'run',10);return {page,store,template,batch};}
test('manual selection requirement survives safe search reconciliation',async()=>{
 const x=setup(),op=x.store.beginOperation(x.batch.batchId,'manual','search_jobs',{});const client={async searchAction(){return {};},async result(){return {requestId:op.requestId,phase:'uncertain',error:{code:'MANUAL_EXPERIENCE_REQUIRED'}};}};
 try{expect((await reconcileSearchEffect({store:x.store,client,signal:new AbortController().signal},'manual')).error?.code).toBe('MANUAL_EXPERIENCE_REQUIRED');}finally{x.page.close();}
});
test.each(['search_jobs','choose_first_phrase'])('preserves a journaled pointer diagnostic only for safe search: %s',async tool=>{
 const x=setup();let requestId='';const client={async searchAction(_t:string,_p:any,id:string,before?:any){requestId=id;before({context:{requestId:id}});throw Error('DEBUGGER_ATTACH_FAILED');},async result(){return {requestId,phase:'uncertain',error:{code:'DEBUGGER_ATTACH_FAILED'}};}};
 try{const r=await executeSearchEffect({store:x.store,client,signal:new AbortController().signal},x.batch.batchId,'pointer',tool,{});expect(r.phase).toBe('uncertain');expect(r.error?.code).toBe(tool==='search_jobs'?'DEBUGGER_ATTACH_FAILED':'RESULT_UNKNOWN');}finally{x.page.close();}
});
test('input rejection code survives reconciliation for the original search request',async()=>{
 const x=setup();const op=x.store.beginOperation(x.batch.batchId,'input','search_jobs',{});const client={async searchAction(){return {};},async result(){return {requestId:op.requestId,phase:'uncertain',error:{code:'DEBUGGER_INPUT_FAILED'}};}};
 try{expect((await reconcileSearchEffect({store:x.store,client,signal:new AbortController().signal},'input')).error?.code).toBe('DEBUGGER_INPUT_FAILED');}finally{x.page.close();}
});
test.each(['open_chat','choose_first_phrase','submit_filled_phrase'])('lost %s response never redispatches after reconnect',async tool=>{
 const x=setup();let calls=0;const client={async searchAction(t:string,p:Record<string,unknown>,id:string,before?:(e:unknown)=>void){before?.({version:3,tool:t,payload:p,context:{requestId:id,leaseId:'old'}});calls++;throw Error('NETWORK_LOST');},async result(){return {phase:'uncertain'};}};
 const deps={store:x.store,client,signal:new AbortController().signal};try{
 expect((await executeSearchEffect(deps,x.batch.batchId,'effect',tool,{jobKey:'j'})).phase).toBe('uncertain');
 expect((await executeSearchEffect({...deps,client:{...client,async searchAction(){calls++;return {};}}},x.batch.batchId,'effect',tool,{jobKey:'j'})).phase).toBe('uncertain');expect(calls).toBe(1);
 }finally{x.page.close();}
});
test('journal confirmed outcome reconciles intent without sending and changed payload is refused',async()=>{
 const x=setup();let calls=0;const op=x.store.beginOperation(x.batch.batchId,'effect','choose_first_phrase',{conversationKey:'c'});
 const client={async searchAction(){calls++;return {};},async result(){return {requestId:op.requestId,phase:'observed',value:{status:'submitted'}};}};try{
 expect((await reconcileSearchEffect({store:x.store,client,signal:new AbortController().signal},'effect')).value.status).toBe('submitted');expect(calls).toBe(0);
 await expect(executeSearchEffect({store:x.store,client,signal:new AbortController().signal},x.batch.batchId,'effect','choose_first_phrase',{conversationKey:'wrong'})).rejects.toThrow('OPERATION_CONFLICT');
 }finally{x.page.close();}
});
test('stable default phrase is never accepted; delayed saved phrase is accepted without a send',async()=>{
 const x=setup();let reads=0;const client={async searchAction(tool:string){expect(tool).toBe('read_first_phrase');reads++;const text=reads<3?'平台默认话术':x.template.expectedText;return {text,hash:hash(text)};},async result(){return {};}};
 try{expect((await verifyExpectedPhrase(client,'c',x.template,new AbortController().signal,0)).text).toBe(x.template.expectedText);expect(reads).toBe(3);
 reads=0;client.searchAction=async()=>{reads++;return {text:'平台默认话术',hash:hash('平台默认话术')};};await expect(verifyExpectedPhrase(client,'c',x.template,new AbortController().signal,0)).rejects.toThrow('FIRST_PHRASE_CHANGED');expect(reads).toBe(6);
 }finally{x.page.close();}
});
test('mismatched response request id or claimed hash cannot prove an effect or phrase',async()=>{
 const x=setup();const o=x.store.beginOperation(x.batch.batchId,'e','open_chat',{});const client={async searchAction(){return {text:x.template.expectedText,hash:'c'.repeat(64)};},async result(){return {requestId:'wrong',phase:'observed',value:{status:'confirmed'}};}};
 try{expect((await reconcileSearchEffect({store:x.store,client,signal:new AbortController().signal},o.operationKey)).phase).toBe('uncertain');await expect(verifyExpectedPhrase(client,'c',x.template,new AbortController().signal,0)).rejects.toThrow('FIRST_PHRASE_CHANGED');}finally{x.page.close();}
});

test('pre-dispatch connection failure is classified but an unknown dispatched send remains unknown',async()=>{
 for(const dispatched of [false,true]){const x=setup();const client={async searchAction(_t:string,_p:any,id:string,before?:any){if(dispatched)before({context:{requestId:id}});throw Error('BINDING_CHANGED');},async result(){return {phase:'uncertain'};}};try{const r=await executeSearchEffect({store:x.store,client,signal:new AbortController().signal},x.batch.batchId,'fault','choose_first_phrase',{});expect(r.phase).toBe(dispatched?'uncertain':'rejected');expect(r.error?.code).toBe(dispatched?'RESULT_UNKNOWN':'BINDING_CHANGED');}finally{x.page.close();}}
});
