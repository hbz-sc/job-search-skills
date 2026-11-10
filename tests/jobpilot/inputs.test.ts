import {test,expect} from 'vitest';import {mkdtemp,writeFile,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {loadInputs,freezeInputs,prepareInputs} from '../../src/jobpilot/inputs.js';
import {validateEvidence} from '../../src/jobpilot/evidence.js';
const jobs={schemaVersion:1,summaries:[{jobId:'j1',title:'Java工程师',company:'虚构公司',source:'fixture',capturedAt:'2026-11-01'}],details:[{jobId:'j1',description:'需要 Java 开发经验',source:'fixture',capturedAt:'2026-11-01'}],initialDetailIds:[]};
test('bounded inputs, source IDs, and redaction',()=>{
 const input=prepareInputs('Java项目\n\n电话13812345678 email a@b.com',jobs,{});
 expect(input.resume.text).not.toContain('13812345678');expect(input.resume.text).not.toContain('a@b.com');
 expect(()=>prepareInputs('中'.repeat(20001),jobs,{})).toThrow();
 expect(()=>prepareInputs('Java',{...jobs,summaries:[...jobs.summaries,...jobs.summaries]},{})).toThrow();
 expect(()=>prepareInputs('Java',{...jobs,initialDetailIds:['missing']},{})).toThrow();
 const analysis={recommendation:'recommended' as const,requirements:[],matches:[{requirementId:'x',resumeEvidenceIds:['invented'],reason:'x'}],gaps:[],unknowns:[],rationale:'x'};
 expect(()=>validateEvidence(analysis,undefined,input.resume.evidence)).toThrow();
});
test('Chinese spaced paths freeze inputs and reject invalid UTF8',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'求职 空格-'));const paths={resume:path.join(root,'简历.txt'),jobs:path.join(root,'岗位.json'),preferences:path.join(root,'偏好.json')};
 await writeFile(paths.resume,'Java 项目');await writeFile(paths.jobs,JSON.stringify(jobs));await writeFile(paths.preferences,'{}');
 const input=await loadInputs(paths);const snapshot=await freezeInputs(root,input);await writeFile(paths.resume,'changed');
 expect(JSON.parse(await readFile(snapshot.file,'utf8')).resume.text).toBe('Java 项目');
 expect((await loadInputs(paths)).resume.hash).not.toBe(input.resume.hash);
 await writeFile(paths.resume,Buffer.from([0xff]));await expect(loadInputs(paths)).rejects.toThrow();
});
