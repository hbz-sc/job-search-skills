import {test,expect} from 'vitest';import {mkdtemp,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';import {exportBatch} from '../../src/jobpilot/report.js';
test('report keeps waiting and failures, never labels approval as sent',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'jp-report-')),batchId=randomUUID();const tasks=['completed','waiting_review','failed'].map((status,i)=>({threadId:randomUUID(),jobId:'job'+i,status:status as 'completed'|'waiting_review'|'failed'}));
 const paths=await exportBatch({batchId,tasks},tasks.map(t=>({...t,batchId,draftVersion:1,taskStatus:t.status,provenance:{},error:t.status==='failed'?'model_unavailable':undefined})),root);
 expect(JSON.parse(await readFile(paths.jsonPath,'utf8')).results).toHaveLength(3);const md=await readFile(paths.markdownPath,'utf8');expect(md).toContain('waiting_review');expect(md).toContain('failed');expect(md).not.toContain('已发送');
});
