import {test,expect} from 'vitest';import {mkdtemp} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {createJobpilotService} from '../../src/jobpilot/service.js';import {demoInput,fakeModel} from '../fixtures/jobpilot/model.js';
test('duplicate and crash-pending review cannot revise twice or change payload',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'jp-replay-'));let revised=0;const model=fakeModel(op=>{if(op==='revise')revised++;});let s=await createJobpilotService({root,model});
 const batch=await s.analyze(demoInput());const req={reviewId:randomUUID(),threadId:batch.tasks[0].threadId,draftVersion:1,decision:'revise' as const,feedback:'简短'};
 s.store.reserveReview(req);await s.close();s=await createJobpilotService({root,model});
 try{const result=await s.review(req);expect(result.draftVersion).toBe(2);expect((await s.review(req)).draftVersion).toBe(2);expect(revised).toBe(1);await expect(s.review({...req,decision:'reject'})).rejects.toThrow('review_conflict');
 // Simulate lost completion marker after the graph advanced.
 const req2={...req,reviewId:randomUUID(),draftVersion:2};const original=s.store.completeReview.bind(s.store);s.store.completeReview=()=>{throw Error('simulated_crash');};await expect(s.review(req2)).rejects.toThrow('simulated_crash');s.store.completeReview=original;
 expect((await s.review(req2)).draftVersion).toBe(3);expect(revised).toBe(2);
 }finally{await s.close();}
});
