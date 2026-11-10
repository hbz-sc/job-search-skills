// Smoke-check MCP protocol only. No browser tools, login, or messages are invoked.
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const config=JSON.parse(readFileSync(path.join(root,'config/playwright-edge.mcp.json'),'utf8')).mcpServers['playwright-edge'];
const child=spawn(config.command,config.args,{cwd:root,stdio:['pipe','pipe','pipe'],windowsHide:true});
let buffer='',stderr='',done=false;
const finish=(code,message)=>{if(done)return;done=true;clearTimeout(timer);console.log(message);child.stdin.end();child.kill();process.exitCode=code;};
const send=o=>child.stdin.write(JSON.stringify(o)+'\n');
const timer=setTimeout(()=>finish(1,'MCP handshake timed out'),10000);
child.on('error',e=>finish(1,e.message));
child.stderr.on('data',d=>{stderr+=d.toString();});
child.stdout.on('data',d=>{
 buffer+=d.toString();let pos;
 while((pos=buffer.indexOf('\n'))!==-1){
  const line=buffer.slice(0,pos);buffer=buffer.slice(pos+1);if(!line.trim())continue;
  let msg;try{msg=JSON.parse(line);}catch{finish(1,'Invalid MCP stdout');return;}
  if(msg.error){finish(1,'MCP error: '+JSON.stringify(msg.error));return;}
  if(msg.id===1){send({jsonrpc:'2.0',method:'notifications/initialized'});send({jsonrpc:'2.0',id:2,method:'tools/list',params:{}});}
  if(msg.id===2){const names=msg.result?.tools?.map(t=>t.name)??[];const valid=names.includes('browser_snapshot')&&names.includes('browser_click');finish(valid?0:1,JSON.stringify({handshake:valid?'passed':'failed',toolCount:names.length,requiredTools:['browser_snapshot','browser_click'],browserConnected:false,browserActions:0}));}
 }
});
child.on('exit',code=>{if(!done)finish(1,'MCP exited '+code+': '+stderr.slice(-400));});
send({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'boss-local-smoke-check',version:'1.0.0'}}});
