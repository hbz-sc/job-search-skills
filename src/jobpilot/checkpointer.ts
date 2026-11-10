import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {SqliteSaver} from '@langchain/langgraph-checkpoint-sqlite';
export async function openCheckpointer(file:string){
 if(file!==':memory:')await mkdir(path.dirname(path.resolve(file)),{recursive:true});
 const saver=SqliteSaver.fromConnString(file);saver.db.pragma('journal_mode = WAL');saver.db.pragma('busy_timeout = 5000');
 return {saver,async close(){if(saver.db.open)saver.db.close();}};
}
