import {it,expect} from 'vitest';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const {Controller}=await import(pathToFileURL(resolve('extensions/boss-page/controller.js')).href);
function setup(lateDisconnect=false){
 const sent:any[]=[];const ports:any[]=[];let documentId='d1';let reads=0;let closed=false;
 const chrome={runtime:{lastError:null,connectNative:()=>{const listeners:any={};ports.push(listeners);return {postMessage:(m:any)=>sent.push(m),onMessage:{addListener:(f:any)=>listeners.message=f},onDisconnect:{addListener:(f:any)=>listeners.disconnect=f},disconnect:()=>{closed=true;if(!lateDisconnect)listeners.disconnect();}};}},
 tabs:{query:async()=>[{id:7,url:'https://www.zhipin.com/web/geek/jobs'}],sendMessage:async()=>{reads++;return {value:{pageKind:'jobs',searchBox:{count:1},jobs:[],identityCapability:'unavailable',writeEnabled:false}};}},
 scripting:{executeScript:async()=>[]},webNavigation:{getFrame:async()=>({documentId,url:'https://www.zhipin.com/web/geek/jobs'})}};
 const controller=new Controller(chrome,async()=>{});
 return {controller,sent,ports,change:()=>{documentId='new';},reads:()=>reads,closed:()=>closed};
}
it('binds current tab, refuses stale document before read, and disconnects without closing browser',async()=>{
 const s=setup();await s.controller.connect();const binding=s.controller.binding;
 s.change();await s.controller.execute({version:1,tool:'inspect_session',context:{runId:'r',requestId:'q',binding,deadline:new Date(Date.now()+5000).toISOString()},payload:{}});
 expect(s.reads()).toBe(0);expect(s.sent.at(-1).result.error.code).toBe('DOCUMENT_CHANGED');
 s.controller.disconnect();expect(s.closed()).toBe(true);expect(s.controller.binding).toBe(null);
});
it('rebinds after navigation without restarting the live native host',async()=>{
 const s=setup();await s.controller.connect();const previous=s.controller.binding;
 s.change();await s.controller.changed('document_changed',{tabId:7,frameId:0,documentId:'new'});
 expect(s.controller.binding).toBe(null);
 await s.controller.connect();
 expect(s.controller.binding.documentId).toBe('new');expect(s.controller.binding.sessionId).not.toBe(previous.sessionId);
 expect(s.ports.length).toBe(1);expect(s.sent.filter(x=>x.kind==='bind').length).toBe(2);
});
it('ignores a previous native port disconnect after a new connection is established',async()=>{
 const s=setup(true);await s.controller.connect();s.controller.disconnect();await s.controller.connect();
 const current=s.controller.binding;
 s.ports[0].disconnect();
 expect(s.controller.binding).toEqual(current);expect(s.controller.port).not.toBe(null);
 s.ports[0].message({kind:'ready'});
 expect(s.controller.status).toBe('正在连接本地服务');
});
it('does not execute writes or a second simultaneous connection',async()=>{
 const s=setup();await s.controller.connect();await expect(s.controller.connect()).rejects.toThrow('HOST_BUSY');
 await s.controller.execute({version:1,tool:'open_chat',context:{runId:'r',requestId:'q',binding:s.controller.binding,deadline:new Date(Date.now()+5000).toISOString()},payload:{}});
 expect(s.reads()).toBe(0);expect(s.sent.at(-1).result.error.code).toBe('TOOL_NOT_ENABLED');
});
