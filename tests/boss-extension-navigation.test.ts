import {it,expect} from 'vitest';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const {Controller}=await import(pathToFileURL(resolve('extensions/boss-page/controller.js')).href);
it('reinjects the fixed adapter and retains inspected chat for phrase operations',async()=>{
 const {WorkflowController}=await import(pathToFileURL(resolve('extensions/boss-page/workflow-controller.js')).href);
 const binding={sessionId:'s',tabId:1,frameId:0,documentId:'chat'},records:any={};let injections=0;
 const owner:any={binding,frameMatches:async()=>{},event:async()=>{},port:{postMessage:()=>{}}};
 const target={title:'AI',company:'甲',recruiter:'李',conversationKey:'a'};
 const api:any={storage:{local:{get:async(k:string)=>({[k]:records[k]}),set:async(v:any)=>Object.assign(records,v)}},webNavigation:{getFrame:async()=>({documentId:'chat',url:'https://www.zhipin.com/web/geek/chat'})},scripting:{executeScript:async(v:any)=>{expect(v.files).toEqual(['content.bundle.js']);injections++;}},tabs:{sendMessage:async(_id:number,m:any)=>({value:m.stage==='observe'?target:{target}})}};
 const w=new WorkflowController(owner,api);w.executor.start('r','lease',{mode:'greet_once',maxContacts:1},binding);
 const c={version:2,tool:'inspect_chat',payload:{conversationKey:'a'},context:{runId:'r',leaseId:'lease',requestId:'q',binding,deadline:new Date(Date.now()+5000).toISOString()}};
 const result=await w.executor.execute(c,(command:any,check:any)=>w.perform(command,check));
 expect(result.phase).toBe('observed');expect(injections).toBe(1);expect(w.state.chat).toMatchObject(target);
});
it.each(['restore_search','search_jobs'])('waits for return navigation before looking for the jobs search box: %s',async tool=>{
 const {WorkflowController}=await import(pathToFileURL(resolve('extensions/boss-page/workflow-controller.js')).href);
 let clicks=0,earlyReads=0,moved=false;const records:any={};
 const binding={sessionId:'s',tabId:1,frameId:0,documentId:'chat'};
 const owner:any={binding,frameMatches:async()=>{},event:async()=>{},port:{postMessage:()=>{}}};
 const api:any={storage:{local:{get:async(k:string)=>({[k]:records[k]}),set:async(v:any)=>Object.assign(records,v)}},webNavigation:{getFrame:async()=>({documentId:moved?'jobs':'chat',url:'https://www.zhipin.com/web/geek/'+(moved?'jobs':'chat')})},scripting:{executeScript:async()=>[]},tabs:{sendMessage:async(_id:number,m:any)=>{
  if(m.stage==='prepare')return {value:moved?{preserve:true}:{returnToJobs:true}};
  if(m.stage==='perform'){if(!moved){clicks++;setTimeout(()=>moved=true,500);}return {value:{}};}
  if(!moved){earlyReads++;return {error:'SEARCH_BOX_AMBIGUOUS:matches=0'};}
  return {value:m.state.returnToJobs?{requiresSearch:true}:{jobs:[]}};
 }}};
 const w=new WorkflowController(owner,api);const version=tool==='search_jobs'?3:2;w.executor.start('r','lease',version===3?{mode:'preview',batchId:'b',planHash:'a'.repeat(64),allowedKeywords:['Java开发工程师'],city:'深圳',experienceBands:['exp_1_3','exp_3_5'],maxContacts:0,expectedPhraseHash:null}:{mode:'greet_once',maxContacts:1},binding,version);
 const c={version,tool,payload:version===3?{keyword:'Java开发工程师',city:'深圳',experience:'exp_1_3'}:{},context:{runId:'r',leaseId:'lease',requestId:'q',binding,deadline:new Date(Date.now()+5000).toISOString()}};
 const result=await w.executor.execute(c,(command:any,check:any)=>w.perform(command,check));
 expect(result.phase).toBe('observed');expect(clicks).toBe(1);expect(earlyReads).toBe(0);expect(owner.binding.documentId).toBe('jobs');
});
it('waits for chat navigation before inspecting chat, without replaying communication',async()=>{
 const {WorkflowController}=await import(pathToFileURL(resolve('extensions/boss-page/workflow-controller.js')).href);
 let clicks=0,earlyReads=0,moved=false;const records:any={};
 const binding={sessionId:'s',tabId:1,frameId:0,documentId:'old'};
 const owner:any={binding,frameMatches:async()=>{},event:async()=>{},port:{postMessage:()=>{}}};
 const api:any={storage:{local:{get:async(k:string)=>({[k]:records[k]}),set:async(v:any)=>Object.assign(records,v)}},webNavigation:{getFrame:async()=>({documentId:moved?'new':'old',url:moved?'https://www.zhipin.com/web/geek/chat':'https://www.zhipin.com/web/geek/jobs'})},scripting:{executeScript:async()=>[]},tabs:{sendMessage:async(_id:number,m:any)=>{
  if(m.stage==='prepare')return {value:{target:{key:'a'}}};
  if(m.stage==='perform'){clicks++;setTimeout(()=>moved=true,500);return {value:{}};}
  if(!moved){earlyReads++;return {error:'CHAT_AMBIGUOUS:matches=0'};}
  return {value:{conversationKey:'a'}};
 }}};
 const w=new WorkflowController(owner,api);w.executor.start('r','lease',{mode:'greet_once',maxContacts:1},binding);
 const c={version:2,tool:'open_chat',payload:{jobKey:'a'},context:{runId:'r',leaseId:'lease',requestId:'q',binding,deadline:new Date(Date.now()+5000).toISOString()}};
 const result=await w.executor.execute(c,(command:any,check:any)=>w.perform(command,check));
 expect(result.phase).toBe('observed');expect(clicks).toBe(1);expect(earlyReads).toBe(0);expect(owner.binding.documentId).toBe('new');
});
it('observes a search navigation without replaying its click or losing the bound session',async()=>{
 let doc='old',clicks=0;const sent:any[]=[],records:any={};
 const api:any={storage:{local:{get:async(k:string)=>({[k]:records[k]}),set:async(v:any)=>Object.assign(records,v)}},runtime:{connectNative:()=>({postMessage:(m:any)=>sent.push(structuredClone(m)),onMessage:{addListener:()=>{}},onDisconnect:{addListener:()=>{}}})},tabs:{query:async()=>[{id:1,url:'https://www.zhipin.com/web/geek/jobs'}],get:async()=>({id:1,url:'https://www.zhipin.com/web/geek/jobs'}),sendMessage:async(_id:number,m:any)=>{
  if(m.stage==='prepare')return {value:{keyword:'AI应用开发工程师'}};
  if(m.stage==='perform'){clicks++;doc='new';throw Error('channel closed by navigation');}
  return {value:{jobs:[],keyword:'AI应用开发工程师',city:'深圳'}};
 }},webNavigation:{getFrame:async()=>({documentId:doc,url:'https://www.zhipin.com/web/geek/jobs'+(doc==='new'?'?query=AI应用开发工程师&city=101280600':'')})},scripting:{executeScript:async()=>[]}};
 const owner=new Controller(api,async()=>{});await owner.connect();const original=structuredClone(owner.binding);
 const command=(tool:string,payload:any,id:string)=>({version:2,tool,payload,context:{runId:'r',leaseId:'lease',requestId:id,binding:structuredClone(owner.binding),deadline:new Date(Date.now()+5000).toISOString()}});
 await owner.execute(command('start_run',{mode:'search_only',maxContacts:0},'start'));
 await owner.execute(command('search_jobs',{city:'深圳',keyword:'AI应用开发工程师'},'search'));
 expect(sent.at(-1).result.phase).toBe('observed');expect(clicks).toBe(1);expect(owner.binding.documentId).toBe('new');expect(owner.binding.sessionId).toBe(original.sessionId);
 const stale=command('list_jobs',{advance:true},'stale');stale.context.binding=original;await owner.execute(stale);
 expect(sent.at(-1).result.phase).toBe('rejected');expect(clicks).toBe(1);
});
it('revokes a DOM dispatch when stopped while frame validation is awaiting',async()=>{
 let release!:()=>void,started!:()=>void;const entered=new Promise<void>(r=>started=r),gate=new Promise<void>(r=>release=r);let sends=0;
 const binding={sessionId:'s',tabId:1,frameId:0,documentId:'d'};
 const owner:any={binding,frameMatches:async()=>{started();await gate;},port:{postMessage:()=>{}}};
 const {WorkflowController}=await import(pathToFileURL(resolve('extensions/boss-page/workflow-controller.js')).href);
 const w=new WorkflowController(owner,{tabs:{sendMessage:async(_id:number,m:any)=>{if(m.kind==='action')sends++;return {value:{}};}}});
 w.executor.start('r','lease',{mode:'search_only',maxContacts:0},binding);
 const c={version:2,tool:'search_jobs',payload:{city:'深圳',keyword:'AI应用开发工程师'},context:{runId:'r',leaseId:'lease',requestId:'q',binding,deadline:new Date(Date.now()+5000).toISOString()}};
 const waiting=w.message(c,'perform',{});await entered;w.stop('r');release();
 await expect(waiting).rejects.toThrow('RUN_STOPPED');expect(sends).toBe(0);
});
it('rejects a chat navigation during a search instead of treating any BOSS URL as expected',async()=>{
 const {WorkflowController}=await import(pathToFileURL(resolve('extensions/boss-page/workflow-controller.js')).href);
 const w=new WorkflowController({binding:{tabId:1}},{});
 const binding={sessionId:'s',tabId:1,frameId:0,documentId:'d'};w.executor.start('r','lease',{mode:'search_only',maxContacts:0},binding);
 w.navigation={sourceTab:1,requestId:'q',tool:'search_jobs',until:Date.now()+5000};
 expect(w.changed('document_changed',{tabId:1,frameId:0,url:'https://www.zhipin.com/web/geek/chat'})).toBe(false);
 expect(()=>w.executor.check('r','lease')).toThrow();
});
