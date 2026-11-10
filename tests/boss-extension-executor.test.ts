import {it,expect} from 'vitest';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const {ActionExecutor,validateAction}=await import(pathToFileURL(resolve('extensions/boss-page/action-executor.js')).href);
const binding={sessionId:'s',tabId:1,frameId:0,documentId:'d'};
const cmd=(tool:string,payload:any={},id='q')=>({version:2,tool,payload,context:{runId:'r',requestId:id,binding,deadline:new Date(Date.now()+10000).toISOString(),leaseId:'lease'}});
function setup(){let now=0,calls=0;const records=new Map();const journal={get:async(k:string)=>records.get(k),put:async(k:string,v:any)=>{records.set(k,structuredClone(v));}};const ex=new ActionExecutor(journal,()=>now);return {ex,journal,records,advance:()=>now=31000,perform:async()=>{calls++;return {ok:true};},count:()=>calls};}
it('rejects unknown arguments and nonfixed search scope before any DOM action',()=>{
 expect(()=>validateAction(cmd('search_jobs',{city:'深圳',keyword:'AI应用开发工程师',script:'bad'}))).toThrow();
 expect(()=>validateAction(cmd('search_jobs',{city:'北京',keyword:'AI应用开发工程师'}))).toThrow();
 expect(()=>validateAction(cmd('open_chat',{}))).toThrow();
});
it('persists before execution and never replays a duplicate or restarted uncertain request',async()=>{
 const s=setup();s.ex.start('r','lease',{mode:'search_only',maxContacts:0},binding);
 const c=cmd('search_jobs',{city:'深圳',keyword:'AI应用开发工程师'});
 expect((await s.ex.execute(c,s.perform)).phase).toBe('observed');
 expect((await s.ex.execute(c,s.perform)).phase).toBe('observed');expect(s.count()).toBe(1);
 await expect(s.ex.execute({...c,payload:{}},s.perform)).rejects.toThrow();
 const c2=cmd('list_jobs',{advance:true},'q2');s.records.set('q2',{fingerprint:JSON.stringify(c2),phase:'executing'});
 const restarted=new ActionExecutor(s.journal);restarted.start('r','lease',{mode:'search_only',maxContacts:0},binding);
 expect((await restarted.execute(c2,s.perform)).phase).toBe('uncertain');expect(s.count()).toBe(1);
});
it('stopped/expired leases and journal failure prevent all subsequent actions',async()=>{
 const s=setup();s.ex.start('r','lease',{mode:'search_only',maxContacts:0},binding);s.advance();
 await expect(s.ex.execute(cmd('list_jobs',{advance:true}),s.perform)).rejects.toThrow('LEASE_EXPIRED');expect(s.count()).toBe(0);
 expect(()=>s.ex.renew('r','lease')).toThrow('LEASE_EXPIRED');
 const t=setup();t.ex.start('r','lease',{mode:'search_only',maxContacts:0},binding);t.ex.stop('r');
 await expect(t.ex.execute(cmd('list_jobs',{advance:true}),t.perform)).rejects.toThrow();expect(t.count()).toBe(0);
 const f=setup();f.ex.start('r','lease',{mode:'search_only',maxContacts:0},binding);f.journal.put=async()=>{throw Error('DISK_FAILED');};
 await expect(f.ex.execute(cmd('list_jobs',{advance:true}),f.perform)).rejects.toThrow('DISK_FAILED');expect(f.count()).toBe(0);
});
it('search-only cannot contact and one-contact scope cannot be expanded by renewal',async()=>{
 const s=setup();s.ex.start('r','lease',{mode:'search_only',maxContacts:0},binding);
 await expect(s.ex.execute(cmd('open_chat',{jobKey:'job'}),s.perform)).rejects.toThrow('SCOPE_DENIED');
 const t=setup();t.ex.start('r','lease',{mode:'greet_once',maxContacts:1},binding);
 await t.ex.execute(cmd('open_chat',{jobKey:'job'}),t.perform);t.ex.renew('r','lease');
 await expect(t.ex.execute(cmd('open_chat',{jobKey:'job2'},'q2'),t.perform)).rejects.toThrow('CONTACT_LIMIT');expect(t.count()).toBe(1);
});
