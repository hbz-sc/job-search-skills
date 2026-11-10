import {test,expect} from 'vitest';
import {chromium} from 'playwright';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {parseSearchScope,parseSearchView} from '../src/boss-extension/search-protocol.js';
const {ActionExecutor,validateSearchScope,validateAction}=await import(pathToFileURL(resolve('extensions/boss-page/action-executor.js')).href);
const {WorkflowController}=await import(pathToFileURL(resolve('extensions/boss-page/workflow-controller.js')).href);
const scope={mode:'preview',batchId:'batch',planHash:'a'.repeat(64),allowedKeywords:['Java开发工程师'],city:'current',experienceBands:['exp_1_3','exp_3_5'],maxContacts:0,expectedPhraseHash:null};
const binding={sessionId:'s',tabId:1,frameId:0,documentId:'d'};
const q={city:'current' as const,keyword:'Java开发工程师',experience:'exp_1_3' as const};
const cmd=(city:string)=>({version:3,tool:'search_jobs',payload:{...q,city},context:{runId:'r',leaseId:'l',requestId:'q',binding,deadline:new Date(Date.now()+10000).toISOString()}});
test('current city is explicit v3 authorization, cannot cross strict scope or leak into v2',async()=>{
 expect(parseSearchScope(scope).city).toBe('current');expect(validateSearchScope(scope).city).toBe('current');
 for(const city of ['current','深圳']){
  const ex=new ActionExecutor({get:async()=>undefined,put:async()=>{}});ex.start('r','l',{...scope,city},binding,3);
  await expect(ex.execute(cmd(city==='current'?'深圳':'current'),async()=>{throw Error('DISPATCHED');})).rejects.toThrow('SCOPE_DENIED');
  expect((await ex.execute(cmd(city),async()=>({}))).phase).toBe('observed');
 }
 expect(()=>validateAction({...cmd('current'),version:2,payload:{city:'current',keyword:'AI应用开发工程师'}})).toThrow('INVALID_SCOPE');
});
test('current results report actual city and keep keyword, experience and strict city validation',()=>{
 const v={observedCity:'广州',observedKeyword:q.keyword,observedExperience:q.experience,filterEvidence:{keyword:q.keyword,city:'广州',experience:'1-3年',results:'visible-empty-result'},jobs:[],exhausted:true};
 expect(parseSearchView(v,q).observedCity).toBe('广州');
 for(const city of ['', 'current'])expect(()=>parseSearchView({...v,observedCity:city},q)).toThrow();
 expect(()=>parseSearchView(v,{...q,city:'深圳'})).toThrow('FILTER_UNVERIFIED');
 expect(()=>parseSearchView({...v,observedKeyword:'wrong'},q)).toThrow('FILTER_UNVERIFIED');
});
test('Guangzhou search navigation survives only current scope and wrong keyword still stops',()=>{
 for(const city of ['current','深圳']){
  const w=new WorkflowController({binding},{});w.executor.start('r','l',{...scope,city},binding,3);
  w.navigation={tool:'search_jobs',sourceTab:1,keyword:q.keyword,until:Date.now()+5000};
  const url='https://www.zhipin.com/web/geek/jobs?query='+q.keyword+'&city=101280100';
  expect(w.changed('committed',{tabId:1,url})).toBe(city==='current');
  if(city==='current')expect(w.executor.run).not.toBeNull();else expect(w.executor.run).toBeNull();
  expect(w.changed('committed',{tabId:1,url:url.replace(q.keyword,'wrong')})).toBe(false);
  expect(w.executor.run).toBeNull();
  expect(w.expectedUrl(url.replace('www.zhipin.com','evil.test'))).toBe(false);
 }
});
test('search, restore, list and candidate checks follow current city and report DOM or labelled URL evidence',async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});try{
 const p=await b.newPage();await p.setContent('<span class="city-label">广州</span><input placeholder="搜索职位" value="Java开发工程师"><div class="current-select">1-3年</div><div class="job-card-box"><a class="job-name" href="/job_detail/j1.html">Java</a><span class="company-name">甲</span><li>1-3年</li></div>');
 const source=['selectors','experience-dom','search-filters','search-actions'].map(f=>readFileSync(`extensions/boss-page/${f}.js`,'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export ','')).join('\n');
 await p.addScriptTag({content:source+';window.searchAction=searchAction;window.assertSearchCandidate=assertSearchCandidate;'});
 const url='https://www.zhipin.com/web/geek/jobs?query=Java开发工程师&city=101280100';
 for(const tool of ['search_jobs','restore_search','list_jobs']){
  const run=(city:string,stage:string)=>p.evaluate(({tool,city,stage,q,url})=>(window as any).searchAction(document,url,stage,{version:3,tool,payload:{...q,city,advance:false}},{}),{tool,city,stage,q,url});
  await run('current','prepare');expect(await run('current','observe')).toMatchObject({observedCity:'city-code:101280100',filterEvidence:{city:'city-code:101280100'}});
  await expect(run('深圳','prepare')).rejects.toThrow('CITY_MISMATCH');
 }
 const domOnly=await p.evaluate(({q,url})=>(window as any).searchAction(document,url.split('&city=')[0],'observe',{version:3,tool:'list_jobs',payload:q},{}),{q,url});
 expect(domOnly.observedCity).toBe('广州');
 await p.evaluate(({q,url})=>(window as any).assertSearchCandidate(document,url,q,'j1'),{q,url});
 await p.locator('.city-label').evaluate(e=>e.remove());
 const observed=await p.evaluate(({q,url})=>(window as any).searchAction(document,url,'observe',{version:3,tool:'list_jobs',payload:q},{}),{q,url});
 expect(observed.observedCity).toBe('city-code:101280100');expect(observed.filterEvidence.city).toBe('city-code:101280100');
 await p.evaluate(()=>document.body.insertAdjacentHTML('beforeend','<span class="city-label">深圳</span>'));
 const stale=await p.evaluate(({q,url})=>(window as any).searchAction(document,url,'observe',{version:3,tool:'list_jobs',payload:q},{}),{q,url});
 expect(stale.observedCity).toBe('city-code:101280100');
 }finally{await b.close();}
});
