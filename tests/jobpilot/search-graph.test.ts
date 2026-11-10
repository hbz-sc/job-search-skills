import {test,expect} from 'vitest';import {MemorySaver} from '@langchain/langgraph';import {openPageWorkflowStore} from '../../src/boss-extension/store.js';import {fixturePlan} from '../fixtures/jobpilot/search.js';import {createSearchGraph} from '../../src/jobpilot/search-graph.js';import {hash} from '../../src/jobpilot/evidence.js';import {planDigest} from '../../src/jobpilot/search-plan.js';
function setup(mode:'preview'|'run'='run',limit=10){
 const page=openPageWorkflowStore(':memory:'),store=page.search,p=fixturePlan();store.savePlan(p);const template=store.bindTemplate('第一条自定义常用语','user-selected-first'),batch=store.createBatch(p.planId,mode==='run'?template.templateId:null,mode,mode==='run'?limit:0);const calls:{tool:string;payload:any}[]=[];let activeJob='';
 const client={async searchAction(tool:string,payload:any,id:string,before?:(x:unknown)=>void):Promise<any>{before?.({tool,payload,context:{requestId:id}});calls.push({tool,payload});
 if(['search_jobs','restore_search','list_jobs'].includes(tool))return {observedCity:'深圳',observedKeyword:payload.keyword,observedExperience:payload.experience,filterEvidence:{keyword:payload.keyword,city:'深圳',experience:payload.experience,results:'visible'},jobs:[{key:'same',title:'Java',company:'公司甲',url:'https://www.zhipin.com/job_detail/same.html'},{key:payload.experience,title:'Java',company:'公司乙',url:'https://www.zhipin.com/job_detail/'+payload.experience+'.html'}],exhausted:true};
 if(tool==='open_job'){activeJob=payload.jobKey;return {key:activeJob,title:'Java',company:activeJob==='same'?'公司甲':'公司乙',recruiter:'招聘人',alreadyContacted:false};}
 if(tool==='open_chat')return {conversationKey:activeJob,title:'Java',company:activeJob==='same'?'公司甲':'公司乙',recruiter:'招聘人'};
 if(tool==='read_first_phrase')return {text:template.expectedText,hash:hash(template.expectedText)};
 if(tool==='choose_first_phrase')return {status:'submitted'};
 if(tool==='inspect_send_result')return {status:'confirmed'};
 throw Error('UNEXPECTED_TOOL:'+tool);
 },async result(){return {phase:'uncertain'};}};
 return {page,store,p,batch,calls,client};
}
test('graph searches both bands, deduplicates globally and sends only once per unique job',async()=>{
 const x=setup();try{const g=createSearchGraph({pageStore:x.page,client:x.client,checkpointer:new MemorySaver(),signal:new AbortController().signal});await g.invoke({data:{batchId:x.batch.batchId,queryIndex:0,step:0,seenJobKeys:[],candidates:[],status:'running'}},{configurable:{thread_id:x.batch.batchId},recursionLimit:500});
 expect(x.calls.filter(c=>c.tool==='search_jobs').map(c=>c.payload.experience)).toEqual(['exp_1_3','exp_3_5']);expect(x.calls.filter(c=>c.tool==='open_chat').map(c=>c.payload.jobKey)).toEqual(['same','exp_1_3','exp_3_5']);expect(x.store.attempts(x.batch.batchId).map(a=>a.phase)).toEqual(['confirmed','confirmed','confirmed']);expect(x.store.getBatch(x.batch.batchId).status).toBe('completed');
 }finally{x.page.close();}
});
test('preview covers both filters without contacting; whole batch contact cap stops all queries',async()=>{
 for(const mode of ['preview','run'] as const){const x=setup(mode,1);try{await createSearchGraph({pageStore:x.page,client:x.client,checkpointer:new MemorySaver(),signal:new AbortController().signal}).invoke({data:{batchId:x.batch.batchId,queryIndex:0,step:0,seenJobKeys:[],candidates:[],status:'running'}},{configurable:{thread_id:x.batch.batchId},recursionLimit:500});expect(x.calls.filter(c=>c.tool==='open_chat')).toHaveLength(mode==='preview'?0:1);expect(x.store.getBatch(x.batch.batchId).usedContacts).toBe(mode==='preview'?0:1);}finally{x.page.close();}}
});
test('unknown send pauses the whole batch while confirmed failure skips and continues',async()=>{
 for(const status of ['pending','failed']){const x=setup();const original=x.client.searchAction;x.client.searchAction=async(...a)=>a[0]==='inspect_send_result'?{status}:original(...a);try{
 await createSearchGraph({pageStore:x.page,client:x.client,checkpointer:new MemorySaver(),signal:new AbortController().signal}).invoke({data:{batchId:x.batch.batchId,queryIndex:0,step:0,seenJobKeys:[],candidates:[],status:'running'}},{configurable:{thread_id:x.batch.batchId},recursionLimit:500});expect(x.store.getBatch(x.batch.batchId).status).toBe(status==='pending'?'paused':'completed');expect(x.calls.filter(c=>c.tool==='open_chat')).toHaveLength(status==='pending'?1:3);
 }finally{x.page.close();}}
});
test('unverified filters stop before open_job or open_chat',async()=>{
 const x=setup();const original=x.client.searchAction;x.client.searchAction=async(...a)=>a[0]==='search_jobs'?{observedCity:'北京'}:original(...a);try{await createSearchGraph({pageStore:x.page,client:x.client,checkpointer:new MemorySaver(),signal:new AbortController().signal}).invoke({data:{batchId:x.batch.batchId,queryIndex:0,step:0,seenJobKeys:[],candidates:[],status:'running'}},{configurable:{thread_id:x.batch.batchId},recursionLimit:500});expect(x.store.getBatch(x.batch.batchId).status).toBe('paused');expect(x.calls).toEqual([]);}finally{x.page.close();}
});

