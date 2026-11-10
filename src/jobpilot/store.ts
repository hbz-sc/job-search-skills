import {DatabaseSync} from 'node:sqlite';import {mkdirSync} from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {hash} from './evidence.js';import {DEFAULT_LIMITS,type Limits} from './config.js';import type {JobResult,ReviewRequest,InputSnapshot,Profile,TaskStatus} from './types.js';
type Budget={modelAttempts:number;toolAttempts:number;decisionTurns:number;revisionCount:number;activeMs:number};
export type TaskRow={threadId:string;batchId:string;jobId:string;status:TaskStatus;schemaVersion:number};
export function openJobpilotStore(file:string,limits:Limits=DEFAULT_LIMITS){return new JobpilotStore(file,limits);}
export class JobpilotStore{
 private db:DatabaseSync;
 constructor(file:string,private limits:Limits){
  if(file!==':memory:')mkdirSync(path.dirname(path.resolve(file)),{recursive:true});this.db=new DatabaseSync(file);
  this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS batches(id TEXT PRIMARY KEY,snapshot TEXT NOT NULL,profile TEXT);
   CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,batch_id TEXT NOT NULL,job_id TEXT NOT NULL,status TEXT NOT NULL,version INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS results(thread_id TEXT NOT NULL,version INTEGER NOT NULL,batch_id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(thread_id,version));
   CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY,thread_id TEXT NOT NULL,payload_hash TEXT NOT NULL,request TEXT NOT NULL,status TEXT NOT NULL,response TEXT);
   CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY,scope TEXT NOT NULL,kind TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,pending INTEGER NOT NULL DEFAULT 0,response TEXT);
   CREATE TABLE IF NOT EXISTS budgets(scope TEXT PRIMARY KEY,model INTEGER NOT NULL DEFAULT 0,tool INTEGER NOT NULL DEFAULT 0,decisions INTEGER NOT NULL DEFAULT 0,revisions INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE IF NOT EXISTS logical_steps(id TEXT PRIMARY KEY,scope TEXT NOT NULL,kind TEXT NOT NULL);`);
 }
 private tx<T>(f:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const result=f();this.db.exec('COMMIT');return result;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 private ensure(scope:string){this.db.prepare('INSERT OR IGNORE INTO budgets(scope) VALUES(?)').run(scope);}
 getBudget(scope:string):Budget{this.ensure(scope);const b=this.db.prepare('SELECT * FROM budgets WHERE scope=?').get(scope)!;return {modelAttempts:Number(b.model),toolAttempts:Number(b.tool),decisionTurns:Number(b.decisions),revisionCount:Number(b.revisions),activeMs:Number(b.active)};}
 reserveAttempt(scope:string,kind:'model'|'tool',id:string){this.tx(()=>{
  const b=this.getBudget(scope);const max=kind==='model'?(scope.startsWith('profile:')?this.limits.profileAttempts:this.limits.modelAttempts):this.limits.toolAttempts;
  const count=kind==='model'?b.modelAttempts:b.toolAttempts;
  if(count>=max||b.activeMs>=this.limits.activeMs)throw Error('budget_exceeded');
  const op=this.db.prepare('SELECT * FROM operations WHERE id=?').get(id);
  if(op&&(op.scope!==scope||op.kind!==kind))throw Error('operation_conflict');
  if(op&&Number(op.attempts)>=2)throw Error('budget_exceeded');
  this.db.prepare('INSERT INTO operations(id,scope,kind,attempts,pending) VALUES(?,?,?,1,1) ON CONFLICT(id) DO UPDATE SET attempts=attempts+1,pending=1').run(id,scope,kind);
  this.db.prepare(`UPDATE budgets SET ${kind}=${kind}+1 WHERE scope=?`).run(scope);
 });}
 finishAttempt(id:string,elapsed:number){this.tx(()=>{const row=this.db.prepare('SELECT scope,pending FROM operations WHERE id=?').get(id);if(row?.pending){this.chargeActive(String(row.scope),elapsed);this.db.prepare('UPDATE operations SET pending=0 WHERE id=?').run(id);}});}
 recoverPending(scope:string){this.tx(()=>{for(const r of this.db.prepare('SELECT id,kind FROM operations WHERE scope=? AND pending=1').all(scope)){this.chargeActive(scope,r.kind==='model'?this.limits.modelTimeoutMs:this.limits.toolTimeoutMs);this.db.prepare('UPDATE operations SET pending=0 WHERE id=?').run(r.id!);}});}
 chargeActive(scope:string,ms:number){this.ensure(scope);this.db.prepare('UPDATE budgets SET active=active+? WHERE scope=?').run(Math.max(0,Math.ceil(ms)),scope);}
 hasStep(scope:string,id:string){return !!this.db.prepare('SELECT id FROM logical_steps WHERE scope=? AND id=?').get(scope,id);}
 private increment(scope:string,column:'decisions'|'revisions',max:number,id:string){this.tx(()=>{const existing=this.db.prepare('SELECT scope,kind FROM logical_steps WHERE id=?').get(id);if(existing){if(existing.scope!==scope||existing.kind!==column)throw Error('operation_conflict');return;}this.ensure(scope);const row=this.db.prepare(`SELECT ${column} AS n FROM budgets WHERE scope=?`).get(scope)!;if(Number(row.n)>=max)throw Error('budget_exceeded');this.db.prepare('INSERT INTO logical_steps VALUES(?,?,?)').run(id,scope,column);this.db.prepare(`UPDATE budgets SET ${column}=${column}+1 WHERE scope=?`).run(scope);});}
 incrementDecision(scope:string,id:string=randomUUID()){this.increment(scope,'decisions',this.limits.decisionTurns,id);}
 incrementRevision(scope:string,id:string=randomUUID()){this.increment(scope,'revisions',this.limits.revisions,id);}
 getOperation(id:string):unknown|undefined{const row=this.db.prepare('SELECT response FROM operations WHERE id=?').get(id);return row?.response?JSON.parse(String(row.response)):undefined;}
 completeOperation(id:string,response:unknown,elapsedMs=0){this.tx(()=>{const row=this.db.prepare('SELECT scope,pending FROM operations WHERE id=?').get(id);if(row?.pending)this.chargeActive(String(row.scope),elapsedMs);this.db.prepare('UPDATE operations SET response=?,pending=0 WHERE id=?').run(JSON.stringify(response),id);});}
 operationAttempts(id:string){return Number(this.db.prepare('SELECT attempts FROM operations WHERE id=?').get(id)?.attempts??0);}
 createBatch(id:string,snapshot:InputSnapshot){this.db.prepare('INSERT INTO batches(id,snapshot) VALUES(?,?)').run(id,JSON.stringify(snapshot));}
 getBatch(id:string):{snapshot:InputSnapshot;profile?:Profile}{const r=this.db.prepare('SELECT * FROM batches WHERE id=?').get(id);if(!r)throw Error('batch_not_found');return {snapshot:JSON.parse(String(r.snapshot)),profile:r.profile?JSON.parse(String(r.profile)):undefined};}
 saveProfile(id:string,profile:Profile){this.db.prepare('UPDATE batches SET profile=? WHERE id=?').run(JSON.stringify(profile),id);}
 createTask(r:TaskRow){this.db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?)').run(r.threadId,r.batchId,r.jobId,r.status,r.schemaVersion);}
 task(id:string):TaskRow{const r=this.db.prepare('SELECT * FROM tasks WHERE id=?').get(id);if(!r)throw Error('task_not_found');return {threadId:String(r.id),batchId:String(r.batch_id),jobId:String(r.job_id),status:r.status as TaskStatus,schemaVersion:Number(r.version)};}
 tasks(batchId:string){return this.db.prepare('SELECT id FROM tasks WHERE batch_id=? ORDER BY rowid').all(batchId).map(r=>this.task(String(r.id)));}
 setStatus(id:string,status:TaskStatus){this.db.prepare('UPDATE tasks SET status=? WHERE id=?').run(status,id);}
 saveResult(result:JobResult){this.db.prepare('INSERT INTO results VALUES(?,?,?,?) ON CONFLICT(thread_id,version) DO UPDATE SET value=excluded.value').run(result.threadId,result.draftVersion,result.batchId,JSON.stringify(result));}
 results(batchId:string):JobResult[]{return this.db.prepare('SELECT value FROM results WHERE batch_id=? ORDER BY rowid').all(batchId).map(r=>JSON.parse(String(r.value)));}
 latestResult(threadId:string):JobResult|undefined{const r=this.db.prepare('SELECT value FROM results WHERE thread_id=? ORDER BY version DESC LIMIT 1').get(threadId);return r?JSON.parse(String(r.value)):undefined;}
 reserveReview(r:ReviewRequest):'new'|'pending'|'completed'{return this.tx(()=>{const prev=this.db.prepare('SELECT * FROM reviews WHERE id=?').get(r.reviewId);const payload=hash(r);if(prev){if(prev.payload_hash!==payload)throw Error('review_conflict');return prev.status as 'pending'|'completed';}this.db.prepare('INSERT INTO reviews VALUES(?,?,?,?,?,NULL)').run(r.reviewId,r.threadId,payload,JSON.stringify(r),'pending');return 'new';});}
 getReview(id:string):{request:ReviewRequest;status:string;response?:JobResult}|undefined{const r=this.db.prepare('SELECT * FROM reviews WHERE id=?').get(id);return r?{request:JSON.parse(String(r.request)),status:String(r.status),response:r.response?JSON.parse(String(r.response)):undefined}:undefined;}
 pendingReviews(threadId:string){return this.db.prepare("SELECT request FROM reviews WHERE thread_id=? AND status='pending'").all(threadId).map(r=>JSON.parse(String(r.request)) as ReviewRequest);}
 completeReview(id:string,result:JobResult){this.db.prepare("UPDATE reviews SET status='completed',response=? WHERE id=?").run(JSON.stringify(result),id);}
 close(){this.db.close();}
}
