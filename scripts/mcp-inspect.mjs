// Local operator bridge. Commands are supplied by the operator, never by page content.
import {createInterface} from 'node:readline';
import {connectMcp} from '../dist/src/mcp/client.js';
const signal=new AbortController().signal;
const port=await connectMcp({root:process.cwd(),browser:'chrome',profileDirName:'Default',timeoutMs:60000},signal);
console.log('MCP_READY');
const lines=createInterface({input:process.stdin});
try {for await (const line of lines){
 if(line==='EXIT')break;
 try {const req=JSON.parse(line);console.log(JSON.stringify(await port.call(req.name,req.args,signal)));}
 catch(e){console.log(JSON.stringify({error:e.message}));}
}} finally {await port.close();}
