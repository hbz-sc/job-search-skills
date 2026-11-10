import {appendFileSync,mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {connectMcp} from '../dist/src/mcp/client.js';
import {diagnose,protocolMetadata} from '../dist/src/mcp/probe.js';
import {acquireRunLock} from '../dist/src/run-lock.js';
const root=process.cwd(),abort=new AbortController();process.once('SIGINT',()=>abort.abort());
const unlock=await acquireRunLock(root+'/private/boss-run-lock.sqlite');
mkdirSync(root+'/private/mcp-diagnostics',{recursive:true});
const file=root+'/private/mcp-diagnostics/'+randomUUID()+'.jsonl';
const log=e=>appendFileSync(file,JSON.stringify({at:new Date().toISOString(),...e})+'\n');
const stage=e=>{log(e);console.log(JSON.stringify(e));};
let port;console.log('Diagnostic metadata: '+file);
try{
 port=await connectMcp({root,browser:'chrome',profileDirName:'Default',timeoutMs:15000,onEvent:stage,onStderr:line=>{const m=protocolMetadata(line);if(m)log({stage:'protocol',...m});}},abort.signal);
 const result=await diagnose(port,abort.signal,stage);
 for(const entry of result)console.log(JSON.stringify(entry));
}catch(e){const reason=['TARGET_CHANGED','BOSS_TARGET_REQUIRED','AMBIGUOUS_TARGET','NO_BOSS_TARGET','MULTIPLE_BOSS_TARGETS','UNRECOGNIZED_TAB_RESULT','DOM_EVALUATION_TIMEOUT','INVALID_DOM_RESULT','TOOL_ERROR'].includes(e?.message)?e.message:undefined;stage({stage:'stopped',errorType:e?.constructor?.name,code:e?.code,reason});process.exitCode=2;}
finally{await port?.close();await unlock();}
