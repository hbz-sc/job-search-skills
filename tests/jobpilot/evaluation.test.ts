import {test,expect} from 'vitest';import {readFile} from 'node:fs/promises';import {prepareInputs} from '../../src/jobpilot/inputs.js';
test('evaluation has fixed 12 cases, 8/4 split and valid evidence labels outside model input',async()=>{
 const root='tests/fixtures/jobpilot/evaluation/';const cases=JSON.parse(await readFile(root+'jobs.json','utf8'));const labels=JSON.parse(await readFile(root+'labels.json','utf8'));const split=JSON.parse(await readFile(root+'split.json','utf8'));
 expect(cases.summaries).toHaveLength(12);expect(labels).toHaveLength(12);expect(split.dev).toHaveLength(8);expect(split.holdout).toHaveLength(4);
 expect(Object.fromEntries(['strong','partial','mismatch','recoverable','missing','injection'].map(c=>[c,labels.filter((l:any)=>l.category===c).length]))).toEqual({strong:3,partial:3,mismatch:2,recoverable:2,missing:1,injection:1});
 for(const label of labels){const bundle={...cases,summaries:cases.summaries.filter((j:any)=>j.jobId===label.jobId),details:cases.details.filter((j:any)=>j.jobId===label.jobId),initialDetailIds:cases.initialDetailIds.filter((id:string)=>id===label.jobId)};const input=prepareInputs('Java',bundle,{});const ids=new Set(input.jobs.details.flatMap(d=>d.evidence.map(e=>e.id)));expect(label.requiredEvidenceIds.every((id:string)=>ids.has(id))).toBe(true);expect(JSON.stringify(input)).not.toContain('allowedRecommendations');}
});
