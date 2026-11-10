import {test,expect} from 'vitest';import {MemorySaver,Command} from '@langchain/langgraph';import {randomUUID} from 'node:crypto';
import {buildJobGraph} from '../../src/jobpilot/graph.js';import {validateReview} from '../../src/jobpilot/nodes/review.js';import {openJobpilotStore} from '../../src/jobpilot/store.js';import {loadJobpilotConfig} from '../../src/jobpilot/config.js';import {LocalJobSource} from '../../src/jobpilot/tools/local-jobs.js';import {demoInput,fakeModel} from '../fixtures/jobpilot/model.js';
test('review interrupts, revises twice, then approves without generating again',async()=>{
 const i=demoInput(),store=openJobpilotStore(':memory:'),threadId=randomUUID();let calls=0;
 const graph=buildJobGraph({model:fakeModel(()=>calls++),store,source:new LocalJobSource(i.jobs),checkpointer:new MemorySaver(),config:loadJobpilotConfig({})});const config={configurable:{thread_id:threadId}};
 const first=await graph.invoke({data:{schemaVersion:1,threadId,batchId:'b',jobId:'j',resume:i.resume,profile:{facts:[]},preferences:i.preferences,jobSummary:i.jobs.summaries[0],jobDetail:i.jobs.details[0]}},config);
 expect((await graph.getState(config)).tasks.some(t=>t.interrupts?.length)).toBe(true);
 for(let v=1;v<=2;v++)await graph.invoke(new Command({resume:{reviewId:randomUUID(),threadId,draftVersion:v,decision:'revise',feedback:'简短一点'}}),config);
 const state=(await graph.getState(config)).values.data;expect(state.draftVersion).toBe(3);
 expect(()=>validateReview({reviewId:randomUUID(),threadId,draftVersion:3,decision:'revise',feedback:'more'},state,2)).toThrow();
 const before=calls;const result=await graph.invoke(new Command({resume:{reviewId:randomUUID(),threadId,draftVersion:3,decision:'approve'}}),config);
 expect(result.data.status).toBe('completed');expect(calls).toBe(before);expect(store.results('b')).toHaveLength(1);store.close();
});
test('review rejects stale versions and oversize feedback',()=>{
 const threadId=randomUUID();const state={threadId,draftVersion:2,revisionCount:0};
 expect(()=>validateReview({reviewId:randomUUID(),threadId,draftVersion:1,decision:'reject'},state,2)).toThrow('stale_review');
 expect(()=>validateReview({reviewId:randomUUID(),threadId,draftVersion:2,decision:'revise',feedback:'中'.repeat(2001)},state,2)).toThrow();
});
