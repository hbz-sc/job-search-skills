import {it,expect} from 'vitest';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {BossExtensionClient} from '../src/boss-extension/client.js';
it('uses real MCP over authenticated HTTP, preserves the selected binding and stops only its run',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'boss-client-'));
 const proc=spawn(path.resolve('.venv-mcp-bosszp/Scripts/python.exe'),['-m','boss_bridge.main','--root',root],{cwd:path.resolve('integrations/mcp-bosszp'),windowsHide:true,stdio:'pipe'});
 let buffer=Buffer.alloc(0);const queue:any[]=[];const waiters:((v:any)=>void)[]=[];let stderr='';proc.stderr.on('data',b=>stderr+=b.toString());
 proc.stdout.on('data',b=>{buffer=Buffer.concat([buffer,b]);while(buffer.length>=4&&buffer.length>=4+buffer.readUInt32LE(0)){const n=buffer.readUInt32LE(0);const m=JSON.parse(buffer.subarray(4,4+n).toString());buffer=buffer.subarray(4+n);const w=waiters.shift();if(w)w(m);else queue.push(m);}});
 const next=(timeout=12000)=>queue.length?Promise.resolve(queue.shift()):new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('NATIVE_FRAME_TIMEOUT; childExit='+proc.exitCode+'; stderr='+stderr)),timeout);waiters.push(v=>{clearTimeout(timer);resolve(v);});});
 const send=(m:any)=>{const body=Buffer.from(JSON.stringify(m));const head=Buffer.alloc(4);head.writeUInt32LE(body.length);proc.stdin.write(Buffer.concat([head,body]));};
 let client:BossExtensionClient|undefined;
 try{
  expect((await next(45000)).kind).toBe('ready');
  send({kind:'bind',binding:{sessionId:'s',tabId:7,frameId:0,documentId:'d'},workflowVersion:1});
  client=await BossExtensionClient.connect(path.join(root,'discovery.json'));
  const reading=client.inspect('test-run');const command=await next();
  expect(command.command.context.binding.tabId).toBe(7);
  send({kind:'result',result:{requestId:command.command.context.requestId,phase:'observed',evidenceIds:[],value:{binding:{sessionId:'s',tabId:7,frameId:0,documentId:'d'},url:'https://www.zhipin.com/web/geek/jobs',pageKind:'jobs',identityCapability:'unavailable',searchBox:{count:1},jobs:[],blockers:[],adapterVersion:'fixture',writeEnabled:false}}});
  expect((await reading).value?.searchBox.count).toBe(1);
  const diagnostics=await client.diagnostics('test-run');expect(JSON.stringify(diagnostics)).toContain('native_dispatched');
  const started=client.startWorkflow({mode:'search_only',maxContacts:0});
  const start=await next();expect(start.command.tool).toBe('start_run');
  send({kind:'result',result:{requestId:start.command.context.requestId,phase:'observed',evidenceIds:[],value:{leaseId:start.command.context.leaseId,binding:start.command.context.binding}}});await started;
  const searching=client.action('search_jobs',{city:'深圳',keyword:'AI应用开发工程师'});
  const renewal=await next();expect(renewal.command.tool).toBe('renew_run');
  send({kind:'result',result:{requestId:renewal.command.context.requestId,phase:'observed',evidenceIds:[],value:{binding:renewal.command.context.binding}}});
  const search=await next();expect(search.command.tool).toBe('search_jobs');expect(search.command.payload.keyword).toBe('AI应用开发工程师');
  send({kind:'result',result:{requestId:search.command.context.requestId,phase:'observed',evidenceIds:[],value:{jobs:[],binding:search.command.context.binding}}});expect((await searching).jobs).toEqual([]);
  await client.close();client=undefined;
  const discovery=JSON.parse(await readFile(path.join(root,'discovery.json'),'utf8'));expect(stderr).not.toContain(discovery.token);
 }finally{
  await client?.close();proc.stdin.end();
  await new Promise<void>(resolve=>{if(proc.exitCode!==null)return resolve();const t=setTimeout(()=>proc.kill(),5000);proc.once('exit',()=>{clearTimeout(t);resolve();});});
  await rm(root,{recursive:true,force:true});
 }
},60000);