test('two directions run four queries without contacting duplicate jobs again',async()=>{
 const x=setup('preview');try{
 const p={...fixturePlan(),roles:[...fixturePlan().roles,{roleId:'ai_application' as const,keyword:'AI应用开发工程师',priority:2,evidenceIds:['resume:e:1'],reason:'AI业务'}]};p.planHash=planDigest(p);x.store.savePlan(p);const b=x.store.createBatch(p.planId,null,'preview',0);
 await createSearchGraph({pageStore:x.page,client:x.client,checkpointer:new MemorySaver(),signal:new AbortController().signal}).invoke({data:{batchId:b.batchId,queryIndex:0,step:0,seenJobKeys:[],candidates:[],status:'running'}},{configurable:{thread_id:b.batchId},recursionLimit:500});
 expect(x.calls.filter(c=>c.tool==='search_jobs').map(c=>[c.payload.keyword,c.payload.experience])).toEqual([['Java开发工程师','exp_1_3'],['Java开发工程师','exp_3_5'],['AI应用开发工程师','exp_1_3'],['AI应用开发工程师','exp_3_5']]);expect(x.calls.some(c=>c.tool==='open_chat')).toBe(false);
 }finally{x.page.close();}
});

test('reordered known listings converge; exhausted active time prevents every tool call',async()=>{
 for(const timedOut of [false,true]){const x=setup();try{
 const original=x.client.searchAction;let queries=0;
 x.client.searchAction=async(...args)=>{if(['search_jobs','list_jobs'].includes(args[0])){queries++;const v=await original(...args);return {...v,jobs:(queries%2?['a','b']:['b','a']).map(key=>({key,title:'Java',company:'甲'})),exhausted:false};}return original(...args);};
 if(timedOut)x.store.addActiveTime(x.batch.batchId,'prior-crash',1800000);
 const graph=createSearchGraph({pageStore:x.page,client:x.client,checkpointer:new MemorySaver(),signal:new AbortController().signal});
 const state={batchId:x.batch.batchId,queryIndex:0,step:0,seenJobKeys:['a','b'],candidates:[],status:'running' as const};
 await graph.invoke({data:state},{configurable:{thread_id:x.batch.batchId},recursionLimit:500});
 if(timedOut){expect(x.store.getBatch(x.batch.batchId).stopReason).toBe('ACTIVE_TIME_LIMIT');expect(queries).toBe(0);}
 else{expect(queries).toBe(8);expect(x.store.getBatch(x.batch.batchId).status).toBe('completed');expect(x.calls.some(c=>c.tool==='open_chat')).toBe(false);}
 }finally{x.page.close();}}
});

test('returning from four chats still advances the first query instead of treating restores as empty pages',async()=>{
 const x=setup();try{const original=x.client.searchAction;let advanced=false;
 x.client.searchAction=async(...args)=>{const [tool,payload]=args;if(tool==='list_jobs')advanced=true;if(['search_jobs','restore_search','list_jobs'].includes(tool)){const view=await original(...args);return {...view,jobs:advanced?[]:['a','b','c','d'].map(key=>({key,title:'Java',company:'甲'})),exhausted:advanced};}return original(...args);};
 await createSearchGraph({pageStore:x.page,client:x.client,checkpointer:new MemorySaver(),signal:new AbortController().signal}).invoke({data:{batchId:x.batch.batchId,queryIndex:0,step:0,seenJobKeys:[],candidates:[],status:'running'}},{configurable:{thread_id:x.batch.batchId},recursionLimit:500});
 expect(x.calls.find(c=>c.tool==='list_jobs')?.payload.experience).toBe('exp_1_3');expect(x.store.getQueryProgress(x.batch.batchId,0).advances).toBe(1);
 }finally{x.page.close();}
});
