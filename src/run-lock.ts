import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,existsSync,readFileSync} from 'node:fs';
import path from 'node:path';
function checkLegacy(file:string){
 if(!existsSync(file))return;
 let old:{pid?:number};try{old=JSON.parse(readFileSync(file,'utf8'));}catch{throw new Error('旧运行锁无法核实，请先关闭旧程序');}
 if(!Number.isSafeInteger(old.pid)||(old.pid??0)<=0)throw new Error('旧运行锁内容无效');
 try{process.kill(old.pid!,0);}catch(e){if((e as NodeJS.ErrnoException).code==='ESRCH')return;throw new Error('旧运行锁进程无法核实');}
 throw new Error('旧程序仍在运行');
}
export async function acquireRunLock(file:string):Promise<()=>Promise<void>>{
 mkdirSync(path.dirname(file),{recursive:true});
 if(path.basename(file)==='boss-run-lock.sqlite')checkLegacy(path.join(path.dirname(file),'boss-run.lock'));
 const db=new DatabaseSync(file);
 try{db.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE');}catch{db.close();throw new Error('已有实例正在运行，或运行锁损坏');}
 let released=false;
 return async()=>{if(released)return;released=true;try{db.exec('ROLLBACK');}finally{db.close();}};
}
