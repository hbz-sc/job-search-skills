import {test,expect} from 'vitest';import {MemorySaver} from '@langchain/langgraph';import {randomUUID} from 'node:crypto';import {openJobpilotStore} from '../../src/jobpilot/store.js';import {loadJobpilotConfig,DEFAULT_LIMITS} from '../../src/jobpilot/config.js';import {withBudget} from '../../src/jobpilot/budget.js';import {researchNodes} from '../../src/jobpilot/nodes/research.js';import {draftNode} from '../../src/jobpilot/nodes/draft.js';import {LocalJobSource} from '../../src/jobpilot/tools/local-jobs.js';import {hash} from '../../src/jobpilot/evidence.js';import {demoInput,fakeModel} from '../fixtures/jobpilot/model.js';import type {JobState} from '../../src/jobpilot/state.js';
const setup=()=>{const i=demoInput(),store=openJobpilotStore(':memory:');const s:JobState={schemaVersion:1,threadId:'t',batchId:'b',jobId:'j',resume:i.resume,profile:{facts:[]},preferences:i.preferences,jobSummary:i.jobs.summaries[0],jobDetail:i.jobs.details[0],analysis:{recommendation:'recommended',requirements:[],matches:[],gaps:[],unknowns:[],rationale:'test'},draft:{text:'draft',evidenceIds:[i.resume.evidence[0].id]},draftVersion:2,revisionCount:1,review:{reviewId:randomUUID(),threadId:randomUUID(),draftVersion:2,decision:'revise',feedback:'shorter'}};return {store,s,deps:{store,model:fakeModel(),source:new LocalJobSource(i.jobs),config:loadJobpilotConfig({}),checkpointer:new MemorySaver()}};};
test('interrupted second revision reserves logical modification only once',async()=>{
 const {store,s,deps}=setup();store.incrementRevision('t','prior');const model=deps.model;deps.model={async request(){throw Object.assign(Error('interrupted'),{status:401});}};
 await expect(draftNode(deps,true)(s)).rejects.toThrow();deps.model=model;
 const result=await draftNode(deps,true)(s);expect(result.draftVersion).toBe(3);expect(store.getBudget('t').revisionCount).toBe(2);store.close();
});
test('cached third decision and interrupted third decision can replay at logical cap',async()=>{
 for(const cached of [true,false]){const {store,s,deps}=setup();s.decisionTurns=2;const id=`t:decide:2:${hash([])}`;
 store.incrementDecision('t','p1');store.incrementDecision('t','p2');store.incrementDecision('t',id);
 if(cached){store.reserveAttempt('t','model',id);store.completeOperation(id,{content:'',toolCalls:[{id:'last',name:'get_job_detail',args:{jobId:'j'}}]});}
 const result=await researchNodes(deps).decide(s);expect(result.decision?.toolCalls[0].name).toBe(cached?'get_job_detail':'finish_research');expect(store.getBudget('t').decisionTurns).toBe(3);store.close();}
});
test('response completion and active-time charge have no crash gap',async()=>{
 const store=openJobpilotStore(':memory:');const charge=store.chargeActive.bind(store);store.chargeActive=()=>{throw Error('crash during charge');};
 await expect(withBudget(store,DEFAULT_LIMITS,'t','op','model',async()=>({value:1}))).rejects.toThrow();store.chargeActive=charge;store.recoverPending('t');
 expect(store.getBudget('t').activeMs).toBeGreaterThan(0);store.close();
});
