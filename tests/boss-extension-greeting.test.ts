import {it,expect} from 'vitest';
import {chromium} from 'playwright';
import {readFileSync} from 'node:fs';
import {fixtureServer} from './fixtures/server.js';
const scripts=()=>['selectors','search-actions','chat-actions'].map(f=>readFileSync(`extensions/boss-page/${f}.js`,'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export ','')).join('\n');
it('waits for a rerendered detail before preparing communication without clicking during the wait',async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});try{const p=await b.newPage();await p.setContent('<main></main>');
 await p.addScriptTag({content:scripts()+';window.chatAction=chatAction;'});
 const r=await p.evaluate(async()=>{
  let clicks=0;setTimeout(()=>{document.querySelector('main')!.innerHTML='<div class="job-detail-box" data-job-id="a"><span class="job-name">AI</span><span class="company-name">甲</span><span class="boss-name">李</span><button>立即沟通</button></div>';document.querySelector('button')!.onclick=()=>clicks++;},300);
  const c={tool:'open_chat',payload:{jobKey:'a'},context:{deadline:new Date(Date.now()+3000).toISOString()}};
  const state=await (window as any).chatAction(document,location.href,'prepare',c,{job:{key:'a',title:'AI',company:'甲'}});
  return {state,clicks};
 });expect(r.state.target.key).toBe('a');expect(r.clicks).toBe(0);
 }finally{await b.close();}
});
it('skips an unrecovered detail before any communication click and never sends to the replacement job',async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});try{const p=await b.newPage();
 await p.setContent('<div class="job-detail-box" data-job-id="other"><span class="job-name">AI</span><span class="company-name">甲</span><span class="boss-name">李</span><button>立即沟通</button></div>');await p.addScriptTag({content:scripts()+';window.chatAction=chatAction;'});
 const r=await p.evaluate(async()=>{let clicks=0;document.querySelector('button')!.onclick=()=>clicks++;const f=(window as any).chatAction,c={tool:'open_chat',payload:{jobKey:'a'},context:{deadline:new Date(Date.now()+400).toISOString()}},s=await f(document,location.href,'prepare',c,{job:{key:'a',title:'AI',company:'甲'}});await f(document,location.href,'perform',c,s);return {result:await f(document,location.href,'observe',c,s),clicks};});
 expect(r.result).toMatchObject({status:'unavailable',reason:'DETAIL_JOB_KEY_MISMATCH'});expect(r.clicks).toBe(0);
 }finally{await b.close();}
});
it('accepts headhunter chat without company and with a changed job label, but rejects a different recruiter',async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});try{const p=await b.newPage();
 await p.setContent('<div class="chat-conversation"><div class="top-info-content"><span class="name-text">刘云坤</span><span class="position-name">AI应用开发工程师（猎头职位）</span></div></div>');
 await p.addScriptTag({content:scripts()+';window.chatAction=chatAction;'});
 const observe=()=>p.evaluate(()=>(window as any).chatAction(document,'https://www.zhipin.com/web/geek/chat','observe',{tool:'open_chat',payload:{jobKey:'a'}},{target:{key:'a',conversationKey:'a',title:'AI应用开发工程师',company:'匿名公司',recruiter:'刘云坤'}}));
 expect(await observe()).toMatchObject({conversationKey:'a',existingMessages:0});
 await p.locator('.name-text').evaluate(e=>e.textContent='另一人');await expect(observe()).rejects.toThrow('CHAT_TARGET_NOT_READY');
 }finally{await b.close();}
});
it('acknowledges a positive remaining-contact notice without clicking communication twice',async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});try{const p=await b.newPage();
 await p.setContent('<div class="job-detail-box" data-job-id="a"><span class="job-name">AI</span><span class="company-name">甲</span><span class="boss-name">李</span><button>立即沟通</button></div><div class="chat-block-dialog">温馨提示您今天已与120位BOSS沟通，还剩30次沟通机会哦<button><span>好</span></button></div>');
 await p.addScriptTag({content:scripts()+';window.chatAction=chatAction;'});
 const r=await p.evaluate(async()=>{let ack=0,contact=0;document.querySelector('.chat-block-dialog button')!.addEventListener('click',()=>ack++);document.querySelector('.job-detail-box button')!.addEventListener('click',()=>contact++);const f=(window as any).chatAction,c={tool:'open_chat',payload:{jobKey:'a'}};const state=await f(document,location.href,'prepare',c,{job:{key:'a',title:'AI',company:'甲'}});await f(document,location.href,'perform',c,state);return {ack,contact};});
 expect(r).toEqual({ack:1,contact:0});
 }finally{await b.close();}
});
it('separates explicit send failure from loading and reports failure without throwing or resending',async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});try{const p=await b.newPage();await p.setContent('<div class="chat-conversation"><span class="chat-position">AI</span><span class="chat-company">甲</span><span class="boss-name">李</span><div class="chat-record"><li class="message-item item-myself"><span class="text-content">你好</span><i class="message-status">发送失败</i></li></div></div>');await p.addScriptTag({content:scripts()+';window.chatAction=chatAction;window.newPhraseStatus=newPhraseStatus;'});
 const result=await p.evaluate(()=>(window as any).chatAction(document,location.href,'observe',{tool:'inspect_send_result',payload:{conversationKey:'a'}},{target:{title:'AI',company:'甲',recruiter:'李',conversationKey:'a'},baseline:[],phrase:{text:'你好'}}));expect(result).toEqual({status:'failed'});
 await p.locator('.message-status').evaluate(e=>e.textContent='发送中');expect(await p.evaluate(()=>(window as any).newPhraseStatus(document,[],'你好'))).toBe('pending');
 }finally{await b.close();}
});
it('reads message body separately from its nested delivery label',async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});try{const p=await b.newPage();
 await p.setContent('<div class="chat-record"><li class="message-item item-myself"><div class="text"> <i class="message-status status-delivery">送达</i> <p><span class="text-content">第一条原文</span></p></div></li></div>');await p.addScriptTag({content:scripts()+';window.outgoing=outgoing;window.newPhraseStatus=newPhraseStatus;'});
 const r=await p.evaluate(()=>({messages:(window as any).outgoing(document),result:(window as any).newPhraseStatus(document,[],'第一条原文')}));expect(r).toEqual({messages:[{text:'第一条原文',status:'送达'}],result:'confirmed'});
 }finally{await b.close();}
});
it('selects the first saved sentence from the actual sentence-panel list',async()=>{
 const srv=await fixtureServer('<main></main>'),b=await chromium.launch({channel:'msedge',headless:true});try{const p=await b.newPage();await p.goto(srv.url);
 await p.setContent('<div class="chat-conversation"><div class="chat-position">AI</div><div class="chat-company">甲</div><div class="boss-name">李</div><div class="sentence-panel"><h3>常用语</h3><span>设置</span><ul><li>第一条原文</li><li>第二条</li></ul></div><textarea class="chat-input"></textarea></div>');
 await p.addScriptTag({content:scripts()+';window.chatAction=chatAction;document.querySelector("li").onclick=()=>document.querySelector("textarea").value=document.querySelector("li").textContent;'});
 const r=await p.evaluate(async()=>{const f=(window as any).chatAction;const state:any={chat:{title:'AI',company:'甲',recruiter:'李',conversationKey:'a'}};const act=async(tool:string,payload:any)=>{const c={tool,payload},s=await f(document,location.href,'prepare',c,state);await f(document,location.href,'perform',c,s);return f(document,location.href,'observe',c,s);};state.phrase=await act('read_first_phrase',{conversationKey:'a'});return {phrase:state.phrase.text,chosen:await act('choose_first_phrase',{conversationKey:'a',expectedHash:state.phrase.hash})};});
 expect(r).toEqual({phrase:'第一条原文',chosen:{status:'filled'}});
 }finally{await b.close();await srv.close();}
});
it('resumes current nested chat read-only, returning header for caller validation without navigation',async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});try{const p=await b.newPage();
 await p.setContent('<div class="chat-container"><div class="chat-conversation"><div class="top-info-content"><div class="base-info"><div><span class="name-text">李</span></div><span>甲</span><span class="base-title">HR</span></div><span class="position-name">AI</span></div></div></div>');
 await p.addScriptTag({content:scripts()+';window.chatAction=chatAction;'});
 const r=await p.evaluate(async()=>{const f=(window as any).chatAction,c={tool:'inspect_chat',payload:{conversationKey:'a'}},url='https://www.zhipin.com/web/geek/chat';const state=await f(document,url,'prepare',c,{});await f(document,url,'perform',c,state);return f(document,url,'observe',c,state);});
 expect(r).toMatchObject({title:'AI',company:'甲',recruiter:'李',conversationKey:'a',existingMessages:0});
 }finally{await b.close();}
});
it('checks the live BOSS header and reopens only the matching existing communication',async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});try{const p=await b.newPage();
 await p.setContent('<div class="chat-conversation"><div class="top-info-content"><div class="base-info"><span class="name-text">姚女士</span><span>星尚智能</span></div><div class="chat-position-content"><span class="position-name">ai应用开发工程师</span></div></div></div>');
 await p.addScriptTag({content:scripts()+';window.checkChat=checkChat;window.chatAction=chatAction;'});
 expect(await p.evaluate(()=>!!(window as any).checkChat(document,{title:'ai应用开发工程师',company:'星尚智能',recruiter:'姚女士'}))).toBe(true);
 await p.locator('.name-text').evaluate(e=>e.textContent='另一位招聘者');
 await expect(p.evaluate(()=>(window as any).checkChat(document,{title:'ai应用开发工程师',company:'星尚智能',recruiter:'姚女士'}))).rejects.toThrow('CHAT_TARGET_MISMATCH');
 await expect(p.evaluate(()=>(window as any).chatAction(document,location.href,'observe',{tool:'open_chat',payload:{jobKey:'a'}},{target:{title:'ai应用开发工程师',company:'星尚智能',recruiter:'姚女士'}}))).rejects.toThrow('CHAT_TARGET_NOT_READY');
 await p.setContent('<div class="job-detail-box" data-job-id="a"><span class="job-name">AI</span><span class="company-name">甲</span><span class="boss-name">李</span><button>继续沟通</button></div>');
 const r=await p.evaluate(()=>(window as any).chatAction(document,location.href,'prepare',{tool:'open_chat',payload:{jobKey:'a'}},{job:{key:'a',title:'AI',company:'甲'}}));expect(r.label).toBe('继续沟通');
 }finally{await b.close();}
});
it('distinguishes a loading chat root from multiple chat targets',async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});try{const p=await b.newPage();await p.setContent('<main></main>');await p.addScriptTag({content:scripts()+';window.checkChat=checkChat;'});
 const read=()=>p.evaluate(()=>(window as any).checkChat(document,{title:'AI',company:'甲',recruiter:'李'}));
 await expect(read()).rejects.toThrow('CHAT_NOT_READY');
 await p.locator('main').evaluate(e=>e.innerHTML='<div class="chat-container">一</div><div class="chat-container">二</div>');
 await expect(read()).rejects.toThrow('CHAT_AMBIGUOUS');
 }finally{await b.close();}
});
it('uses the same nested detail root when preparing communication without clicking',async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});try{const p=await b.newPage();
 await p.setContent('<div class="job-detail-container"><div class="job-detail-box" data-job-id="a"><span class="job-name">AI</span><span class="company-name">甲</span><span class="boss-name">李</span><button>立即沟通</button></div></div>');
 await p.addScriptTag({content:scripts()+';window.chatAction=chatAction;'});
 const r=await p.evaluate(()=>(window as any).chatAction(document,location.href,'prepare',{tool:'open_chat',payload:{jobKey:'a'}},{job:{key:'a',title:'AI',company:'甲'}}));
 expect(r.target.key).toBe('a');expect(r.target.recruiter).toBe('李');
 }finally{await b.close();}
});
for(const mode of ['direct','fill'])it(`selects exact first phrase once in ${mode} mode and ignores preexisting identical message`,async()=>{
 const html=`<div class="chat-conversation"><div class="chat-position">AI应用开发工程师</div><div class="chat-company">公司甲</div><div class="boss-name">李女士</div><div class="chat-record"><div class="message-item item-myself"><span class="text">您好\n原文 </span><span class="message-status">送达</span></div></div><button title="常用语">常用语</button><div class="phrase-panel" hidden><button class="phrase-item">您好\n原文 </button><button class="phrase-item">第二条</button></div><textarea class="chat-input"></textarea><button class="btn-send">发送</button></div><script>window.sent=0;function send(){window.sent++;const e=document.createElement('div');e.className='message-item item-myself';e.innerHTML='<span class="text"></span><span class="message-status">送达</span>';e.querySelector('.text').textContent=document.querySelector('.phrase-item').textContent;document.querySelector('.chat-record').append(e);document.querySelector('textarea').value='';}document.querySelector('[title]').onclick=()=>document.querySelector('.phrase-panel').hidden=false;document.querySelector('.phrase-item').onclick=()=>{${mode==='direct'?'send()':"document.querySelector('textarea').value=document.querySelector('.phrase-item').textContent"}};document.querySelector('.btn-send').onclick=send;</script>`;
 const srv=await fixtureServer(html),b=await chromium.launch({channel:'msedge',headless:true});try{
  const p=await b.newPage();await p.goto(srv.url);await p.addScriptTag({content:scripts()+';window.chatAction=chatAction;'});
  const result=await p.evaluate(async()=>{
   const f=(window as any).chatAction;let state:any={chat:{conversationKey:'j1',title:'AI应用开发工程师',company:'公司甲',recruiter:'李女士'}};
   const act=async(tool:string,payload:any)=>{const c={tool,payload};const s=await f(document,location.href,'prepare',c,state);await f(document,location.href,'perform',c,s);const v=await f(document,location.href,'observe',c,s);return {s,v};};
   const phrase=await act('read_first_phrase',{conversationKey:'j1'});state.phrase=phrase.v;
   const chosen=await act('choose_first_phrase',{conversationKey:'j1',expectedHash:phrase.v.hash});state.selection={...chosen.s,result:chosen.v};
   if(chosen.v.status==='filled'){const sub=await act('submit_filled_phrase',{conversationKey:'j1',expectedHash:phrase.v.hash});state.selection={...sub.s,result:sub.v};}
   const verified=await act('inspect_send_result',{conversationKey:'j1',expectedHash:phrase.v.hash});return {text:phrase.v.text,status:chosen.v.status,result:verified.v,sent:(window as any).sent};
  });expect(result.text).toBe('您好\n原文 ');expect(result.sent).toBe(1);expect(result.status).toBe(mode==='direct'?'submitted':'filled');expect(result.result.status).toBe('confirmed');
 }finally{await b.close();await srv.close();}
});
it('does not click a sending phrase when stopped during asynchronous hashing',async()=>{
 const srv=await fixtureServer('<div class="chat-conversation"><div class="chat-position">AI</div><div class="chat-company">甲</div><div class="boss-name">李</div><div class="phrase-panel"><button class="phrase-item">您好</button></div><textarea class="chat-input"></textarea></div>');
 const b=await chromium.launch({channel:'msedge',headless:true});try{const p=await b.newPage();await p.goto(srv.url);await p.addScriptTag({content:scripts()+';window.chatAction=chatAction;window.phraseHash=phraseHash;'});
 const result=await p.evaluate(async()=>{
  const hash=await (window as any).phraseHash('您好');let clicks=0,stopped=false,release!:(v:any)=>void;const original=crypto.subtle.digest.bind(crypto.subtle);
  const actual=await original('SHA-256',new TextEncoder().encode('您好'));crypto.subtle.digest=(()=>new Promise(r=>release=r)) as typeof crypto.subtle.digest;
  document.querySelector('.phrase-item')!.addEventListener('click',()=>clicks++);
  const running=(window as any).chatAction(document,location.href,'perform',{tool:'choose_first_phrase',payload:{conversationKey:'j',expectedHash:hash}},{target:{conversationKey:'j',title:'AI',company:'甲',recruiter:'李'}},async()=>{if(stopped)throw Error('RUN_STOPPED');});
  stopped=true;release(actual);let error='';try{await running;}catch(e){error=(e as Error).message;}return {clicks,error};
 });expect(result.clicks).toBe(0);expect(result.error).toBe('RUN_STOPPED');
 }finally{await b.close();await srv.close();}
});
