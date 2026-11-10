import {test,expect} from 'vitest';
import {mkdtempSync,readdirSync,readFileSync,writeFileSync,existsSync,mkdirSync,symlinkSync} from 'node:fs';
import path from 'node:path';import {tmpdir} from 'node:os';
import {saveDiagnostic} from '../src/diagnostics.js';
import {evidence} from '../src/domain.js';
test('limits screenshots and retains ten owned runs without deleting user-added files',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'boss-diag-'));const ctx={root,accountKey:'private-account',runId:'first'};
 const first=await saveDiagnostic(ctx,evidence('Cookie: secret; token=abc','https://www.zhipin.com/web/geek/chat?token=abc'),Buffer.from('png'));
 const custom=path.join(path.dirname(first),'user-note.txt');writeFileSync(custom,'keep');
 for(let n=0;n<25;n++)await saveDiagnostic(ctx,evidence('error'),Buffer.from('png'));
 expect(readdirSync(path.dirname(first)).filter(f=>f.endsWith('.png'))).toHaveLength(20);
 expect(readFileSync(first,'utf8')).not.toContain('secret');expect(readFileSync(first,'utf8')).not.toContain('abc');
 for(let n=0;n<10;n++)await saveDiagnostic({...ctx,runId:'later-'+n},evidence('error'));
 const manifests=readdirSync(root,{recursive:true}).filter(f=>String(f).endsWith('.boss-manifest.json'));
 expect(manifests).toHaveLength(10);expect(existsSync(custom)).toBe(true);expect(existsSync(first)).toBe(false);
});
test('refuses reparse point diagnostics root rather than writing outside it',async()=>{
 const parent=mkdtempSync(path.join(tmpdir(),'boss-diag-link-'));const external=mkdtempSync(path.join(tmpdir(),'boss-out-'));const root=path.join(parent,'linked');symlinkSync(external,root,'junction');
 await expect(saveDiagnostic({root,accountKey:'a',runId:'r'},evidence('x'))).rejects.toThrow();expect(readdirSync(external)).toEqual([]);
});
