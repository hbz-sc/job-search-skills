import {test,expect} from 'vitest';import {chromium} from 'playwright';import {readFileSync} from 'node:fs';
const source=()=>['selectors','experience-dom','search-filters','search-actions','chat-actions'].map(f=>readFileSync(`extensions/boss-page/${f}.js`,'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export ','')).join('\n')+';Object.assign(window,{searchViewV3,searchAction,chatAction});';
const q={keyword:'Java开发工程师',city:'深圳',experience:'exp_1_3'},url='https://www.zhipin.com/web/geek/jobs?query=Java开发工程师';
const fixture='<span class="city-label">深圳</span><input placeholder="搜索职位" value="Java开发工程师"><div class="condition-filter-select is-select"><div class="current-select">工作经验<em class="select-num">(3)</em></div><div class="filter-select-dropdown" style="visibility:hidden"><ul>'+['1-3年','3-5年','5-10年'].map(t=>`<li class="active">${t}<i></i></li>`).join('')+'</ul></div></div>'+['1-3年','3-5年','5-10年'].map((t,i)=>`<div class="job-card-box"><a class="job-name" href="/job_detail/j${i}.html">Java</a><span class="company-name">甲</span><ul><li>${t}</li></ul></div>`).join('')+'<div class="job-detail-box"><span class="job-name">Java</span><a href="/job_detail/j0.html">详情</a><span class="company-name">甲</span><div class="job-boss-info"><h2 class="name">李</h2></div><a class="op-btn-chat">立即沟通</a></div>';
test('initial search from existing chat prepares a return to jobs without requiring a search input',async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});try{const p=await b.newPage();await p.setContent('<a>职位</a><div class="chat-conversation"></div>');await p.addScriptTag({content:source()});expect(await p.evaluate(q=>(window as any).searchAction(document,'https://www.zhipin.com/web/geek/chat','prepare',{version:3,tool:'search_jobs',payload:q},{}),q)).toEqual({returnToJobs:true});}finally{await b.close();}
});
test.each(['before-prepare','during-authorization'])('missing manual band stops keyword mutation: %s',async when=>{
 const b=await chromium.launch({channel:'msedge',headless:true});try{const p=await b.newPage();await p.setContent(fixture+'<button>搜索</button>');await p.addScriptTag({content:source()});const result=await p.evaluate(async({q,url,when})=>{const w=window as any;let clicks=0;document.querySelector('button')!.onclick=()=>clicks++;const remove=()=>document.querySelector('.filter-select-dropdown li')!.classList.remove('active');if(when==='before-prepare')remove();let error='';try{const c={version:3,tool:'search_jobs',payload:{...q,keyword:'AI应用开发工程师'}};const state=await w.searchAction(document,url,'prepare',c,{});await w.searchAction(document,url,'perform',c,state,async()=>{if(when==='during-authorization')remove();});}catch(e){error=(e as Error).message;}return {error,clicks,value:(document.querySelector('input') as HTMLInputElement).value};},{q,url,when});expect(result).toEqual({error:'MANUAL_EXPERIENCE_REQUIRED',clicks:0,value:q.keyword});}finally{await b.close();}
});
test('manual mixed bands are read without clicking; only the requested band is returned',async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});try{const p=await b.newPage();await p.setContent(fixture);await p.addScriptTag({content:source()});
 const result=await p.evaluate(async({q,url})=>{const w=window as any;let clicks=0;document.querySelector('.condition-filter-select')!.addEventListener('click',()=>clicks++);const c={version:3,tool:'search_jobs',payload:q};const performed=await w.searchAction(document,url,'perform',c,{preserve:false,needKeyword:false});return {clicks,performed,a:w.searchViewV3(document,url,q),b:w.searchViewV3(document,url,{...q,experience:'exp_3_5'})};},{q,url});
 expect(result.clicks).toBe(0);expect(result.performed.requiresPointer).toBeUndefined();expect(result.a.jobs.map((j:any)=>j.key)).toEqual(['j0']);expect(result.b.jobs.map((j:any)=>j.key)).toEqual(['j1']);
 await p.locator('.filter-select-dropdown li').nth(1).evaluate(e=>e.classList.remove('active'));
 await expect(p.evaluate(({q,url})=>(window as any).searchViewV3(document,url,q),{q,url})).rejects.toThrow('MANUAL_EXPERIENCE_REQUIRED');
 }finally{await b.close();}
});
test('manual keyword transition checks unchanged raw keys rather than the filtered subset',async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});try{const p=await b.newPage();await p.setContent(fixture);await p.addScriptTag({content:source()});
 await expect(p.evaluate(({q,url})=>(window as any).searchAction(document,url,'observe',{version:3,tool:'search_jobs',payload:q},{queryChanged:true,before:['j0','j1','j2']}),{q,url})).rejects.toThrow('RESULTS_NOT_READY');
 }finally{await b.close();}
});
test.each(['open_job','open_chat'])('%s rechecks manual candidate experience after authorization',async tool=>{
 const b=await chromium.launch({channel:'msedge',headless:true});try{const p=await b.newPage();await p.setContent(fixture);await p.addScriptTag({content:source()});
 const result=await p.evaluate(async({q,url,tool})=>{const w=window as any,c={version:3,tool,payload:{jobKey:'j0'}};let clicks=0;document.querySelector('.job-card-box')!.addEventListener('click',()=>clicks++);document.querySelector('.op-btn-chat')!.addEventListener('click',()=>clicks++);const fn=tool==='open_job'?w.searchAction:w.chatAction;let error='';try{const state=await fn(document,url,'prepare',c,{query:q,job:{key:'j0',title:'Java',company:'甲'}});await fn(document,url,'perform',c,state,async()=>{document.querySelector('.job-card-box li')!.textContent='5-10年';});}catch(e){error=(e as Error).message;}return {error,clicks};},{q,url,tool});
 expect(result).toEqual({error:'JOB_EXPERIENCE_CHANGED',clicks:0});
 }finally{await b.close();}
});
