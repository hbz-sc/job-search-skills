import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Account,Attempt,Evidence,Job,Phase,RunConfig,StopReason,Template} from '../domain.js';
import {migrate} from './migrations.js';
export type QuotaLatch={accountKey:string;reason:'quota'|'legacy_unverified';evidence:Evidence;createdAt:string};
export interface Store {
 beginRun(a:Account,c:RunConfig,t?:Template):string; saveJobs(jobs:Job[]):void;
 shouldSkip(a:string,j:Job,conversation?:string,excludeAttempt?:string):boolean;
 reserve(runId:string,a:string,j:Job,t:Template):Attempt;
 updateAttempt(id:string,phase:Phase,e?:Evidence,conversation?:string,conversationUrl?:string):void;
 pending(a:string):Attempt[]; stopRun(id:string,r:StopReason,e?:Evidence):void;
 latestStop(a:string):StopReason|undefined; summary():unknown; close():void;
 latchQuota(a:string,reason:QuotaLatch['reason'],e:Evidence):void; getQuota(a:string):QuotaLatch|undefined; releaseQuota(a:string,e:Evidence):void;
 recordEvent(a:string,attemptId:string|undefined,kind:'platform_greeting'|'resume_requested',e:Evidence):void;
 pendingCount(a:string):number;
 importLegacyQuota(a:string,date:string):void; confirmLegacyQuota(a:string,belongs:boolean,e:Evidence):void;
}
export function openStore(file:string):Store {
 if(file!==':memory:')mkdirSync(path.dirname(file),{recursive:true});
 const db=new DatabaseSync(file);
 try{migrate(db,file);db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');}catch(e){db.close();throw e;}
 const transaction=<T>(f:()=>T):T=>{db.exec('BEGIN IMMEDIATE');try{const v=f();db.exec('COMMIT');return v;}catch(e){db.exec('ROLLBACK');throw e;}};
 const save=(j:Job)=>db.prepare('INSERT INTO jobs(key,url,data) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET url=excluded.url,data=excluded.data').run(j.key,j.url,JSON.stringify(j));
 const latch=(a:string,reason:QuotaLatch['reason'],e:Evidence)=>{db.prepare('INSERT INTO account_stops VALUES(?,?,?,?) ON CONFLICT(accountKey) DO UPDATE SET reason=excluded.reason,evidence=excluded.evidence').run(a,reason,JSON.stringify(e),new Date().toISOString());};
 const event=(a:string,id:string|undefined,kind:string,e:Evidence)=>{db.prepare('INSERT INTO attempt_events VALUES(?,?,?,?,?,?)').run(randomUUID(),a,id??null,kind,JSON.stringify(e),new Date().toISOString());};
 return {
  beginRun(a,c,t){const id=randomUUID();transaction(()=>{if(t)db.prepare('INSERT OR IGNORE INTO templates(hash,text) VALUES(?,?)').run(t.hash,t.text);db.prepare('INSERT INTO runs(id,accountKey,config,templateHash,createdAt) VALUES(?,?,?,?,?)').run(id,a.key,JSON.stringify(c),t?.hash??null,new Date().toISOString());});return id;},
  saveJobs(js){transaction(()=>{for(const j of js)save(j);});},
  shouldSkip(a,j,c,except){return !!db.prepare('SELECT id FROM attempts WHERE accountKey=? AND id != ? AND (jobKey=? OR (? IS NOT NULL AND conversationKey=?)) LIMIT 1').get(a,except??'',j.key,c??null,c??null);},
  reserve(runId,accountKey,j,t){return transaction(()=>{save(j);const a:Attempt={id:randomUUID(),runId,accountKey,jobKey:j.key,templateHash:t.hash,phase:'opening'};db.prepare('INSERT INTO attempts(id,runId,accountKey,jobKey,templateHash,phase,updatedAt) VALUES(?,?,?,?,?,?,?)').run(a.id,runId,accountKey,j.key,t.hash,a.phase,new Date().toISOString());return a;});},
  updateAttempt(id,phase,e,c,url){db.prepare('UPDATE attempts SET phase=?,evidence=COALESCE(?,evidence),conversationKey=COALESCE(?,conversationKey),conversationUrl=COALESCE(?,conversationUrl),updatedAt=? WHERE id=?').run(phase,e?JSON.stringify(e):null,c??null,url??null,new Date().toISOString(),id);},
  pending(a){return db.prepare("SELECT * FROM attempts WHERE accountKey=? AND phase IN ('opening','chat_open','sending','unconfirmed')").all(a).map(r=>({...r,evidence:r.evidence?JSON.parse(String(r.evidence)):undefined})) as Attempt[];},
  stopRun(id,r,e){transaction(()=>{db.prepare('UPDATE runs SET stopReason=?,evidence=? WHERE id=?').run(r,e?JSON.stringify(e):null,id);if(r==='quota'){const a=db.prepare('SELECT accountKey FROM runs WHERE id=?').get(id);if(a)latch(String(a.accountKey),'quota',e??{text:'额度上限',url:'local:',observedAt:new Date().toISOString()});}});},
  latchQuota:latch,
  getQuota(a){const r=db.prepare('SELECT * FROM account_stops WHERE accountKey=?').get(a);return r?{...r,evidence:JSON.parse(String(r.evidence))} as QuotaLatch:undefined;},
  releaseQuota(a,e){transaction(()=>{if(db.prepare('SELECT reason FROM account_stops WHERE accountKey=?').get(a)?.reason==='legacy_unverified')throw new Error('旧额度账号归属尚未确认');event(a,undefined,'resume_requested',e);db.prepare('DELETE FROM account_stops WHERE accountKey=?').run(a);});},
  importLegacyQuota(a,date){transaction(()=>{const kind='legacy_quota:'+date;if(db.prepare('SELECT id FROM attempt_events WHERE accountKey=? AND kind=?').get(a,kind))return;const ev={text:'旧资料记载 '+date+' 额度用尽；归属待确认',url:'local:',observedAt:new Date().toISOString()};event(a,undefined,kind,ev);if(!db.prepare('SELECT accountKey FROM account_stops WHERE accountKey=?').get(a))latch(a,'legacy_unverified',ev);});},
  confirmLegacyQuota(a,belongs,e){transaction(()=>{if(db.prepare('SELECT reason FROM account_stops WHERE accountKey=?').get(a)?.reason!=='legacy_unverified')return;event(a,undefined,'legacy_ownership_confirmed',e);if(belongs)latch(a,'quota',e);else db.prepare('DELETE FROM account_stops WHERE accountKey=?').run(a);});},
  recordEvent:event,
  pendingCount(a){return Number(db.prepare("SELECT count(*) n FROM attempts WHERE accountKey=? AND phase IN ('opening','chat_open','sending','unconfirmed')").get(a)?.n??0);},
  latestStop(a){return db.prepare('SELECT stopReason FROM runs WHERE accountKey=? AND stopReason IS NOT NULL ORDER BY rowid DESC LIMIT 1').get(a)?.stopReason as StopReason|undefined;},
  summary(){return {runs:db.prepare('SELECT id,accountKey,createdAt,stopReason FROM runs ORDER BY rowid DESC LIMIT 10').all(),attempts:db.prepare('SELECT accountKey,phase,count(*) AS count FROM attempts GROUP BY accountKey,phase').all(),quota:db.prepare('SELECT accountKey,reason,createdAt FROM account_stops').all(),jobs:db.prepare('SELECT count(*) AS count FROM jobs').get()};},
  close(){db.close();}
 };
}
/** Status must not migrate, create, or acquire a write transaction. */
export function readStoreStatus(file:string,accountKey?:string):unknown{
 const db=new DatabaseSync(file,{readOnly:true});try{
  const filter=accountKey?' WHERE accountKey=?':'';const args=accountKey?[accountKey]:[];
  const runs=db.prepare('SELECT id,accountKey,createdAt,stopReason FROM runs'+filter+' ORDER BY rowid DESC LIMIT 10').all(...args);
  const attempts=db.prepare('SELECT accountKey,phase,count(*) AS count FROM attempts'+filter+' GROUP BY accountKey,phase').all(...args);
  const pending=db.prepare("SELECT accountKey,count(*) AS count FROM attempts WHERE phase IN ('opening','chat_open','sending','unconfirmed')"+(accountKey?' AND accountKey=?':'')+' GROUP BY accountKey').all(...args);
  const hasQuota=db.prepare("SELECT name FROM sqlite_master WHERE name='account_stops'").get();
  const quota=hasQuota?db.prepare('SELECT accountKey,reason,createdAt FROM account_stops'+filter).all(...args):[];
  return {runs,attempts,pending,quota};
 }finally{db.close();}
}
