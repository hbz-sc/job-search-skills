import {test,expect} from 'vitest';import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {openJobpilotStore} from '../../src/jobpilot/store.js';import {DEFAULT_LIMITS} from '../../src/jobpilot/config.js';
test('persistent attempts, cache, result and review idempotency',()=>{
 const file=path.join(mkdtempSync(path.join(tmpdir(),'jp-store-')),'app.sqlite');let s=openJobpilotStore(file,DEFAULT_LIMITS);
 for(let i=0;i<12;i++)s.reserveAttempt('thread','model','op'+i);
 expect(()=>s.reserveAttempt('thread','model','extra')).toThrow('budget_exceeded');s.close();s=openJobpilotStore(file,DEFAULT_LIMITS);
 expect(s.getBudget('thread').modelAttempts).toBe(12);
 s.completeOperation('op0',{value:1});expect(s.getOperation('op0')).toEqual({value:1});
 const result={threadId:randomUUID(),batchId:randomUUID(),jobId:'j',draftVersion:1,taskStatus:'completed' as const,provenance:{}};
 s.saveResult(result);s.saveResult(result);expect(s.results(result.batchId)).toHaveLength(1);
 const r={reviewId:randomUUID(),threadId:result.threadId,draftVersion:1,decision:'approve' as const};
 expect(s.reserveReview(r)).toBe('new');expect(s.reserveReview(r)).toBe('pending');s.completeReview(r.reviewId,result);expect(s.reserveReview(r)).toBe('completed');expect(()=>s.reserveReview({...r,decision:'reject'})).toThrow();s.close();
});
