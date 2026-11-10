import {type DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {schema} from './schema.js';
export const databaseVersion=1;
export function migrate(db:DatabaseSync,file:string):void {
 const version=Number(db.prepare('PRAGMA user_version').get()?.user_version??0);
 if(version>databaseVersion)throw new Error('数据库版本比程序新，拒绝修改');
 if(version===databaseVersion)return;
 const hasOld=!!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='runs'").get();
 if(hasOld&&file!==':memory:'){
  // Transactionally consistent backup, including committed WAL data.
  const dest=file+'.backup-'+randomUUID()+'.sqlite';db.exec("VACUUM INTO '"+dest.replace(/'/g,"''")+"'");
 }
 db.exec('BEGIN IMMEDIATE');
 try{
  db.exec(schema.replace(/PRAGMA[^;]+;/g,''));
  db.exec(`CREATE TABLE account_stops(accountKey TEXT PRIMARY KEY,reason TEXT NOT NULL,evidence TEXT NOT NULL,createdAt TEXT NOT NULL);
   CREATE TABLE attempt_events(id TEXT PRIMARY KEY,accountKey TEXT NOT NULL,attemptId TEXT,kind TEXT NOT NULL,evidence TEXT NOT NULL,createdAt TEXT NOT NULL);`);
  const rows=db.prepare("SELECT accountKey,evidence,createdAt FROM runs WHERE stopReason='quota' ORDER BY rowid DESC").all();
  for(const r of rows)db.prepare('INSERT OR IGNORE INTO account_stops VALUES(?,?,?,?)').run(String(r.accountKey),'quota',r.evidence??JSON.stringify({text:'历史额度停止',url:'local:',observedAt:r.createdAt}),String(r.createdAt));
  db.exec('PRAGMA user_version=1; COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
}
