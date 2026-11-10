import type {DatabaseSync} from 'node:sqlite';import {randomUUID} from 'node:crypto';
import {hash} from './evidence.js';import {validateSearchPlan} from './search-plan.js';import type {SearchPlan,GreetingTemplate} from './search-types.js';import type {PageJob} from '../boss-extension/store.js';
export type SearchBatch={batchId:string;planId:string;planHash:string;templateId:string|null;expectedPhraseHash:string|null;mode:'preview'|'run';maxContacts:number;usedContacts:number;activeMs:number;status:'ready'|'running'|'paused'|'completed';stopReason:string;createdAt:string};
export type Reservation={attemptId:string;batchId:string;job:PageJob;operationKey:string};
export type StoredOperation={operationId:string;batchId:string;operationKey:string;requestId:string;tool:string;payload:Record<string,unknown>;envelope?:unknown;result?:any};
export type QueryProgress={seenJobKeys:string[];advances:number;noNew:number;exhausted:boolean};
// Existing browser actions hash exact UTF-8 text. Preserve it byte-for-byte:
// whitespace normalization would produce a different send authorization hash.
export const normalizePhrase=(text:string)=>text;
export function createSearchStore(db:DatabaseSync,legacySkip:(jobKey:string,conversationKey?:string)=>boolean){
 db.exec(`CREATE TABLE IF NOT EXISTS search_plans(id TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS greeting_templates(id TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS search_batches(id TEXT PRIMARY KEY,value TEXT NOT NULL,used INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS query_progress(batch_id TEXT NOT NULL,query_index INTEGER NOT NULL,value TEXT NOT NULL,PRIMARY KEY(batch_id,query_index));
 CREATE TABLE IF NOT EXISTS search_reservations(operation_key TEXT PRIMARY KEY,batch_id TEXT NOT NULL,attempt_id TEXT NOT NULL,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS search_operations(id TEXT PRIMARY KEY,operation_key TEXT NOT NULL UNIQUE,batch_id TEXT NOT NULL,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS search_active_segments(id TEXT PRIMARY KEY,batch_id TEXT NOT NULL,elapsed INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS search_recovery(batch_id TEXT PRIMARY KEY,attempts INTEGER NOT NULL DEFAULT 0,target TEXT);`);
 const tx=<T>(f:()=>T):T=>{db.exec('BEGIN IMMEDIATE');try{const r=f();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}};
 const read=(table:string,id:string)=>{const r=db.prepare(`SELECT value FROM ${table} WHERE id=?`).get(id);if(!r)throw Error('NOT_FOUND');return JSON.parse(String(r.value));};
 const getPlan=(id:string)=>validateSearchPlan(read('search_plans',id));
 const getTemplate=(id:string):GreetingTemplate=>{const t=read('greeting_templates',id);if(typeof t.expectedText!=='string'||!t.expectedText.trim()||t.normalizedHash!==hash(normalizePhrase(t.expectedText)))throw Error('TEMPLATE_CHANGED');return t;};
 const getBatch=(id:string):SearchBatch=>{const r=db.prepare('SELECT * FROM search_batches WHERE id=?').get(id);if(!r)throw Error('BATCH_NOT_FOUND');const b=JSON.parse(String(r.value));const p=getPlan(b.planId);if(b.planHash!==p.planHash||b.templateId&&getTemplate(b.templateId).normalizedHash!==b.expectedPhraseHash)throw Error('BATCH_CHANGED');return {...b,usedContacts:Number(r.used),activeMs:Number(r.active)};};
 const getOperation=(key:string):StoredOperation|undefined=>{const r=db.prepare('SELECT value FROM search_operations WHERE operation_key=?').get(key);return r?JSON.parse(String(r.value)):undefined;};
 const updateOperation=(id:string,patch:Partial<StoredOperation>)=>{const o=read('search_operations',id);db.prepare('UPDATE search_operations SET value=? WHERE id=?').run(JSON.stringify({...o,...patch}),id);};
 const getRecovery=(batchId:string)=>{getBatch(batchId);const r=db.prepare('SELECT attempts,target FROM search_recovery WHERE batch_id=?').get(batchId);return {attempts:Number(r?.attempts??0),target:r?.target?JSON.parse(String(r.target)) as {sessionId:string;tabId:number}:null};};
 return {
  getRecovery,
  bindRecoveryTarget(batchId:string,target:{sessionId:string;tabId:number}){return tx(()=>{if(typeof target.sessionId!=='string'||!target.sessionId||!Number.isSafeInteger(target.tabId))throw Error('INVALID_BINDING');const prior=getRecovery(batchId).target;if(prior&&(prior.sessionId!==target.sessionId||prior.tabId!==target.tabId))throw Error('RECOVERY_TARGET_CHANGED');db.prepare('INSERT INTO search_recovery(batch_id,target) VALUES(?,?) ON CONFLICT(batch_id) DO UPDATE SET target=excluded.target').run(batchId,JSON.stringify(target));});},
  reserveRecovery(batchId:string){return tx(()=>{const b=getBatch(batchId);if(b.activeMs>=1800000)throw Error('ACTIVE_TIME_LIMIT');const r=getRecovery(batchId);if(r.attempts>=3)throw Error('AUTO_RECOVERY_LIMIT');db.prepare('INSERT INTO search_recovery(batch_id,attempts) VALUES(?,1) ON CONFLICT(batch_id) DO UPDATE SET attempts=attempts+1').run(batchId);return r.attempts+1;});},
  savePlan(plan:SearchPlan){const p=validateSearchPlan(plan);const prior=db.prepare('SELECT value FROM search_plans WHERE id=?').get(p.planId);if(prior&&String(prior.value)!==JSON.stringify(p))throw Error('PLAN_CONFLICT');db.prepare('INSERT OR IGNORE INTO search_plans VALUES(?,?)').run(p.planId,JSON.stringify(p));},getPlan,
  findPlan(resumeHash:string,model:string,promptVersion:string){for(const r of db.prepare('SELECT value FROM search_plans ORDER BY rowid DESC').all()){const p=validateSearchPlan(JSON.parse(String(r.value)));if(p.resumeHash===resumeHash&&p.model===model&&p.promptVersion===promptVersion)return p;}return undefined;},
  bindTemplate(text:string,source:string):GreetingTemplate{const expectedText=normalizePhrase(text);if(!expectedText.trim()||expectedText.length>10000||!source)throw Error('INVALID_TEMPLATE');const t={templateId:randomUUID(),expectedText,normalizedHash:hash(expectedText),source,boundAt:new Date().toISOString()};db.prepare('INSERT INTO greeting_templates VALUES(?,?)').run(t.templateId,JSON.stringify(t));return t;},getTemplate,
  createBatch(planId:string,templateId:string|null,mode:'preview'|'run',maxContacts:number):SearchBatch{
   const p=getPlan(planId);if(mode==='run'&&!templateId)throw Error('TEMPLATE_REQUIRED');if(!['preview','run'].includes(mode)||!Number.isSafeInteger(maxContacts)||maxContacts<(mode==='run'?1:0)||maxContacts>100||mode==='preview'&&maxContacts!==0)throw Error('INVALID_SCOPE');
   const t=templateId?getTemplate(templateId):null;const b:SearchBatch={batchId:randomUUID(),planId,planHash:p.planHash,templateId,expectedPhraseHash:t?.normalizedHash??null,mode,maxContacts,usedContacts:0,activeMs:0,status:'ready',stopReason:'',createdAt:new Date().toISOString()};
   tx(()=>{db.prepare('INSERT INTO search_batches(id,value) VALUES(?,?)').run(b.batchId,JSON.stringify(b));db.prepare('INSERT INTO page_runs(id,scope,createdAt) VALUES(?,?,?)').run(b.batchId,JSON.stringify({mode:mode==='run'?'batch':'search_only',maxContacts}),b.createdAt);});return b;
  },getBatch,
  setStatus(batchId:string,status:SearchBatch['status'],stopReason=''){const b=getBatch(batchId);db.prepare('UPDATE search_batches SET value=? WHERE id=?').run(JSON.stringify({...b,status,stopReason}),batchId);},
  reserveContact(batchId:string,job:PageJob,operationKey:string):Reservation|null{return tx(()=>{
   const existing=db.prepare('SELECT value FROM search_reservations WHERE operation_key=?').get(operationKey);if(existing){const r=JSON.parse(String(existing.value));if(r.batchId!==batchId||r.job.key!==job.key)throw Error('OPERATION_CONFLICT');return r;}
   const b=getBatch(batchId);if(b.mode!=='run')throw Error('SCOPE_DENIED');if(legacySkip(job.key))return null;if(b.usedContacts>=b.maxContacts)throw Error('CONTACT_LIMIT');
   const r={attemptId:randomUUID(),batchId,job,operationKey};db.prepare('INSERT INTO page_attempts(id,runId,jobKey,job,phrase,phase,updatedAt) VALUES(?,?,?,?,?,?,?)').run(r.attemptId,batchId,job.key,JSON.stringify(job),JSON.stringify({text:getTemplate(b.templateId!).expectedText,hash:b.expectedPhraseHash}),'opening',new Date().toISOString());
   db.prepare('INSERT INTO search_reservations VALUES(?,?,?,?)').run(operationKey,batchId,r.attemptId,JSON.stringify(r));db.prepare('UPDATE search_batches SET used=used+1 WHERE id=?').run(batchId);return r;
  });},
  beginOperation(batchId:string,operationKey:string,tool:string,payload:Record<string,unknown>):StoredOperation{return tx(()=>{getBatch(batchId);const prior=getOperation(operationKey);if(prior){if(prior.batchId!==batchId||prior.tool!==tool||hash(prior.payload)!==hash(payload))throw Error('OPERATION_CONFLICT');return prior;}const o={operationId:randomUUID(),requestId:randomUUID(),batchId,operationKey,tool,payload};db.prepare('INSERT INTO search_operations VALUES(?,?,?,?)').run(o.operationId,operationKey,batchId,JSON.stringify(o));return o;});},
  markDispatched(operationId:string,envelope:unknown){const o=read('search_operations',operationId);if(o.envelope||o.result)throw Error('ALREADY_DISPATCHED');updateOperation(operationId,{envelope});},
  finishOperation(operationId:string,result:unknown){updateOperation(operationId,{result});},getOperation,
  operations(batchId:string):StoredOperation[]{return db.prepare('SELECT value FROM search_operations WHERE batch_id=? ORDER BY rowid').all(batchId).map(r=>JSON.parse(String(r.value)));},
  saveQueryProgress(batchId:string,index:number,progress:QueryProgress){getBatch(batchId);db.prepare('INSERT INTO query_progress VALUES(?,?,?) ON CONFLICT(batch_id,query_index) DO UPDATE SET value=excluded.value').run(batchId,index,JSON.stringify(progress));},
  getQueryProgress(batchId:string,index:number):QueryProgress{const r=db.prepare('SELECT value FROM query_progress WHERE batch_id=? AND query_index=?').get(batchId,index);return r?JSON.parse(String(r.value)):{seenJobKeys:[],advances:0,noNew:0,exhausted:false};},
  addActiveTime(batchId:string,segmentId:string,elapsedMs:number){tx(()=>{getBatch(batchId);if(!Number.isFinite(elapsedMs)||elapsedMs<0)throw Error('INVALID_TIME');const prior=db.prepare('SELECT * FROM search_active_segments WHERE id=?').get(segmentId);if(prior&&prior.batch_id!==batchId)throw Error('OPERATION_CONFLICT');if(prior)return;const ms=Math.ceil(elapsedMs);db.prepare('INSERT INTO search_active_segments VALUES(?,?,?)').run(segmentId,batchId,ms);db.prepare('UPDATE search_batches SET active=active+? WHERE id=?').run(ms,batchId);});},
  finishActiveSegment(batchId:string,segmentId:string,elapsedMs:number){tx(()=>{const prior=db.prepare('SELECT * FROM search_active_segments WHERE id=?').get(segmentId);if(!prior||prior.batch_id!==batchId)throw Error('SEGMENT_NOT_FOUND');const elapsed=Math.min(Number(prior.elapsed),Math.max(0,Math.ceil(elapsedMs)));db.prepare('UPDATE search_active_segments SET elapsed=? WHERE id=?').run(elapsed,segmentId);db.prepare('UPDATE search_batches SET active=active+? WHERE id=?').run(elapsed-Number(prior.elapsed),batchId);});},
  attempts(batchId:string){return db.prepare('SELECT id,job,phase,evidence,conversationKey FROM page_attempts WHERE runId=? ORDER BY rowid').all(batchId).map(r=>({attemptId:String(r.id),job:JSON.parse(String(r.job)) as PageJob,phase:String(r.phase),evidence:r.evidence?JSON.parse(String(r.evidence)):null,conversationKey:r.conversationKey?String(r.conversationKey):null}));}
 };
}
export type SearchStore=ReturnType<typeof createSearchStore>;
