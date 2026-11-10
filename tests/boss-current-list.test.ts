import {it,expect} from 'vitest';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {readFileSync} from 'node:fs';
const {ActionExecutor}=await import(pathToFileURL(resolve('extensions/boss-page/action-executor.js')).href);
const binding={sessionId:'s',tabId:1,frameId:0,documentId:'d'},hash='a'.repeat(64);
const cmd=(tool:string,payload:any={},id=tool)=>({version:4,tool,payload,context:{runId:'r',leaseId:'l',requestId:id,binding,deadline:new Date(Date.now()+10000).toISOString()}});
function setup(mode='run',maxContacts=150){const records=new Map();const ex=new ActionExecutor({get:async(k:string)=>records.get(k),put:async(k:string,v:any)=>records.set(k,v)});ex.start('r','l',{mode,batchId:'b',maxContacts},binding,4);return ex;}
it('v4 preview denies contact and callers cannot supply restoration URLs',async()=>{
 const ex=setup('preview',0);
 await expect(ex.execute(cmd('open_chat',{jobKey:'j'}),async()=>({}))).rejects.toThrow('SCOPE_DENIED');
 await expect(ex.execute(cmd('restore_list',{url:'https://evil.test'}),async()=>({}))).rejects.toThrow('INVALID_PAYLOAD');
});
it('a zero remaining budget permits recovery reads but no phrase write',async()=>{
 const ex=setup('run',0);await ex.execute(cmd('read_first_phrase',{conversationKey:'j'},'read'),async()=>({text:'hello',hash}));await ex.execute(cmd('bind_phrase',{conversationKey:'j',expectedHash:hash,observationRequestId:'read'}),async()=>({}));
 await expect(ex.execute(cmd('choose_first_phrase',{conversationKey:'j',expectedHash:hash}),async()=>({}))).rejects.toThrow('SCOPE_DENIED');
 await expect(ex.execute(cmd('submit_filled_phrase',{conversationKey:'j',expectedHash:hash}),async()=>({}))).rejects.toThrow('SCOPE_DENIED');
 expect((await ex.execute(cmd('inspect_send_result',{conversationKey:'j',expectedHash:hash}),async()=>({status:'confirmed'}))).phase).toBe('observed');
});
it('requires observed phrase binding, allows only first bootstrap chat and preserves budget',async()=>{
 const ex=setup();
 await expect(ex.execute(cmd('choose_first_phrase',{conversationKey:'j',expectedHash:hash}),async()=>({}))).rejects.toThrow('PHRASE_NOT_BOUND');
 await ex.execute(cmd('open_chat',{jobKey:'j'}),async()=>({conversationKey:'j'}));
 await expect(ex.execute(cmd('open_chat',{jobKey:'j2'},'second'),async()=>({}))).rejects.toThrow('BOOTSTRAP_CHAT_LIMIT');
 await ex.execute(cmd('read_first_phrase',{conversationKey:'j'},'read'),async()=>({hash,text:'hello'}));
 await expect(ex.execute(cmd('bind_phrase',{conversationKey:'j',expectedHash:hash,observationRequestId:'wrong'}),async()=>({}))).rejects.toThrow('PHRASE_OBSERVATION_MISMATCH');
 let effects=0;await ex.execute(cmd('bind_phrase',{conversationKey:'j',expectedHash:hash,observationRequestId:'read'},'bind'),async()=>{effects++;});
 expect(effects).toBe(0);ex.renew('r','l');expect(ex.run.contacts).toBe(1);
 await expect(ex.execute(cmd('choose_first_phrase',{conversationKey:'j',expectedHash:'b'.repeat(64)},'changed'),async()=>({}))).rejects.toThrow('PHRASE_MISMATCH');
});
it('never retries a selection under a fresh request and enforces the hard budget',async()=>{
 const ex=setup('run',1);await ex.execute(cmd('open_chat',{jobKey:'j'}),async()=>({conversationKey:'j'}));
 await ex.execute(cmd('read_first_phrase',{conversationKey:'j'},'read'),async()=>({hash,text:'hello'}));
 await ex.execute(cmd('bind_phrase',{conversationKey:'j',expectedHash:hash,observationRequestId:'read'}),async()=>({}));
 await ex.execute(cmd('choose_first_phrase',{conversationKey:'j',expectedHash:hash},'select'),async()=>({status:'submitted'}));
 await expect(ex.execute(cmd('choose_first_phrase',{conversationKey:'j',expectedHash:hash},'select2'),async()=>({}))).rejects.toThrow('POSSIBLE_PRIOR_SEND');
 await ex.execute(cmd('inspect_send_result',{conversationKey:'j',expectedHash:hash}),async()=>({status:'confirmed'}));
 await expect(ex.execute(cmd('open_chat',{jobKey:'j2'},'other'),async()=>({}))).rejects.toThrow('CONTACT_LIMIT');
});
it('restores only its internally captured original tab and keeps original conditions across leases',async()=>{
 const {CurrentListSession}=await import(pathToFileURL(resolve('extensions/boss-page/current-list-session.js')).href);
 const saved:any={},updates:any[]=[];let tab={id:1,url:'https://www.zhipin.com/web/geek/jobs?query=工程师&token=private'};
 const owner={binding};const w:any={owner,state:{},api:{storage:{local:{get:async(k:string)=>({[k]:saved[k]}),set:async(v:any)=>Object.assign(saved,structuredClone(v))}},tabs:{get:async()=>tab,update:async(id:number,value:any)=>{updates.push({id,...value});tab={...tab,...value};}},webNavigation:{getFrame:async()=>({url:tab.url,documentId:'restored'})}},adopt:async()=>{owner.binding={...binding,documentId:'restored'};}};
 const session=new CurrentListSession(w);await session.start('b');const snapshot={fingerprint:hash,keyword:'工程师',city:'北京',url:'https://www.zhipin.com/web/geek/jobs?query=工程师',filters:{}};await session.observe({snapshot});
 tab.url='https://www.zhipin.com/web/geek/chat';const resumed=new CurrentListSession(w);await resumed.start('b');await resumed.restore(cmd('restore_list'),()=>{});
 expect(updates[0]).toEqual({id:1,active:true,url:'https://www.zhipin.com/web/geek/jobs?query=工程师&token=private'});expect(w.state.snapshot).toEqual(snapshot);
 await expect(resumed.observe({snapshot:{...snapshot,fingerprint:'b'.repeat(64)}})).rejects.toThrow('LIST_CONDITIONS_CHANGED');
 owner.binding={...binding,sessionId:'other'};await expect(new CurrentListSession(w).start('b')).rejects.toThrow('LIST_SESSION_CHANGED');
});
it('initializes v4 through the workflow controller and fixes its first snapshot',async()=>{
 const {WorkflowController}=await import(pathToFileURL(resolve('extensions/boss-page/workflow-controller.js')).href);
 const records:any={},sent:any[]=[];const snapshot={fingerprint:hash,keyword:'任意',city:'北京',url:'https://www.zhipin.com/web/geek/jobs',filters:{}};
 const owner:any={binding,frameMatches:async()=>{},event:async()=>{},port:{postMessage:(m:any)=>sent.push(m)}};
 const w=new WorkflowController(owner,{storage:{local:{get:async(k:string)=>({[k]:records[k]}),set:async(v:any)=>Object.assign(records,v)}},tabs:{get:async()=>({id:1,url:'https://www.zhipin.com/web/geek/jobs'}),sendMessage:async(_id:number,m:any)=>({value:m.stage==='observe'?{snapshot,jobs:[],exhausted:true}:{snapshot}})},webNavigation:{getFrame:async()=>({documentId:'d',url:'https://www.zhipin.com/web/geek/jobs'})}});
 await w.execute(cmd('start_run',{mode:'preview',batchId:'b',maxContacts:0}));expect(sent.at(-1).result.phase).toBe('observed');expect(w.currentList.original.tabId).toBe(1);
 await w.execute(cmd('inspect_current_list'));expect(sent.at(-1).result.phase).toBe('observed');expect(w.state.snapshot).toEqual(snapshot);
 expect(JSON.stringify(sent)).not.toContain('rawUrl');
});
it('captures arbitrary city, mixed experiences and stable sanitized conditions',async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});try{const p=await b.newPage();await p.route('https://www.zhipin.com/**',route=>route.fulfill({body:'<html></html>',contentType:'text/html'}));await p.goto('https://www.zhipin.com/web/geek/jobs');await p.setContent('<span class="city-label">北京</span><input placeholder="搜索职位" value="工程师"><div class="current-select">全职</div>'+['1-3年','3-5年','5-10年'].map((exp,i)=>`<div class="job-card-box"><a class="job-name" href="/job_detail/j${i}.html">工程师</a><span class="company-name">甲</span><li>${exp}</li></div>`).join(''));
 const source=['selectors','experience-dom','search-filters','search-actions','chat-actions','current-list-actions'].map(f=>readFileSync(`extensions/boss-page/${f}.js`,'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export ','')).join('\n');
 await p.addScriptTag({content:source+';window.currentListView=currentListView;window.currentListAction=currentListAction;'});
 const read=(url:string)=>p.evaluate(url=>(window as any).currentListView(document,url),url);
 const first=await read('https://www.zhipin.com/web/geek/jobs?query=工程师&city=101010100&token=secret&page=1');
 expect(first.jobs.map((j:any)=>j.experience)).toEqual(['exp_1_3','exp_3_5',null]);expect(first.snapshot.url).not.toContain('secret');
 expect((await read('https://www.zhipin.com/web/geek/jobs?query=工程师&city=101010100&page=2')).snapshot.fingerprint).toBe(first.snapshot.fingerprint);
 expect((await read('https://www.zhipin.com/web/geek/jobs?experience=104,103&query=工程师&city=101010100')).snapshot.fingerprint).toBe((await read('https://www.zhipin.com/web/geek/jobs?query=工程师&city=101010100&experience=103,104')).snapshot.fingerprint);
 await p.evaluate(async snapshot=>{(window as any).advanceState=await (window as any).currentListAction(document,'https://www.zhipin.com/web/geek/jobs?query=工程师&city=101010100','prepare',{version:4,tool:'advance_list',payload:{}},{snapshot});},first.snapshot);
 const advanceObservation=()=>p.evaluate(()=>(window as any).currentListAction(document,'https://www.zhipin.com/web/geek/jobs?query=工程师&city=101010100','observe',{version:4,tool:'advance_list',payload:{}},(window as any).advanceState));
 await expect(advanceObservation()).rejects.toThrow('LIST_NOT_ADVANCED');
 await p.locator('body').evaluate(e=>e.insertAdjacentHTML('beforeend','<div class="job-card-box"><a class="job-name" href="/job_detail/jnew.html">新岗位</a><span class="company-name">甲</span><li>1-3年</li></div>'));
 expect((await advanceObservation()).jobs.at(-1).key).toBe('jnew');
 await p.locator('body').evaluate(e=>e.insertAdjacentHTML('beforeend','<div class="job-detail-box" data-job-id="j0"><span class="job-name">工程师</span><span class="company-name">甲</span><span class="job-experience">1-3年</span><span class="boss-name">李</span><button>立即沟通</button></div>'));
 const detail=()=>p.evaluate(async snapshot=>{const c={version:4,tool:'open_job',payload:{jobKey:'j0'}},url='https://www.zhipin.com/web/geek/jobs?query=工程师&city=101010100';const state=await (window as any).currentListAction(document,url,'prepare',c,{snapshot});return (window as any).currentListAction(document,url,'observe',c,state);},first.snapshot);
 expect((await detail()).experience).toBe('exp_1_3');
 await expect(p.evaluate(async snapshot=>{
  const fn=(window as any).currentListAction,url='https://www.zhipin.com/web/geek/jobs?query=工程师&city=101010100',c={version:4,tool:'open_chat',payload:{jobKey:'j0'}};
  const state=await fn(document,url,'prepare',c,{snapshot,job:{key:'j0',title:'工程师',company:'甲'}});
  return fn(document,url,'perform',c,state,async()=>{document.querySelector('.job-experience')!.textContent='3-5年';});
 },first.snapshot)).rejects.toThrow('JOB_EXPERIENCE_CHANGED');
 await p.locator('.job-experience').evaluate(e=>e.textContent='3-5年');expect(await detail()).toMatchObject({status:'unavailable',reason:'JOB_EXPERIENCE_UNVERIFIED'});
 await p.locator('.job-experience').evaluate(e=>e.remove());expect(await detail()).toMatchObject({status:'unavailable',reason:'JOB_EXPERIENCE_UNVERIFIED'});
 await p.locator('.city-label').evaluate(e=>e.textContent='上海');expect((await read('https://www.zhipin.com/web/geek/jobs?query=工程师&city=101010100')).snapshot.fingerprint).not.toBe(first.snapshot.fingerprint);
 }finally{await b.close();}
});
