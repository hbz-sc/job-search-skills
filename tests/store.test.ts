import {test,expect} from 'vitest';
import {mkdtempSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openStore} from '../src/storage/store.js';
import {loadLegacySentJobs} from '../src/storage/history.js';
import {loadConfig} from '../src/config.js';
import {template, evidence} from '../src/domain.js';
const account={key:'a1',displayName:'同名用户'}, t=template('你好');
const job={key:'job1',url:'https://www.zhipin.com/job_detail/job1.html',company:'公司',title:'AI',collectedAt:new Date().toISOString()};
test('quota latch survives collection, date changes and reopening, isolated per account',()=>{
 const file=path.join(mkdtempSync(path.join(tmpdir(),'boss-quota-')),'db.sqlite');let s=openStore(file);
 s.latchQuota('a1','quota',{...evidence('额度上限'),observedAt:'2026-10-26T00:00:00Z'});
 const r=s.beginRun(account,loadConfig({keywords:['AI']},process.cwd()));s.stopRun(r,'exhausted');s.close();s=openStore(file);
 expect(s.getQuota('a1')?.reason).toBe('quota');expect(s.getQuota('a2')).toBeUndefined();
 s.releaseQuota('a2',evidence('恢复'));expect(s.getQuota('a1')).toBeDefined();
 s.releaseQuota('a1',evidence('已只读核对'));expect(s.getQuota('a1')).toBeUndefined();s.close();
});
test('migration backs up old data and does not erase quota hidden by a later collect',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'boss-migrate-'));const file=path.join(dir,'db.sqlite');
 const d=new DatabaseSync(file);d.exec("CREATE TABLE runs(id TEXT PRIMARY KEY,accountKey TEXT,config TEXT,templateHash TEXT,createdAt TEXT,stopReason TEXT,evidence TEXT); INSERT INTO runs VALUES('old','a1','{}',NULL,'2026-10-26','quota',NULL); INSERT INTO runs VALUES('collect','a1','{}',NULL,'2026-10-27','exhausted',NULL);");d.close();
 const s=openStore(file);expect(s.getQuota('a1')?.reason).toBe('quota');expect(readdirSync(dir).some(f=>f.includes('.backup-'))).toBe(true);s.close();
 const inspect=new DatabaseSync(file);expect(inspect.prepare('SELECT count(*) n FROM runs').get()?.n).toBe(2);inspect.exec('PRAGMA user_version=999');inspect.close();
 expect(()=>openStore(file)).toThrow(/版本/);
});
test('persists intentions, conversation dedup and quota across reopen',()=>{
 const db=path.join(mkdtempSync(path.join(tmpdir(),'boss-')),'db.sqlite');
 let s=openStore(db);const run=s.beginRun(account,loadConfig({keywords:['AI']},process.cwd()),t);
 const a=s.reserve(run,account.key,job,t);
 expect(()=>s.reserve(run,account.key,job,t)).toThrow();
 s.updateAttempt(a.id,'sending',undefined,'chat1','https://www.zhipin.com/web/geek/chat?bossId=1');
 expect(s.shouldSkip(account.key,{...job,key:'job2'},'chat1')).toBe(true);
 expect(s.shouldSkip(account.key,{...job,key:'job2'},'chat2')).toBe(false);
 expect(s.shouldSkip('a2',job)).toBe(false);
 s.stopRun(run,'quota',evidence('当日沟通已达上限'));s.close();s=openStore(db);
 expect(s.pending(account.key)[0].phase).toBe('sending');expect(s.latestStop(account.key)).toBe('quota');
 s.updateAttempt(a.id,'confirmed',evidence('送达'),'chat1');expect(s.pending(account.key)).toHaveLength(0);s.close();
});
test('legacy CSV preserves quoted multiline and excludes drafts',()=>{
 const f=path.join(mkdtempSync(path.join(tmpdir(),'boss-csv-')),'history.csv');
 const text='job_id,source_url,status,greeting_draft\r\n1,https://www.zhipin.com/job_detail/a.html?x=1,user_sent_greeting,"hello,\nworld"\r\n2,,draft,no\r\n,,resume_sent,no\r\n';writeFileSync(f,text);
 const sent=loadLegacySentJobs([f]);expect(sent.has('1')).toBe(true);expect(sent.has('https://www.zhipin.com/job_detail/a.html')).toBe(true);expect(sent.has('2')).toBe(false);expect(readFileSync(f,'utf8')).toBe(text);
});
test('legacy profile quota is imported once and cannot be resumed before ownership confirmation',()=>{
 const s=openStore(':memory:');try{
  s.importLegacyQuota('a1','2026-10-26');expect(s.getQuota('a1')?.reason).toBe('legacy_unverified');
  expect(()=>s.releaseQuota('a1',evidence('恢复'))).toThrow();
  s.confirmLegacyQuota('a1',true,evidence('用户确认属于此账号'));expect(s.getQuota('a1')?.reason).toBe('quota');
  s.releaseQuota('a1',evidence('恢复'));s.importLegacyQuota('a1','2026-10-26');expect(s.getQuota('a1')).toBeUndefined();
 }finally{s.close();}
});
