import {it,expect} from 'vitest';
import {chromium} from 'playwright';
import {readFileSync} from 'node:fs';
const scripts=()=>['selectors','search-actions'].map(f=>readFileSync(`extensions/boss-page/${f}.js`,'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export ','')).join('\n');
it('reports a disappeared job without clicking a replacement at either prepare or perform',async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});try{const p=await b.newPage();
 await p.setContent('<main><div class="job-card-box"><a class="job-name" href="/job_detail/b.html">AI</a><span class="company-name">乙</span></div></main>');
 await p.addScriptTag({content:scripts()+';window.searchAction=searchAction;'});
 const r=await p.evaluate(async()=>{const f=(window as any).searchAction,c={tool:'open_job',payload:{jobKey:'a'}};let clicks=0;document.querySelector('main')!.onclick=()=>clicks++;
  const missing=await f(document,location.href,'prepare',c,{});await f(document,location.href,'perform',c,missing);const first=await f(document,location.href,'observe',c,missing);
  document.querySelector('a')!.setAttribute('href','/job_detail/a.html');const before=await f(document,location.href,'prepare',c,{});
  await f(document,location.href,'perform',c,before,async()=>{document.querySelector('a')!.setAttribute('href','/job_detail/b.html');});
  const second=await f(document,location.href,'observe',c,before);return {first,second,clicks};
 });expect(r.first).toMatchObject({status:'unavailable',reason:'JOB_NOT_VISIBLE'});expect(r.second).toMatchObject({status:'unavailable',reason:'JOB_NOT_VISIBLE'});expect(r.clicks).toBe(0);
 }finally{await b.close();}
});
it('accepts an expanded detail title when the stable job key proves the clicked card',async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});try{const p=await b.newPage();
 await p.setContent('<div class="job-card-box"><a class="job-name" href="/job_detail/a.html">AI应用开发工程师</a><span class="company-name">品阔</span></div><div class="job-detail-box"><span class="job-name">AI应用开发工程师（驻马来西亚）</span><a href="/job_detail/a.html">查看完整职位</a></div>');
 await p.addScriptTag({content:scripts()+';window.detailView=detailView;'});
 const read=()=>p.evaluate(()=>(window as any).detailView(document,{key:'a',title:'AI应用开发工程师',company:'品阔'}));
 expect((await read()).key).toBe('a');
 await p.locator('.job-detail-box a').evaluate(e=>e.setAttribute('href','/job_detail/b.html'));
 await expect(read()).rejects.toThrow('DETAIL_JOB_KEY_MISMATCH');
 }finally{await b.close();}
});
it('identifies the visible headhunter badge and waits for stale detail only during observation',async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});try{const p=await b.newPage();await p.setContent('<div class="job-card-box"><span>猎头</span><a class="job-name" href="/job_detail/new.html">AI</a><span class="company-name">甲</span></div><div class="job-detail-box" data-job-id="old"><h2>旧职位</h2><span class="company-name">乙</span></div>');await p.addScriptTag({content:scripts()+';window.serialJobs=serialJobs;window.searchAction=searchAction;'});
 expect(await p.evaluate(()=>(window as any).serialJobs(document)[0].unsupportedChat)).toBe(true);
 await expect(p.evaluate(()=>(window as any).searchAction(document,location.href,'observe',{tool:'open_job',payload:{}},{job:{key:'new',title:'AI',company:'甲'}}))).rejects.toThrow('DETAIL_NOT_READY');
 }finally{await b.close();}
});
it('reuses the already matching search instead of refreshing and reading stale cards',async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});try{const p=await b.newPage();await p.setContent('<span class="city-label">深圳</span><input placeholder="搜索职位" value="AI应用开发工程师"><button class="search-btn">搜索</button>');await p.addScriptTag({content:scripts()+';window.searchAction=searchAction;window.clicks=0;document.querySelector("button").onclick=()=>window.clicks++;'});
 const n=await p.evaluate(async()=>{const f=(window as any).searchAction,url='https://www.zhipin.com/web/geek/jobs?query=AI应用开发工程师',c={tool:'search_jobs',payload:{}};const s=await f(document,url,'prepare',c,{});await f(document,url,'perform',c,s);return (window as any).clicks;});expect(n).toBe(0);
 }finally{await b.close();}
});
it('treats an unloaded jobs search box as pending but rejects competing boxes',async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});try{const p=await b.newPage();await p.setContent('<main></main>');await p.addScriptTag({content:scripts()+';window.searchView=searchView;'});
 const read=()=>p.evaluate(()=>(window as any).searchView(document,'https://www.zhipin.com/web/geek/jobs'));
 await expect(read()).rejects.toThrow('SEARCH_NOT_READY');
 await p.locator('main').evaluate(e=>e.innerHTML='<input placeholder="搜索职位">');await expect(read()).rejects.toThrow('CITY_NOT_READY');
 await p.locator('main').evaluate(e=>e.innerHTML='<input placeholder="搜索职位"><input placeholder="搜索职位">');await expect(read()).rejects.toThrow('SEARCH_BOX_AMBIGUOUS');
 }finally{await b.close();}
});
it('waits for default city during return observation while prepare still rejects wrong city',async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});try{const p=await b.newPage();await p.setContent('<span class="city-label">全国</span><input placeholder="搜索职位">');await p.addScriptTag({content:scripts()+';window.searchAction=searchAction;'});
 const act=(stage:string)=>p.evaluate(s=>(window as any).searchAction(document,'https://www.zhipin.com/web/geek/jobs',s,{tool:'restore_search',payload:{}},{returnToJobs:true}),stage);
 await expect(act('observe')).rejects.toThrow('CITY_NOT_READY');await expect(act('prepare')).rejects.toThrow('CITY_MISMATCH');
 }finally{await b.close();}
});
it('binds nested live-layout details to the matching card via the detail job link, even for duplicate titles',async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});try{const p=await b.newPage();
 await p.setContent('<li class="job-card-box"><a class="job-name" href="/job_detail/a.html">AI</a><div class="job-card-footer"><a class="boss-info"><span class="boss-name">公司甲</span></a></div></li><li class="job-card-box"><a class="job-name" href="/job_detail/b.html">AI</a><div class="job-card-footer"><a class="boss-info"><span class="boss-name">公司乙</span></a></div></li><div class="job-detail-container"><div class="job-detail-box"><span class="job-name">AI</span><div class="job-boss-info"><h2 class="name">姚女士<i></i><span class="boss-active-time">刚刚活跃</span></h2></div><a class="more-job-btn" href="/job_detail/a.html">查看完整职位</a></div></div>');
 await p.addScriptTag({content:scripts()+';window.detailView=detailView;window.serialJobs=serialJobs;'});
 const jobs=await p.evaluate(()=>(window as any).serialJobs(document));expect(jobs[0].company).toBe('公司甲');
 const read=(job:any)=>p.evaluate(j=>(window as any).detailView(document,j),job);
 expect((await read(jobs[0])).company).toBe('公司甲');
 expect((await read(jobs[0])).recruiter).toBe('姚女士');
 await expect(read(jobs[1])).rejects.toThrow('DETAIL_JOB_KEY_MISMATCH');
 await p.locator('.job-card-footer .boss-name').first().evaluate(e=>e.textContent='已变更公司');
 await expect(read(jobs[0])).rejects.toThrow('DETAIL_COMPANY_UNPROVEN');
 await p.locator('.job-card-footer .boss-name').first().evaluate(e=>e.textContent='');
 await expect(read({...jobs[0],company:''})).rejects.toThrow('DETAIL_COMPANY_UNPROVEN');
 }finally{await b.close();}
});
it('waits for missing detail, collapses nested detail roots, but refuses separate competing details',async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});try{const p=await b.newPage();
 await p.setContent('<main></main>');await p.addScriptTag({content:scripts()+';window.detailView=detailView;'});
 const read=()=>p.evaluate(()=>(window as any).detailView(document,{key:'a',title:'AI',company:'甲'}));
 await expect(read()).rejects.toThrow('DETAIL_NOT_READY');
 await p.locator('main').evaluate(e=>e.innerHTML='<div class="job-detail-container"><div class="job-detail-box" data-job-id="a"><h2>AI</h2><span class="company-name">甲</span></div></div>');
 expect((await read()).key).toBe('a');
 await p.locator('main').evaluate(e=>e.insertAdjacentHTML('beforeend','<div class="job-detail-box" data-job-id="b"><h2>AI</h2></div>'));
 await expect(read()).rejects.toThrow('DETAIL_AMBIGUOUS');
 }finally{await b.close();}
});
it('searches through the controlled input and proves keyword/city before reading stable jobs',async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});try{
 const p=await b.newPage();await p.setContent(`<span class="city-label">深圳</span><input placeholder="搜索职位、公司"><button class="search-btn">搜索</button><div class="job-card-wrapper"><a class="job-name" href="https://www.zhipin.com/job_detail/j1.html">AI应用开发工程师</a><span class="company-name">公司甲</span></div><div class="job-detail-box" style="display:none"><h2 class="job-name">AI应用开发工程师</h2><span class="company-name">公司甲</span></div><script>window.q='';document.querySelector('input').addEventListener('input',e=>window.q=e.target.value);document.querySelector('.search-btn').onclick=()=>window.searched=window.q;document.querySelector('.job-card-wrapper').onclick=e=>{e.preventDefault();document.querySelector('.job-detail-box').style.display='block'};</script>`);
 await p.locator('.job-detail-box').evaluate(e=>e.setAttribute('data-job-id','j1'));
 await p.addScriptTag({content:scripts()+';window.searchAction=searchAction;'});
 const result=await p.evaluate(async()=>{const f=(window as any).searchAction;const c={tool:'search_jobs',payload:{city:'深圳',keyword:'AI应用开发工程师'}};const s=await f(document,'https://www.zhipin.com/web/geek/jobs','prepare',c,{});await f(document,'https://www.zhipin.com/web/geek/jobs','perform',c,s);return {searched:(window as any).searched,view:await f(document,'https://www.zhipin.com/web/geek/jobs?query=AI应用开发工程师&city=101280600','observe',c,s)};});
 expect(result.searched).toBe('AI应用开发工程师');expect(result.view.jobs[0].key).toBe('j1');
 const detail=await p.evaluate(async()=>{const f=(window as any).searchAction,c={tool:'open_job',payload:{jobKey:'j1'}};const s=await f(document,location.href,'prepare',c,{});await f(document,location.href,'perform',c,s);return f(document,location.href,'observe',c,s);});expect(detail.key).toBe('j1');expect(detail.company).toBe('公司甲');
 await p.locator('.city-label').evaluate(e=>e.textContent='北京');
 await expect(p.evaluate(()=>(window as any).searchAction(document,'https://www.zhipin.com/web/geek/jobs','prepare',{tool:'search_jobs',payload:{}},{}))).rejects.toThrow('CITY_MISMATCH');
 }finally{await b.close();}
});
it('rejects stale same-title detail belonging to another stable job key',async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});try{const p=await b.newPage();
 await p.setContent('<div class="job-card-wrapper"><a class="job-name" href="https://www.zhipin.com/job_detail/new.html">AI</a><span class="company-name">甲</span></div><div class="job-detail-box" data-job-id="old"><h2>AI</h2><span class="company-name">甲</span></div>');
 await p.addScriptTag({content:scripts()+';window.detailView=detailView;'});
 await expect(p.evaluate(()=>(window as any).detailView(document,{key:'new',title:'AI',company:'甲'}))).rejects.toThrow('DETAIL_JOB_KEY');
 }finally{await b.close();}
});
it('waits for a delayed next page and restores an intact list without searching again',async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});try{const p=await b.newPage();
 await p.setContent('<span class="city-label">深圳</span><input placeholder="搜索职位、公司" value="AI应用开发工程师"><button class="search-btn">搜索</button><div class="job-card-wrapper"><a class="job-name" href="https://www.zhipin.com/job_detail/a.html">AI</a><span class="company-name">甲</span></div><button id="next">下一页</button><script>window.searches=0;document.querySelector(".search-btn").onclick=()=>window.searches++;document.querySelector("#next").onclick=()=>setTimeout(()=>document.querySelector(".job-name").href="https://www.zhipin.com/job_detail/b.html",500)</script>');
 await p.addScriptTag({content:scripts()+';window.searchAction=searchAction;'});
 const r=await p.evaluate(async()=>{const f=(window as any).searchAction,u='https://www.zhipin.com/web/geek/jobs?query=AI应用开发工程师&city=101280600',c={tool:'list_jobs',payload:{advance:true}};const s=await f(document,u,'prepare',c,{});await f(document,u,'perform',c,s);let error='';try{await f(document,u,'observe',c,s);}catch(e){error=(e as Error).message;}await new Promise(r=>setTimeout(r,600));const v=await f(document,u,'observe',c,s);const restore={tool:'restore_search',payload:{}};const rs=await f(document,u,'prepare',restore,{});await f(document,u,'perform',restore,rs);return {error,key:v.jobs[0].key,searches:(window as any).searches};});
 expect(r.error).toBe('LIST_NOT_ADVANCED');expect(r.key).toBe('b');expect(r.searches).toBe(0);
 }finally{await b.close();}
});
