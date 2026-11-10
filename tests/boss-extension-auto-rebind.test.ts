import {test,expect} from 'vitest';import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';
const {Controller}=await import(pathToFileURL(resolve('extensions/boss-page/controller.js')).href);
function setup(){let documentId='d1',url='https://www.zhipin.com/web/geek/jobs',blockers:string[]=[],ready=true,inject=async()=>{};const sent:any[]=[];let reads=0;const events:any[]=[];
 const api={runtime:{lastError:null,connectNative:()=>({postMessage:(m:any)=>sent.push(m),onMessage:{addListener:()=>{}},onDisconnect:{addListener:()=>{}},disconnect:()=>{}})},tabs:{query:async()=>[{id:7,url}],get:async(id:number)=>({id,url,status:'complete'}),sendMessage:async(_id:number,m:any)=>{if(m.kind==='cancel_run')return {};reads++;return {value:{pageKind:'jobs',searchBox:{count:ready?1:0},jobs:[],blockers,writeEnabled:false}};}},scripting:{executeScript:async()=>inject()},webNavigation:{getFrame:async()=>({documentId,url})}};
 const c=new Controller(api,async(stage:string,meta:any)=>{events.push({stage,meta});},{recoveryDelayMs:0});
 return {c,sent,events,reads:()=>reads,set:(data:{doc?:string;url?:string;blockers?:string[];ready?:boolean})=>{documentId=data.doc??documentId;url=data.url??url;blockers=data.blockers??blockers;ready=data.ready??ready;},inject:(fn:()=>Promise<void>)=>{inject=fn;}};
}
test('refresh automatically binds the same authorized tab only after a ready read and stops its old run',async()=>{
 const s=setup();await s.c.connect();const prior=s.c.binding;s.c.workflow.executor.start('r','l',{mode:'search_only',maxContacts:0},prior);s.set({doc:'d2'});await s.c.changed('document_changed',{tabId:7,frameId:0,documentId:'d2'});
 expect(s.c.binding).toMatchObject({tabId:7,documentId:'d2',sessionId:prior.sessionId});expect(s.reads()).toBe(1);expect(s.c.workflow.executor.run).toBe(null);expect(s.sent.filter(m=>m.kind==='bind')).toHaveLength(2);
});
test('explicit disconnect during injection revokes recovery and late completion cannot resurrect binding',async()=>{
 const s=setup();await s.c.connect();let release!:()=>void;let entered!:()=>void;const started=new Promise<void>(r=>entered=r);s.inject(async()=>{entered();await new Promise<void>(r=>release=r);});s.set({doc:'d2'});const work=s.c.changed('document_changed',{tabId:7,frameId:0,documentId:'d2'});await Promise.race([started,new Promise<void>(r=>setTimeout(r,10))]);s.c.disconnect();release?.();await work;expect(s.c.binding).toBe(null);expect(s.sent.filter(m=>m.kind==='bind')).toHaveLength(1);
});
test.each(['closed','external','login'])('does not recover an unauthorized or blocked page: %s',async kind=>{
 const s=setup();await s.c.connect();s.set({doc:'d2',...(kind==='external'?{url:'https://example.com/'}:{}),...(kind==='login'?{blockers:['login']}: {})});await s.c.changed(kind==='closed'?'tab_removed':'document_changed',{tabId:7,frameId:0,documentId:'d2'});expect(s.c.binding).toBe(null);expect(s.sent.filter(m=>m.kind==='bind')).toHaveLength(1);
});
test('readiness retries are bounded at three, ignoring unrelated tab events',async()=>{
 const s=setup();await s.c.connect();s.set({doc:'d2',ready:false});await s.c.changed('document_changed',{tabId:99,frameId:0,documentId:'elsewhere'});expect(s.c.binding.documentId).toBe('d1');await s.c.changed('document_changed',{tabId:7,frameId:0,documentId:'d2'});expect(s.reads()).toBe(3);expect(s.c.binding).toBe(null);expect(s.c.status).toContain('自动重连失败');
});

test('late completion for an older document cannot overwrite a newer automatic binding',async()=>{
 const s=setup();await s.c.connect();let release!:()=>void;let entered!:()=>void;const started=new Promise<void>(r=>entered=r);let once=true;s.inject(async()=>{if(once){once=false;entered();await new Promise<void>(r=>release=r);}});
 s.set({doc:'d2'});const older=s.c.changed('document_changed',{tabId:7,frameId:0,documentId:'d2'});await started;s.set({doc:'d3'});await s.c.changed('document_changed',{tabId:7,frameId:0,documentId:'d3'});release();await older;expect(s.c.binding.documentId).toBe('d3');expect(s.sent.filter(m=>m.kind==='bind').map(m=>m.binding.documentId)).toEqual(['d1','d3']);
});

test('disconnect also cancels an in-flight manual connect without recreating its native port',async()=>{
 const s=setup();let release!:()=>void;let entered!:()=>void;const started=new Promise<void>(r=>entered=r);s.inject(async()=>{entered();await new Promise<void>(r=>release=r);});const work=s.c.connect();await started;s.c.disconnect();release();await expect(work).rejects.toThrow('CONNECTION_CANCELLED');expect(s.c.binding).toBe(null);expect(s.c.authorized).toBe(null);expect(s.c.port).toBe(null);expect(s.sent).toHaveLength(0);
});

test('document invalidation interrupts an in-flight query with a recoverable reason, not a user stop',async()=>{
 const s=setup();await s.c.connect();const binding=s.c.binding;s.c.workflow.executor.start('r','l',{mode:'search_only',maxContacts:0},binding);let release!:()=>void;let entered!:()=>void;const started=new Promise<void>(r=>entered=r);
 // Use the actual executor but an in-memory journal, avoiding browser storage.
 const records=new Map();s.c.workflow.executor.journal={get:async(k:string)=>records.get(k),put:async(k:string,v:any)=>records.set(k,v)};
 const c={version:2,tool:'search_jobs',payload:{city:'深圳',keyword:'AI应用开发工程师'},context:{runId:'r',leaseId:'l',requestId:'query',binding,deadline:new Date(Date.now()+10000).toISOString()}};
 const work=s.c.workflow.executor.execute(c,async(_c:any,check:any)=>{entered();await new Promise<void>(r=>release=r);check();return {};});await started;s.set({doc:'d2'});await s.c.changed('document_changed',{tabId:7,frameId:0,documentId:'d2'});release();const result=await work;expect(result.error.code).toBe('DOCUMENT_CHANGED');expect(s.c.binding.documentId).toBe('d2');
});
