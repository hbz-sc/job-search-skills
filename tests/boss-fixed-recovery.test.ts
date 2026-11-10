import {test,expect} from 'vitest';
import {chromium} from 'playwright';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const scripts=()=>['selectors','experience-dom','search-filters','search-actions','chat-actions'].map(f=>readFileSync(`extensions/boss-page/${f}.js`,'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export ','')).join('\n')+';Object.assign(window,{chatAction,phraseHash});';
const html='<div class="chat-conversation"><div class="top-info-content"><span class="position-name">Java岗位</span><div class="base-info"><span>甲公司</span></div><span class="name-text">招聘人</span></div><textarea class="chat-input"></textarea><button class="btn-send">发送</button><div class="phrase-panel"><div class="phrase-item">您好</div></div><div class="chat-record"></div></div>';

test('v3 resume requires an observed job key, not echoed input',async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});try{const p=await b.newPage();await p.setContent(html);await p.addScriptTag({content:scripts()});
 const run=()=>p.evaluate(()=>(window as any).chatAction(document,'https://www.zhipin.com/web/geek/chat','prepare',{version:3,tool:'inspect_chat',payload:{conversationKey:'j'}},{}));
 await expect(run()).rejects.toThrow('CHAT_JOB_KEY_UNVERIFIED');
 await p.locator('.top-info-content').evaluate(e=>e.insertAdjacentHTML('beforeend','<a href="/job_detail/other.html">岗位</a>'));
 await expect(run()).rejects.toThrow('CHAT_JOB_KEY_UNVERIFIED');
 await p.locator('.top-info-content a').evaluate(e=>e.setAttribute('href','/job_detail/j.html'));
 expect((await run()).target.conversationKey).toBe('j');
 }finally{await b.close();}
});

test('persisted receipt verifies delivery after controller state was lost',async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});try{const p=await b.newPage();await p.route('https://fixture.test/**',r=>r.fulfill({body:html,contentType:'text/html; charset=utf-8'}));await p.goto('https://fixture.test/');await p.addScriptTag({content:scripts()});
 const result=await p.evaluate(async()=>{const w=window as any,target={conversationKey:'j',title:'Java岗位',company:'甲公司',recruiter:'招聘人'},phrase={text:'您好',hash:await w.phraseHash('您好')};
 document.querySelector('.chat-record')!.innerHTML='<li class="message-item item-myself"><span class="text-content">您好</span><i class="message-status">送达</i></li>';
 const c={version:3,tool:'choose_first_phrase',payload:{conversationKey:'j',expectedHash:phrase.hash}};
 const choice=await w.chatAction(document,'https://www.zhipin.com/web/geek/chat','observe',c,{target,phrase,baseline:[]});
 const receipt=choice.receipt, inspect={version:3,tool:'inspect_send_result',payload:{conversationKey:'j',expectedHash:phrase.hash,receipt}};
 const prepared=await w.chatAction(document,'https://www.zhipin.com/web/geek/chat','prepare',inspect,{chat:target,phrase});
 const observed=await w.chatAction(document,'https://www.zhipin.com/web/geek/chat','observe',inspect,prepared);
 return {receipt,observed};});
 expect(result.receipt).toMatchObject({beforeCount:0});expect(result.receipt.beforeHash).toMatch(/^[a-f0-9]{64}$/);expect(result.observed.status).toBe('confirmed');
 }finally{await b.close();}
});

test('filled receipt supports single submit after restart and rejects changed history',async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});try{const p=await b.newPage();await p.route('https://fixture.test/**',r=>r.fulfill({body:html,contentType:'text/html; charset=utf-8'}));await p.goto('https://fixture.test/');await p.addScriptTag({content:scripts()});
 const r=await p.evaluate(async()=>{const w=window as any,target={conversationKey:'j',title:'Java岗位',company:'甲公司',recruiter:'招聘人'},phrase={text:'您好',hash:await w.phraseHash('您好')};let clicks=0;document.querySelector('.btn-send')!.addEventListener('click',()=>clicks++);(document.querySelector('textarea') as HTMLTextAreaElement).value=phrase.text;
 const chosen=await w.chatAction(document,'https://www.zhipin.com/web/geek/chat','observe',{version:3,tool:'choose_first_phrase',payload:{conversationKey:'j',expectedHash:phrase.hash}},{target,phrase,baseline:[]});
 const c={version:3,tool:'submit_filled_phrase',payload:{conversationKey:'j',expectedHash:phrase.hash,receipt:chosen.receipt}},state=await w.chatAction(document,'https://www.zhipin.com/web/geek/chat','prepare',c,{chat:target,phrase});await w.chatAction(document,'https://www.zhipin.com/web/geek/chat','perform',c,state);
 let rejected=false;try{await w.chatAction(document,'https://www.zhipin.com/web/geek/chat','prepare',{...c,payload:{...c.payload,receipt:{beforeCount:1,beforeHash:'a'.repeat(64)}}},{chat:target,phrase});}catch{rejected=true;}return {clicks,rejected};});
 expect(r).toEqual({clicks:1,rejected:true});
 }finally{await b.close();}
});

test('receipt payload is strictly limited to inspection and submission in v3',async()=>{
 const {validateAction}=await import(pathToFileURL(resolve('extensions/boss-page/action-executor.js')).href);
 const c={version:3,tool:'inspect_send_result',context:{runId:'r',requestId:'q',leaseId:'l',binding:{sessionId:'s',tabId:1,frameId:0,documentId:'d'},deadline:new Date(Date.now()+10000).toISOString()},payload:{conversationKey:'j',expectedHash:'a'.repeat(64),receipt:{beforeCount:0,beforeHash:'b'.repeat(64)}}};
 expect(()=>validateAction(c)).not.toThrow();expect(()=>validateAction({...c,tool:'choose_first_phrase'})).toThrow();expect(()=>validateAction({...c,payload:{...c.payload,receipt:{beforeCount:-1,beforeHash:'b'.repeat(64)}}})).toThrow();
 const schema=JSON.parse(readFileSync('contracts/boss-search-v3.schema.json','utf8'));for(const tool of ['inspect_send_result','submit_filled_phrase'])expect(schema.allOf.find((x:any)=>x.if?.properties?.tool?.const===tool).then.properties.payload.properties.receipt).toBeDefined();
});
