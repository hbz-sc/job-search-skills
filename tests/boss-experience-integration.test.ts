import {test,expect} from 'vitest';import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';
const {WorkflowController}=await import(pathToFileURL(resolve('extensions/boss-page/workflow-controller.js')).href);
function setup(mode='auto'){
 const binding={sessionId:'s',tabId:1,frameId:0,documentId:'d'},records:any={},events:any[]=[];let selected=false,doc='d';
 const owner:any={binding,frameMatches:async(b:any)=>{if(doc!==b.documentId)throw Error('DOCUMENT_CHANGED');},event:async()=>{},port:{postMessage:()=>{}}};
 const api:any={storage:{local:{get:async(k:string)=>({[k]:records[k]}),set:async(v:any)=>Object.assign(records,v)}},permissions:{contains:async()=>true},debugger:{attach:async()=>events.push('attach'),detach:async()=>events.push('detach'),sendCommand:async(_t:any,_m:string,p:any)=>{events.push(p);if(p.type==='mouseReleased'&&p.x>=0)selected=true;}},windows:{get:async()=>({id:9,focused:true,state:'normal'})},tabs:{get:async()=>({id:1,windowId:9,active:true,url:'https://www.zhipin.com/web/geek/jobs'}),sendMessage:async(_t:any,m:any)=>{
  if(m.kind==='cancel_run')return {};
  if(m.stage==='prepare')return {value:{}};
  if(m.stage==='perform')return {value:{requiresPointer:true}};
  if(m.stage==='pointer')return {value:{expectedLabel:'1-3年',label:m.state.label,menuVisible:true,selection:{known:true,labels:selected?['1-3年']:[]},point:{x:50,y:60,viewportWidth:800,viewportHeight:600}}};
  if(!selected)return {error:'FILTER_UNVERIFIED'};return {value:{observedExperience:'exp_1_3',jobs:[]}};
 }},webNavigation:{getFrame:async()=>({documentId:doc,url:'https://www.zhipin.com/web/geek/jobs'})}};
 const w=new WorkflowController(owner,api);const scope={experienceMode:mode,mode:'preview',batchId:'b',planHash:'a'.repeat(64),allowedKeywords:['Java开发工程师'],city:'深圳',experienceBands:['exp_1_3','exp_3_5'],maxContacts:0,expectedPhraseHash:null};w.executor.start('r','l',scope,binding,3);
 const c={version:3,tool:'search_jobs',payload:{city:'深圳',keyword:'Java开发工程师',experience:'exp_1_3'},context:{runId:'r',leaseId:'l',requestId:'q',binding,deadline:new Date(Date.now()+1500).toISOString()}};
 return {w,c,events,api,changed:()=>{doc='new';},run:()=>w.executor.execute(c,(c:any,check:any)=>w.perform(c,check))};
}
test('manual workflow refuses stale content requesting automatic pointer input',async()=>{const f=setup('manual');expect((await f.run()).error.code).toBe('MANUAL_EXPERIENCE_REQUIRED');expect(f.events).toEqual([]);});
test('retained pointer helper reports attach failure',async()=>{const f=setup();f.api.debugger.attach=async()=>{throw Error('already attached');};await expect(f.w.performPointer(f.c,()=>{})).rejects.toThrow('DEBUGGER_ATTACH_FAILED');expect(f.events).toEqual([]);});
test('stopping a run while attach awaits prevents any late input',async()=>{
 const f=setup();let release!:()=>void,entered!:()=>void;const started=new Promise<void>(r=>entered=r);f.api.debugger.attach=async()=>{entered();await new Promise<void>(r=>release=r);};
 const p=f.w.performPointer(f.c,()=>{}).catch((e:any)=>e);await Promise.race([started,new Promise(r=>setTimeout(r,100))]);f.w.stop('r');release?.();expect((await p).message).toBe('RUN_STOPPED');expect(f.events.some(e=>e.type==='mousePressed')).toBe(false);
});
test('pointer API refuses non-search commands and stale bindings',async()=>{
 const f=setup();await expect(f.w.performPointer({...f.c,tool:'open_chat'},()=>{})).rejects.toThrow('SCOPE_DENIED');expect(f.events).toEqual([]);
 f.changed();await expect(f.w.performPointer(f.c,()=>{})).rejects.toThrow('DOCUMENT_CHANGED');expect(f.events).toEqual([]);
});
test('activates only the bound tab and its window before browser input',async()=>{
 const f=setup();let active=false,focused=false;f.api.tabs.get=async()=>({id:1,windowId:9,active,url:'https://www.zhipin.com/web/geek/jobs'});
 f.api.tabs.update=async(id:number,v:any)=>{expect(id).toBe(1);expect(v).toEqual({active:true});active=true;f.events.push('activate');};
 f.api.windows={get:async()=>({id:9,focused,state:'normal'}),update:async(id:number,v:any)=>{expect(id).toBe(9);expect(v).toEqual({focused:true});focused=true;f.events.push('focus');}};
 const original=f.api.debugger.sendCommand;f.api.debugger.sendCommand=async(...args:any[])=>{if(!active||!focused)throw Error('Window is occluded');await original(...args);};
 await f.w.performPointer(f.c,()=>{});expect(f.events.slice(0,3)).toEqual(['activate','focus','attach']);
});
test('a stale document while preparing foreground cannot activate its window',async()=>{
 const f=setup();f.api.tabs.get=async()=>({id:1,windowId:9,active:true,url:'https://www.zhipin.com/web/geek/jobs'});
 f.api.windows={get:async()=>{f.changed();return {id:9,focused:false,state:'normal'};},update:async()=>{f.events.push('focus');}};
 await expect(f.w.performPointer(f.c,()=>{})).rejects.toThrow('DOCUMENT_CHANGED');expect(f.events).toEqual([]);
});
test('a rejected foreground request is explicit and never attaches',async()=>{
 const f=setup();f.api.windows={get:async()=>({id:9,focused:false,state:'normal'}),update:async()=>{throw Error('Window was removed.');}};
 await expect(f.w.performPointer(f.c,()=>{})).rejects.toThrow('EXPERIENCE_FOREGROUND_UNAVAILABLE');expect(f.events).toEqual([]);
});
test('late foreground observation cannot focus a window after timeout',async()=>{
 const f=setup();let release!:(v:any)=>void;f.w.pointer.commandMs=15;f.api.windows={get:()=>new Promise(r=>release=r),update:async()=>{f.events.push('focus');}};
 await expect(f.w.performPointer(f.c,()=>{})).rejects.toThrow('DEBUGGER_CHECK_TIMEOUT');release({id:9,focused:false,state:'normal'});await new Promise(r=>setTimeout(r,10));expect(f.events).toEqual([]);
});

test('auto workflow passes mode to content and performs its fixed pointer request',async()=>{const f=setup();const send=f.api.tabs.sendMessage;f.api.tabs.sendMessage=async(t:any,m:any)=>{if(m.kind==='action')expect(m.state.experienceMode).toBe('auto');return send(t,m);};expect((await f.run()).phase).toBe('observed');expect(f.events).toContain('attach');});
test('manual direct pointer call is denied before debugger attachment',async()=>{const f=setup('manual');await expect(f.w.performPointer(f.c,()=>{})).rejects.toThrow('SCOPE_DENIED');expect(f.events).toEqual([]);});

test('pointer follows current city authorization and rejects crossing city scopes before attachment',async()=>{
 const f=setup();f.w.executor.run.scope.city='current';f.c.payload.city='current';
 f.api.tabs.get=async()=>({id:1,windowId:9,active:true,url:'https://www.zhipin.com/web/geek/jobs?city=101280100'});
 await f.w.performPointer(f.c,()=>{});expect(f.events).toContain('attach');
 const strict=setup();strict.c.payload.city='current';
 await expect(strict.w.performPointer(strict.c,()=>{})).rejects.toThrow('SCOPE_DENIED');expect(strict.events).toEqual([]);
});
