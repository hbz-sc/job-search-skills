import {test,expect} from 'vitest';import {spawnSync} from 'node:child_process';import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';
test('process B resumes checkpoint from exited process A without reanalysis',()=>{
 const root=mkdtempSync(path.join(tmpdir(),'jp-process-')),thread=randomUUID();
 const run=(mode:string)=>{const p=spawnSync(process.execPath,['tests/fixtures/jobpilot/process-worker.mjs',root,thread,mode,randomUUID()],{encoding:'utf8',windowsHide:true,timeout:15000});expect(p.status,p.stderr).toBe(0);return JSON.parse(p.stdout.trim());};
 expect(run('start').interrupted).toBe(true);const b=run('resume');expect(b.status).toBe('completed');expect(b.counts.analyze).toBe(1);expect(b.counts.draft).toBe(1);
},30000);
