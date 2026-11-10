// Operator-only spike: attach to the existing Chrome; never launch/close tabs.
import path from 'node:path';
import {createInterface} from 'node:readline';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {HiddenStdioTransport} from '../dist/src/mcp/stdio.js';
import {acquireRunLock} from '../dist/src/run-lock.js';
import {appendFileSync,mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createGuard,parsePages} from './devtools-inspect-guard.mjs';

const release=await acquireRunLock(path.resolve('private/boss-run-lock.sqlite'));
const client=new Client({name:'boss-devtools-connection-test',version:'0.1.0'},{capabilities:{}});
const transport=new HiddenStdioTransport(process.execPath,[
 path.resolve('private/devtools-spike/node_modules/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js'),
 '--autoConnect','--channel=stable','--no-usage-statistics','--no-performance-crux',
 '--no-category-performance','--no-category-network','--no-category-memory',
 '--no-file-navigations',
],process.cwd());
const allowed=new Set(['list_pages','take_snapshot','evaluate_script','click','fill','press_key','wait_for']);
mkdirSync('private/devtools-spike',{recursive:true});
const auditFile=path.resolve('private/devtools-spike',`calls-${randomUUID()}.jsonl`);
const audit=e=>{
 if(e.url){try{const u=new URL(e.url);e={...e,url:['www.zhipin.com','zhipin.com'].includes(u.hostname)?u.origin+u.pathname:u.protocol==='chrome:'?'chrome-internal':u.protocol==='about:'?u.href:'other-origin'};}catch{e={...e,url:'unknown'};}}
 appendFileSync(auditFile,JSON.stringify({at:new Date().toISOString(),...e})+'\n');
};
const guardedCall=createGuard(async(name,args)=>{
 audit({stage:'tool_start',tool:name,pageId:args.pageId,uid:args.uid});
 const result=await client.callTool({name,arguments:args},undefined,{timeout:180000});
 audit({stage:'tool_result',tool:name,isError:!!result.isError});return result;
},audit);
try{
 await client.connect(transport,{timeout:30000});
 const schemas=(await client.listTools()).tools.filter(t=>allowed.has(t.name));
 console.log(JSON.stringify({ready:true,tools:schemas.map(t=>t.name),auditFile}));
 const lines=createInterface({input:process.stdin});
 for await(const line of lines){
  if(line==='EXIT')break;
  try{
   const req=JSON.parse(line);
   if(!allowed.has(req.name))throw Error('TOOL_NOT_ALLOWED');
   const result=await guardedCall(req);
   if(req.name==='list_pages'&&!result.isError){
    const pages=[...parsePages(result)].map(([id,p])=>({id,...p}));
    console.log(JSON.stringify({pageCount:pages.length,bossPages:pages.filter(p=>p.boss),otherPages:pages.filter(p=>!p.boss).map(p=>({id:p.id,kind:p.url.startsWith('chrome:')?'chrome-internal':p.url==='about:blank'?'blank':'other'}))}));
   }else console.log(JSON.stringify(result));
  }catch(e){audit({stage:'stopped',reason:String(e.message)});console.log(JSON.stringify({error:String(e.message)}));}
 }
}finally{await client.close();await release();process.stdin.pause();}
