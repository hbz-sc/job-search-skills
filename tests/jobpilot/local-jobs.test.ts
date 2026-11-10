import {test,expect} from 'vitest';import {prepareInputs} from '../../src/jobpilot/inputs.js';import {LocalJobSource} from '../../src/jobpilot/tools/local-jobs.js';
test('summary hides detail; detail lookup is explicit',async()=>{
 const input=prepareInputs('Java',{schemaVersion:1,summaries:[{jobId:'j',title:'Java',company:'虚构',source:'fixture',capturedAt:'2026-11-01'}],details:[{jobId:'j',description:'Spring Boot',source:'fixture',capturedAt:'2026-11-01'}],initialDetailIds:[]},{});
 const source=new LocalJobSource(input.jobs);expect(JSON.stringify(await source.listJobs())).not.toContain('Spring Boot');
 expect((await source.getJobDetail('j')).status).toBe('ok');expect((await source.getJobDetail('missing')).status).toBe('not_found');
});
