import {test,expect} from 'vitest';import {mkdtemp} from 'node:fs/promises';import path from 'node:path';import {tmpdir} from 'node:os';import {randomUUID} from 'node:crypto';import {createJobpilotService} from '../../src/jobpilot/service.js';import {loadJobpilotConfig} from '../../src/jobpilot/config.js';import {demoInput,fakeModel} from '../fixtures/jobpilot/model.js';
test('status in a differently configured process preserves execution provenance',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'jp-provenance-'));let s=await createJobpilotService({root,model:fakeModel(),config:loadJobpilotConfig({JOBPILOT_MODEL:'original-model'})});const batch=await s.analyze(demoInput());await s.close();
 s=await createJobpilotService({root,config:loadJobpilotConfig({JOBPILOT_MODEL:'different-model'})});try{const {results}=await s.reportData(batch.batchId);expect(results[0].provenance.model).toBe('original-model');}finally{await s.close();}
});
test('stale query cannot overwrite approval committed after snapshot read',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'jp-query-race-'));const owner=await createJobpilotService({root,model:fakeModel()}),reader=await createJobpilotService({root,model:fakeModel()});
 try{const batch=await owner.analyze(demoInput());const threadId=batch.tasks[0].threadId;const internal=reader as any;const context=internal.context.bind(internal);let injected=false;
 internal.context=async(...args:unknown[])=>{const ctx=await context(...args);const get=ctx.graph.getState.bind(ctx.graph);ctx.graph.getState=async(...a:unknown[])=>{const snapshot=await get(...a);if(!injected){injected=true;await owner.review({reviewId:randomUUID(),threadId,draftVersion:1,decision:'approve'});}return snapshot;};return ctx;};
 await reader.status(batch.batchId);expect(owner.store.latestResult(threadId)?.review?.decision).toBe('approve');expect(owner.store.task(threadId).status).toBe('completed');
 }finally{await reader.close();await owner.close();}
});
