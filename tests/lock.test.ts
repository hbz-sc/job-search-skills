import {test,expect} from 'vitest';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {acquireRunLock} from '../src/run-lock.js';
import {spawn,type ChildProcess} from 'node:child_process';
const worker=(file:string)=>{const child=spawn(process.execPath,['tests/fixtures/lock-worker.mjs',file],{stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});return {child,result:new Promise<string>((resolve,reject)=>{child.once('message',m=>resolve(String(m)));child.once('error',reject);})};};
const kill=async(c:ChildProcess)=>{if(c.exitCode!==null)return;await new Promise<void>(r=>{c.once('exit',()=>r());c.kill();});};
test('concurrent owners and crash recovery do not unlink another owner lock',async()=>{
 const f=path.join(mkdtempSync(path.join(tmpdir(),'boss-parallel-')),'boss-run-lock.sqlite');
 const a=worker(f),b=worker(f);const results=await Promise.all([a.result,b.result]);expect(results.filter(r=>r==='acquired')).toHaveLength(1);
 await Promise.all([kill(a.child),kill(b.child)]);
 const c=worker(f);expect(await c.result).toBe('acquired');await expect(acquireRunLock(f)).rejects.toThrow();await kill(c.child);
 const release=await acquireRunLock(f);await release();await release();
});
test('one instance only; released lock is reusable',async()=>{const f=path.join(mkdtempSync(path.join(tmpdir(),'boss-lock-')),'run.lock');const release=await acquireRunLock(f);await expect(acquireRunLock(f)).rejects.toThrow();await release();const next=await acquireRunLock(f);await next();});
test('unknown/corrupt lock is not deleted',async()=>{const f=path.join(mkdtempSync(path.join(tmpdir(),'boss-lock-')),'run.lock');writeFileSync(f,'broken');await expect(acquireRunLock(f)).rejects.toThrow();});
