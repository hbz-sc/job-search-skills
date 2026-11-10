import {test,expect} from 'vitest';import {chromium} from 'playwright';import {readFileSync} from 'node:fs';
const source=()=>['selectors','experience-dom','search-filters','search-actions'].map(f=>readFileSync(`extensions/boss-page/${f}.js`,'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export ','')).join('\n');
test('observed active options and matching count certify a collapsed live filter, never a count alone',async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});try{const p=await b.newPage();await p.setContent('<span class="city-label">深圳</span><input placeholder="搜索职位" value="Java开发工程师"><div class="condition-filter-select is-select"><div class="current-select"><span class="placeholder-text">工作经验</span><em class="select-num">1</em></div><div class="filter-select-dropdown" style="visibility:hidden"><ul><li class="active">1-3年<i class="ui-icon-check"></i></li><li>3-5年<i class="ui-icon-check"></i></li></ul></div></div><div class="job-card-box"><a class="job-name" href="/job_detail/j1.html">Java</a><span class="company-name">甲</span><li>1-3年</li></div>');await p.addScriptTag({content:source()+';window.readSearchFilters=readSearchFilters;window.searchViewV3=searchViewV3;'});
 const read=()=>p.evaluate(()=>(window as any).readSearchFilters(document));
 expect((await read()).experience).toBe('exp_1_3');
 await expect(p.evaluate(()=>(window as any).searchViewV3(document,'https://www.zhipin.com/web/geek/jobs?query=Java开发工程师',{city:'深圳',keyword:'Java开发工程师',experience:'exp_1_3'}))).rejects.toThrow('MANUAL_EXPERIENCE_REQUIRED');
 await p.locator('.filter-select-dropdown li').last().evaluate(e=>e.classList.add('active'));expect((await read()).experience).toBe(null);
 await p.locator('.select-num').evaluate(e=>e.textContent='2');expect((await read()).experience).toBe(null);
 await p.locator('.filter-select-dropdown li').first().evaluate(e=>e.classList.remove('active'));await p.locator('.select-num').evaluate(e=>e.textContent='1');expect((await read()).experience).toBe('exp_3_5');
 await p.locator('.filter-select-dropdown li').last().evaluate(e=>e.classList.remove('active'));expect((await read()).experience).toBe(null);
 }finally{await b.close();}
});
test('real experience option markup with a child check icon remains clickable',async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});try{const p=await b.newPage();await p.setContent('<span class="city-label">深圳</span><input placeholder="搜索职位" value="Java开发工程师"><div class="condition-filter-select"><div class="current-select"><span>工作经验</span></div><div class="filter-select-dropdown"><ul><li>1-3年<i class="ui-icon-check"></i></li><li>3-5年<i class="ui-icon-check"></i></li></ul></div></div><script>document.querySelectorAll("li").forEach(e=>e.onclick=()=>document.querySelector(".current-select span").textContent=e.textContent);</script>');await p.addScriptTag({content:source()+';window.setSearchFilters=setSearchFilters;window.readSearchFilters=readSearchFilters;'});
 await p.evaluate(async()=>{await (window as any).setSearchFilters(document,{keyword:'Java开发工程师',city:'深圳',experience:'exp_1_3'});});expect((await p.evaluate(()=>(window as any).readSearchFilters(document))).experience).toBe('exp_1_3');
 }finally{await b.close();}
});
test('experience is set from the visible control and verified against current results; hidden duplicates do not count',async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});try{const page=await browser.newPage();await page.setContent(readFileSync('tests/fixtures/boss-search-filters.html','utf8'));await page.addScriptTag({content:source()+';window.readSearchFilters=readSearchFilters;window.setSearchFilters=setSearchFilters;window.searchViewV3=searchViewV3;'});
 const q={city:'深圳',keyword:'Java开发工程师',experience:'exp_1_3'};const view=()=>page.evaluate(q=>(window as any).searchViewV3(document,'https://www.zhipin.com/web/geek/jobs?query=Java开发工程师',q),q);
 await expect(view()).rejects.toThrow('FILTER_UNVERIFIED');
 await page.evaluate(async q=>{await (window as any).setSearchFilters(document,q,async()=>{});},q);expect((await view()).observedExperience).toBe('exp_1_3');
 await page.locator('body').evaluate(e=>e.insertAdjacentHTML('beforeend','<div style="display:none"><div class="current-select">3-5年</div></div>'));expect((await view()).observedExperience).toBe('exp_1_3');
 await page.evaluate(async q=>{await (window as any).setSearchFilters(document,{...q,experience:'exp_3_5'},async()=>{});},q);
 await expect(view()).rejects.toThrow('FILTER_UNVERIFIED');
 const second=await page.evaluate(q=>(window as any).searchViewV3(document,'https://www.zhipin.com/web/geek/jobs?query=Java开发工程师',{...q,experience:'exp_3_5'}),q);expect(second.observedExperience).toBe('exp_3_5');
 await page.locator('.job-card-box li').first().evaluate(e=>e.textContent='1-3年');await expect(page.evaluate(q=>(window as any).searchViewV3(document,'https://www.zhipin.com/web/geek/jobs?query=Java开发工程师',{...q,experience:'exp_3_5'}),q)).rejects.toThrow('RESULTS_NOT_READY');
 }finally{await browser.close();}
});

test('switching keyword cannot accept an unchanged empty result from the old query',async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});try{const p=await b.newPage();await p.setContent('<span class="city-label">深圳</span><input placeholder="搜索职位" value="Java开发工程师"><div class="current-select">1-3年</div><div class="search-empty">暂无结果</div>');await p.addScriptTag({content:source()+';window.searchAction=searchAction;'});
 await expect(p.evaluate(()=>(window as any).searchAction(document,'https://www.zhipin.com/web/geek/jobs?query=Java开发工程师','observe',{version:3,tool:'search_jobs',payload:{city:'深圳',keyword:'Java开发工程师',experience:'exp_1_3'}},{needKeyword:true,before:[]}))).rejects.toThrow('RESULTS_NOT_READY');
 }finally{await b.close();}
});

test.each(['experience-empty','reordered-keys'])('query transition requires new result evidence: %s',async variant=>{
 const b=await chromium.launch({channel:'msedge',headless:true});try{const p=await b.newPage();const cards=variant==='experience-empty'?'<div class="search-empty">暂无结果</div>':['j1','j2'].map(key=>`<div class="job-card-box"><a class="job-name" href="/job_detail/${key}.html">Java</a><span class="company-name">甲</span><li>3-5年</li></div>`).join('');await p.setContent('<span class="city-label">深圳</span><input placeholder="搜索职位" value="Java开发工程师"><div class="current-select">3-5年</div>'+cards);await p.addScriptTag({content:source()+';window.searchAction=searchAction;'});
 await expect(p.evaluate(before=>(window as any).searchAction(document,'https://www.zhipin.com/web/geek/jobs?query=Java开发工程师','observe',{version:3,tool:'search_jobs',payload:{city:'深圳',keyword:'Java开发工程师',experience:'exp_3_5'}},{queryChanged:true,before}),variant==='experience-empty'?[]:['j2','j1'])).rejects.toThrow('RESULTS_NOT_READY');
 }finally{await b.close();}
});
