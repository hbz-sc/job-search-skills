import {test,expect} from 'vitest';import {mkdtemp} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {createJobpilotService} from '../../src/jobpilot/service.js';import {demoInput,fakeModel} from '../fixtures/jobpilot/model.js';
test('batch waits independently, profile once, resume does not approve and reject saves result',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'jp-service-'));let profiles=0;const service=await createJobpilotService({root,model:fakeModel(op=>{if(op==='profile')profiles++;})});
 try{const input=demoInput();input.jobs.summaries.push({...input.jobs.summaries[0],jobId:'j2'});input.jobs.details.push({...input.jobs.details[0],jobId:'j2'});input.jobs.initialDetailIds.push('j2');
 const batch=await service.analyze(input);expect(batch.tasks.map(t=>t.status)).toEqual(['waiting_review','waiting_review']);expect(profiles).toBe(1);
 const t=batch.tasks[0];expect((await service.resume(t.threadId)).taskStatus).toBe('waiting_review');
 const result=await service.review({reviewId:randomUUID(),threadId:t.threadId,draftVersion:1,decision:'reject'});expect(result.review?.decision).toBe('reject');expect(result.taskStatus).toBe('completed');
 }finally{await service.close();}
});
