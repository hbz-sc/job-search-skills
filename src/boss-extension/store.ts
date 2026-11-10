import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import type {PageScope} from './run-policy.js';
import {loadLegacySentJobs} from '../storage/history.js';
import {createSearchStore} from '../jobpilot/search-store.js';
export type PageJob={key:string;title:string;company:string;url:string;unsupportedChat?:boolean};
export type Phrase={text:string;hash:string};
export function openPageWorkflowStore(file:string){
 const historical=file===':memory:'?new Set<string>():loadLegacySentJobs(['jobs.csv','conversations.csv'].map(f=>path.join(path.dirname(path.resolve(file)),f)));
 if(file!==':memory:')mkdirSync(path.dirname(path.resolve(file)),{recursive:true});
 const db=new DatabaseSync(file);db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON');
 const table=(name:string)=>Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name));
 if(!table('page_runs')){
  if(file!==':memory:'&&table('runs'))db.exec("VACUUM INTO '"+(file+'.backup-page-'+randomUUID()+'.sqlite').replace(/'/g,"''")+"'");
  db.exec('BEGIN IMMEDIATE');try{db.exec(`
   CREATE TABLE page_runs(id TEXT PRIMARY KEY,scope TEXT NOT NULL,createdAt TEXT NOT NULL,summary TEXT);
   CREATE TABLE page_attempts(id TEXT PRIMARY KEY,runId TEXT NOT NULL REFERENCES page_runs(id),jobKey TEXT NOT NULL UNIQUE,job TEXT NOT NULL,conversationKey TEXT,phrase TEXT,phase TEXT NOT NULL,evidence TEXT,updatedAt TEXT NOT NULL);
   CREATE TABLE page_stops(reason TEXT PRIMARY KEY,evidence TEXT NOT NULL,createdAt TEXT NOT NULL);
   COMMIT;`);}catch(e){db.exec('ROLLBACK');db.close();throw e;}
 }
 const blocked=(excludeAttempt?:string)=>{
  const out=db.prepare('SELECT reason FROM page_stops').all().map(r=>String(r.reason));
  if(table('account_stops')&&db.prepare('SELECT 1 FROM account_stops LIMIT 1').get())out.push('LEGACY_QUOTA_STOP');
  if(table('attempts')&&db.prepare("SELECT 1 FROM attempts WHERE phase IN ('opening','chat_open','sending','unconfirmed') LIMIT 1").get())out.push('LEGACY_UNRESOLVED_CONTACT');
  if(db.prepare("SELECT 1 FROM page_attempts WHERE phase NOT IN ('confirmed','skipped','failed','deferred') AND id<>? LIMIT 1").get(excludeAttempt??''))out.push('UNRESOLVED_CONTACT');
  return out;
 };
 const shouldSkip=(jobKey:string,conversationKey?:string)=>{
   if(historical.has(jobKey)||historical.has('https://www.zhipin.com/job_detail/'+jobKey+'.html'))return true;
   if(db.prepare('SELECT 1 FROM page_attempts WHERE jobKey=? OR (? IS NOT NULL AND conversationKey=?) LIMIT 1').get(jobKey,conversationKey??null,conversationKey??null))return true;
   return table('attempts')&&!!db.prepare('SELECT 1 FROM attempts WHERE jobKey=? OR (? IS NOT NULL AND conversationKey=?) LIMIT 1').get(jobKey,conversationKey??null,conversationKey??null);
 };
 return {
  search:createSearchStore(db,shouldSkip),
  beginRun(scope:PageScope){const id=randomUUID();db.prepare('INSERT INTO page_runs(id,scope,createdAt) VALUES(?,?,?)').run(id,JSON.stringify(scope),new Date().toISOString());return id;},
  finishRun(id:string,summary:unknown){db.prepare('UPDATE page_runs SET summary=? WHERE id=?').run(JSON.stringify(summary),id);},
  reserveContact(runId:string,job:PageJob){const id=randomUUID();db.prepare('INSERT INTO page_attempts(id,runId,jobKey,job,phase,updatedAt) VALUES(?,?,?,?,?,?)').run(id,runId,job.key,JSON.stringify(job),'opening',new Date().toISOString());return id;},
  pinPhrase(id:string,phrase:Phrase){db.prepare('UPDATE page_attempts SET phrase=?,updatedAt=? WHERE id=? AND phrase IS NULL').run(JSON.stringify(phrase),new Date().toISOString(),id);},
  updateAttempt(id:string,phase:'opening'|'chat_open'|'sending'|'confirmed'|'uncertain'|'skipped'|'failed'|'deferred',evidence?:unknown,conversationKey?:string){db.prepare('UPDATE page_attempts SET phase=?,evidence=COALESCE(?,evidence),conversationKey=COALESCE(?,conversationKey),updatedAt=? WHERE id=?').run(phase,evidence===undefined?null:JSON.stringify(evidence),conversationKey??null,new Date().toISOString(),id);},
  shouldSkip,
  getBlockers:()=>blocked(),
  getRecoveryBlockers:(id:string)=>blocked(id),
  getAttempt(id:string){const row=db.prepare('SELECT * FROM page_attempts WHERE id=?').get(id);return row?{id:String(row.id),runId:String(row.runId),job:JSON.parse(String(row.job)) as PageJob,phase:String(row.phase),phrase:row.phrase?JSON.parse(String(row.phrase)) as Phrase:null}:undefined;},
  stop(reason:string,evidence:unknown){db.prepare('INSERT OR REPLACE INTO page_stops VALUES(?,?,?)').run(reason,JSON.stringify(evidence),new Date().toISOString());},
  close(){db.close();}
 };
}
export type PageWorkflowStore=ReturnType<typeof openPageWorkflowStore>;
