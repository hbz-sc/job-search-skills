import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
it('preserves document-change cancellation through content authorization checks',async()=>{
 let listener:any;let response:any;
 const chrome={runtime:{id:'extension',sendMessage:async()=>({allowed:true}),onMessage:{addListener:(f:any)=>listener=f,removeListener:()=>{}}}};
 runInNewContext(readFileSync('extensions/boss-page/content.js','utf8'),{chrome,document:{},location:{href:'https://www.zhipin.com/web/geek/chat'},validateAction:()=>{},chatAction:async(_d:any,_u:any,_s:any,_c:any,_state:any,before:any)=>{await before();return {};},addEventListener:()=>{},removeEventListener:()=>{},Date});
 listener({kind:'cancel_run',runId:'run',reason:'DOCUMENT_CHANGED'},{id:'extension'},()=>{});
 listener({kind:'action',stage:'perform',state:{},command:{version:3,tool:'read_first_phrase',payload:{conversationKey:'c'},context:{runId:'run',requestId:'q',deadline:new Date(Date.now()+10000).toISOString()}}},{id:'extension'},(r:any)=>response=r);
 await new Promise(resolve=>setTimeout(resolve,0));expect(response).toEqual({error:'DOCUMENT_CHANGED'});
});
it('keeps the content message channel open until asynchronous evidence is ready',async()=>{
 let listener:any;const events:string[]=[];let resolveRead!:(v:any)=>void;
 const ready=new Promise(resolve=>resolveRead=resolve);let responded:any;
 const chrome={runtime:{id:'extension',sendMessage:async(m:any)=>events.push(m.stage),onMessage:{addListener:(f:any)=>listener=f,removeListener:()=>{}}}};
 runInNewContext(readFileSync('extensions/boss-page/content.js','utf8'),{chrome,document:{},location:{href:'https://www.zhipin.com/web/geek/jobs'},inspectBoss:()=>ready,addEventListener:()=>{},removeEventListener:()=>{},Date});
 const keepOpen=listener({kind:'read',command:{version:1,tool:'inspect_session',payload:{},context:{requestId:'q',deadline:new Date(Date.now()+10000).toISOString()}}},{id:'extension'},(value:any)=>responded=value);
 expect(keepOpen).toBe(true);expect(responded).toBeUndefined();
 resolveRead({writeEnabled:false});await ready;await new Promise(resolve=>setTimeout(resolve,0));
 expect(responded).toEqual({value:{writeEnabled:false}});expect(events).toContain('dom_read_complete');
});
