import {it,expect} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openStore} from '../src/storage/store.js';
import {openPageWorkflowStore} from '../src/boss-extension/store.js';
it('retains legacy quota and contact history without using account identity',()=>{
 const root=mkdtempSync(path.join(tmpdir(),'boss-page-store-'));const file=path.join(root,'test.sqlite');
 try{const old=openStore(file);old.close();const db=new DatabaseSync(file);db.prepare('INSERT INTO account_stops VALUES(?,?,?,?)').run('old-account','quota','{}','2026-10-26');db.close();
 const s=openPageWorkflowStore(file);expect(s.getBlockers()).toContain('LEGACY_QUOTA_STOP');
 const run=s.beginRun({mode:'greet_once',maxContacts:1});const a=s.reserveContact(run,{key:'job1',title:'AI',company:'公司',url:'https://www.zhipin.com/job_detail/job1.html'});
 expect(s.getBlockers()).toContain('UNRESOLVED_CONTACT');expect(s.shouldSkip('job1')).toBe(true);
 expect(()=>s.reserveContact(run,{key:'job1',title:'AI',company:'公司',url:''})).toThrow();
 s.pinPhrase(a,{text:'原文\n ',hash:'a'.repeat(64)});s.updateAttempt(a,'confirmed');expect(s.getBlockers()).not.toContain('UNRESOLVED_CONTACT');s.close();
 const check=new DatabaseSync(file);expect(check.prepare('SELECT count(*) n FROM account_stops').get()?.n).toBe(1);check.close();
 }finally{rmSync(root,{recursive:true,force:true});}
});
it('skips confirmed manual CSV-only history by both job key and canonical URL',()=>{
 const root=mkdtempSync(path.join(tmpdir(),'boss-csv-history-'));let s:ReturnType<typeof openPageWorkflowStore>|undefined;try{
 writeFileSync(path.join(root,'jobs.csv'),'job_id,source_url,status\ncsv-id,,user_sent_greeting\n,https://www.zhipin.com/job_detail/url-id.html?source=x,awaiting_reply\ndraft-id,,draft\n');
 s=openPageWorkflowStore(path.join(root,'boss.sqlite'));expect(s.shouldSkip('csv-id')).toBe(true);expect(s.shouldSkip('url-id')).toBe(true);expect(s.shouldSkip('draft-id')).toBe(false);
 }finally{s?.close();rmSync(root,{recursive:true,force:true});}
});
