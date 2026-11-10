import {test,expect} from 'vitest';
import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';
const {ExperiencePointer}=await import(pathToFileURL(resolve('extensions/boss-page/experience-pointer.js')).href);
const binding={sessionId:'s',tabId:1,frameId:0,documentId:'d'};
const point={x:50,y:40,viewportWidth:800,viewportHeight:600};
function fixture(){
 const events:any[]=[];let selected:string[]=[],menu=false;
 const api:any={permissions:{contains:async()=>true},debugger:{attach:async()=>events.push('attach'),detach:async()=>events.push('detach'),onDetach:{addListener:()=>{},removeListener:()=>{}},sendCommand:async(_b:any,_m:string,p:any)=>{events.push(p);if(p.type==='mouseMoved')menu=true;if(p.type==='mouseReleased'&&p.x>=0)selected=['1-3年'];}}};
 const observe=async(step:string,label?:string)=>({point,menuVisible:menu,selection:{known:true,labels:selected},expectedLabel:'1-3年',label});
 return {api,events,observe,check:async()=>{},binding,deadline:Date.now()+5000};
}
test('owns and releases one attachment after verified selection',async()=>{
 const f=fixture();await new ExperiencePointer(f.api,{pollMs:1}).select(f);
 expect(f.events[0]).toBe('attach');expect(f.events.at(-1)).toBe('detach');expect(f.events.filter(e=>e.type==='mousePressed')).toHaveLength(1);
});
test('reports fixed input phases so a timeout identifies which move did not acknowledge',async()=>{
 const f=fixture();const phases:string[]=[];await new ExperiencePointer(f.api,{pollMs:1}).select({...f,onPhase:(s:string)=>phases.push(s)});
 expect(phases).toContain('move_control_sent');expect(phases).toContain('move_control_ack');expect(phases).toContain('press_option_sent');expect(phases).toContain('detached');
});
test('cancel during pending attach cleans up late success without any input',async()=>{
 const f=fixture();let release!:()=>void;f.api.debugger.attach=()=>new Promise<void>(r=>release=r);const p=new ExperiencePointer(f.api,{pollMs:1});
 const running=p.select(f);await new Promise(r=>setTimeout(r,0));p.cancel('RUN_STOPPED');release();await expect(running).rejects.toThrow('RUN_STOPPED');expect(f.events).toEqual(['detach']);
});
test('attach timeout cleans up late success and never steals another debugger',async()=>{
 const f=fixture();let release!:()=>void;f.api.debugger.attach=()=>new Promise<void>(r=>release=r);const p=new ExperiencePointer(f.api,{commandMs:10});
 await expect(p.select(f)).rejects.toThrow('DEBUGGER_ATTACH_TIMEOUT');release();await new Promise(r=>setTimeout(r,5));expect(f.events).toEqual(['detach']);
 const busy=fixture();busy.api.debugger.attach=async()=>{throw Error('Another debugger is already attached');};await expect(new ExperiencePointer(busy.api).select(busy)).rejects.toThrow('DEBUGGER_ATTACH_FAILED');expect(busy.events).toEqual([]);
});
test('changed document after press releases outside the page and stops',async()=>{
 const f=fixture();const original=f.api.debugger.sendCommand;let changed=false;
 f.api.debugger.sendCommand=async(...args:any[])=>{await original(...args);if(args[2].type==='mousePressed')changed=true;};f.check=async()=>{if(changed)throw Error('DOCUMENT_CHANGED');};
 await expect(new ExperiencePointer(f.api,{pollMs:1}).select(f)).rejects.toThrow('DOCUMENT_CHANGED');
 expect(f.events.filter(e=>e.type==='mouseReleased')).toEqual([expect.objectContaining({x:-1,y:-1,buttons:0})]);expect(f.events.at(-1)).toBe('detach');
});
test('does not click a covered option or replay a click with unchanged selection',async()=>{
 const f=fixture(),original=f.observe;f.observe=async(s,l)=>{if(s==='option')throw Error('EXPERIENCE_TARGET_COVERED');return original(s,l);};
 await expect(new ExperiencePointer(f.api,{pollMs:1}).select(f)).rejects.toThrow('EXPERIENCE_TARGET_COVERED');expect(f.events.some(e=>e.type==='mousePressed')).toBe(false);
 const unchanged=fixture();unchanged.observe=async(s,l)=>({point,menuVisible:true,selection:{known:true,labels:[]},expectedLabel:'1-3年',label:l});
 await expect(new ExperiencePointer(unchanged.api,{pollMs:1}).select(unchanged)).rejects.toThrow('EXPERIENCE_SELECTION_UNCHANGED');expect(unchanged.events.filter(e=>e.type==='mousePressed')).toHaveLength(1);
});
test('coordinates moving after every pointer move cannot result in a stale click',async()=>{
 const f=fixture();let x=50;f.observe=async(s,l)=>({point:{...point,x:s==='option'?x+=10:x},menuVisible:true,selection:{known:true,labels:[]},expectedLabel:'1-3年',label:l});
 await expect(new ExperiencePointer(f.api,{pollMs:1}).select(f)).rejects.toThrow('EXPERIENCE_TARGET_MOVED');expect(f.events.some(e=>e.type==='mousePressed')).toBe(false);
});
test('an unresponsive DOM probe times out and cleans up without input',async()=>{
 const f=fixture();f.observe=()=>new Promise(()=>{});
 await expect(new ExperiencePointer(f.api,{commandMs:15}).select(f)).rejects.toThrow('EXPERIENCE_OBSERVE_TIMEOUT');expect(f.events).toEqual(['attach','detach']);
});
test('missing permission and removed debugger stop before a click',async()=>{
 const f=fixture();f.api.permissions.contains=async()=>false;await expect(new ExperiencePointer(f.api).select(f)).rejects.toThrow('DEBUGGER_PERMISSION_REQUIRED');expect(f.events).toEqual([]);
 const gone=fixture();let handler:any;gone.api.debugger.onDetach.addListener=(f:any)=>handler=f;gone.api.debugger.sendCommand=async()=>{handler({tabId:1});};await expect(new ExperiencePointer(gone.api).select(gone)).rejects.toThrow('DEBUGGER_DETACHED');expect(gone.events).toEqual(['attach']);
});
test('coverage introduced by the final async authority check prevents the press',async()=>{
 const f=fixture();let reads=0,covered=false;const original=f.observe;
 f.observe=async(s,l)=>{if(s==='option'){reads++;if(covered)throw Error('EXPERIENCE_TARGET_COVERED');}return original(s,l);};
 f.check=async()=>{if(reads>=2)covered=true;};
 await expect(new ExperiencePointer(f.api,{pollMs:1}).select(f)).rejects.toThrow('EXPERIENCE_TARGET_COVERED');expect(f.events.some(e=>e.type==='mousePressed')).toBe(false);
});
test.each(['mouseMoved','mousePressed','mouseReleased'])('normalizes rejected %s commands and cleans up without another click',async type=>{
 const f=fixture();const original=f.api.debugger.sendCommand;
 f.api.debugger.sendCommand=async(...args:any[])=>{await original(...args);if(args[2].type===type&&args[2].x>=0)throw Error('Detached while handling command.');};
 await expect(new ExperiencePointer(f.api,{pollMs:1}).select(f)).rejects.toThrow('DEBUGGER_INPUT_FAILED');
 expect(f.events.filter(e=>e.type==='mousePressed').length).toBeLessThanOrEqual(1);expect(f.events.at(-1)).toBe('detach');
 if(type!=='mouseMoved')expect(f.events.some(e=>e.type==='mouseReleased'&&e.x===-1)).toBe(true);
});
test.each(['move','press'])('menu collapse on %s reopens only before a press',async when=>{
 const f=fixture();let menu=false,collapsed=false,selected=false;
 f.observe=async(s,l)=>{if(s==='option'&&!menu)throw Error('EXPERIENCE_MENU_NOT_OPEN');return {point:{...point,y:s==='option'?80:40},menuVisible:menu,selection:{known:true,labels:selected?['1-3年']:[]},expectedLabel:'1-3年',label:l};};
 f.api.debugger.sendCommand=async(_t:any,_m:string,p:any)=>{f.events.push(p);if(p.type==='mouseMoved'&&p.y===40)menu=true;if(!collapsed&&(when==='move'&&p.type==='mouseMoved'&&p.y===80||when==='press'&&p.type==='mousePressed')){menu=false;collapsed=true;}if(p.type==='mouseReleased'&&p.x>=0)selected=true;};
 const result=new ExperiencePointer(f.api,{pollMs:1}).select(f);
 if(when==='move'){await result;expect(selected).toBe(true);expect(f.events.filter(e=>e.type==='mouseMoved'&&e.y===40)).toHaveLength(2);}
 else{await expect(result).rejects.toThrow('EXPERIENCE_MENU_NOT_OPEN');expect(f.events.filter(e=>e.type==='mousePressed')).toHaveLength(1);expect(selected).toBe(false);}
});
