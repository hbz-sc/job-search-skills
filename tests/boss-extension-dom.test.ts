import {it,expect} from 'vitest';
it('exposes bounded public experience-control structure without unrelated text or values',async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});try{const p=await b.newPage();await p.setContent('<div>PRIVATE_ACCOUNT</div><input value="PRIVATE_VALUE"><div class="experience"><div class="current-select">工作经验</div><div class="options"><label class="selected" aria-checked="true"><span>1-3年</span></label><label><span>3-5年</span></label></div></div>');await p.addScriptTag({content:readFileSync('extensions/boss-page/dom-adapter.js','utf8').replaceAll('export ','')+';window.inspectBoss=inspectBoss;'});const r=await p.evaluate(()=>(window as any).inspectBoss(document,'https://www.zhipin.com/web/geek/jobs'));expect(r.experienceProbe).toHaveLength(1);expect(JSON.stringify(r.experienceProbe)).toContain('1-3年');expect(JSON.stringify(r.experienceProbe)).toContain('selected');expect(JSON.stringify(r.experienceProbe)).not.toContain('PRIVATE');}finally{await b.close();}
});
it('visible login and verification toasts block readiness even while the search box remains',async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});try{const p=await browser.newPage();await p.addScriptTag({content:readFileSync('extensions/boss-page/dom-adapter.js','utf8').replaceAll('export ','')+';window.inspectBoss=inspectBoss;'});
 for(const [message,kind] of [['当前登录状态已失效，请重新登录','login'],['请完成验证码验证','verification']]){await p.evaluate(message=>{document.body.innerHTML='<input placeholder="搜索职位"><div role="alert" class="toast"></div>';document.querySelector('.toast')!.textContent=message;},message);const r=await p.evaluate(()=>(window as any).inspectBoss(document,'https://www.zhipin.com/web/geek/jobs'));expect(r.searchBox.count).toBe(1);expect(r.blockers).toContain(kind);}
 }finally{await browser.close();}
});
import {chromium} from 'playwright';
import {readFileSync} from 'node:fs';
it('reports fixed filter styles and page visibility without arbitrary CSS or attributes',async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});try{const p=await b.newPage();await p.setContent('<div class="condition-filter-select"><div class="current-select">工作经验</div><div class="filter-select-dropdown"><ul><li style="visibility:hidden;background-image:url(SECRET)">1-3年<i></i></li></ul></div></div>');await p.addScriptTag({content:readFileSync('extensions/boss-page/dom-adapter.js','utf8').replaceAll('export ','')+';window.inspectBoss=inspectBoss;'});
 const r=await p.evaluate(()=>(window as any).inspectBoss(document,'https://www.zhipin.com/web/geek/jobs'));const option=r.experienceProbe[0].ancestors[0].nodes.find((n:any)=>n.label==='1-3年');expect(option.style.visibility).toBe('hidden');expect(r.viewState.visibility).toBe('visible');expect(JSON.stringify(r)).not.toContain('SECRET');
 }finally{await b.close();}
});
import {fixtureServer} from './fixtures/server.js';
it('reports only bounded public detail identity to diagnose readiness failures',async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});try{const p=await b.newPage();
 await p.setContent('<div class="job-detail-box"><span class="job-name">AI（急招）</span><span class="company-name">甲</span><p>PRIVATE_DESCRIPTION</p><a href="/job_detail/a.html?token=SECRET">详情</a></div>');
 await p.addScriptTag({content:readFileSync('extensions/boss-page/dom-adapter.js','utf8').replaceAll('export ','')+';window.inspectBoss=inspectBoss;'});
 const r=await p.evaluate(()=>(window as any).inspectBoss(document,'https://www.zhipin.com/web/geek/jobs'));
 expect(r.detailProbe).toEqual([{titles:['AI（急招）'],companies:['甲'],jobKeys:['a']}]);
 expect(JSON.stringify(r)).not.toContain('SECRET');expect(JSON.stringify(r)).not.toContain('PRIVATE_DESCRIPTION');
 }finally{await b.close();}
});
it('reports bounded visible notices on the jobs page without reading chats or hidden dialogs',async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});try{const p=await b.newPage();
 await p.setContent('<div class="boss-dialog"><p>今日沟通人数已达上限</p></div><div class="toast-box">操作频繁，请稍后再试</div><div class="dialog" style="display:none">HIDDEN</div><div class="chat">PRIVATE_CHAT</div>');
 await p.addScriptTag({content:readFileSync('extensions/boss-page/dom-adapter.js','utf8').replaceAll('export ','')+';window.inspectBoss=inspectBoss;'});
 const r=await p.evaluate(()=>(window as any).inspectBoss(document,'https://www.zhipin.com/web/geek/jobs'));
 expect(r.noticeProbe.map((n:any)=>n.text)).toEqual(['今日沟通人数已达上限','操作频繁，请稍后再试']);
 expect(JSON.stringify(r)).not.toContain('HIDDEN');expect(JSON.stringify(r)).not.toContain('PRIVATE_CHAT');
 const chat=await p.evaluate(()=>(window as any).inspectBoss(document,'https://www.zhipin.com/web/geek/chat'));expect(chat.noticeProbe).toBeUndefined();
 }finally{await b.close();}
});
it('reports bounded job layout metadata without copying page text, links or private attributes',async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage();await page.setContent('<div class="detail-layout" data-token="SECRET"><div class="detail-header"><h3>职位描述</h3><a href="/chat?token=SECRET">立即沟通</a></div><p>PRIVATE_DESCRIPTION</p></div><div style="display:none"><h3>职位描述</h3></div>');
 await page.addScriptTag({content:readFileSync('extensions/boss-page/dom-adapter.js','utf8').replaceAll('export ','')+';window.inspectBoss=inspectBoss;'});
 const result=await page.evaluate(()=>(window as any).inspectBoss(document,'https://www.zhipin.com/web/geek/jobs'));
 expect(result.layoutProbe.anchors).toHaveLength(2);
 expect(result.layoutProbe.anchors[0].ancestors.some((n:any)=>n.classes.includes('detail-layout'))).toBe(true);
 await page.locator('body').evaluate(e=>e.insertAdjacentHTML('beforeend','<div class="job-detail-box"><div class="job-header-info"><h2 class="title">AI</h2></div><a href="https://www.zhipin.com/job_detail/abc.html?token=SECRET">更多</a></div>'));
 const enriched=await page.evaluate(()=>(window as any).inspectBoss(document,'https://www.zhipin.com/web/geek/jobs'));
 expect(enriched.layoutProbe.regions[0].nodes.some((n:any)=>n.classes.includes('job-header-info'))).toBe(true);
 expect(enriched.layoutProbe.regions[0].nodes.some((n:any)=>n.jobKey==='abc')).toBe(true);
 expect(JSON.stringify(enriched)).not.toContain('SECRET');
 expect(JSON.stringify(result)).not.toContain('SECRET');expect(JSON.stringify(result)).not.toContain('PRIVATE_DESCRIPTION');
 const chat=await page.evaluate(()=>(window as any).inspectBoss(document,'https://www.zhipin.com/web/geek/chat'));
 expect(chat.layoutProbe).toBeUndefined();
 }finally{await browser.close();}
});
it('inspects chat controls and editor structure without returning conversation content',async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});try{const p=await b.newPage();
 await p.setContent('<div class="chat-shell"><div class="top-info-content"><span class="recruiter-label">姚女士</span><span class="job-label">AI应用开发工程师</span></div><div class="message-content"><div class="own-message">PRIVATE_CHAT</div></div><div class="editor-area"><div class="chat-controls"><button title="常用语"></button><ul><li class="saved-phrase">PRIVATE_PHRASE</li></ul></div><div contenteditable="true">PRIVATE_DRAFT</div><button>发送</button></div></div>');
 await p.addScriptTag({content:readFileSync('extensions/boss-page/dom-adapter.js','utf8').replaceAll('export ','')+';window.inspectBoss=inspectBoss;'});
 const r=await p.evaluate(()=>(window as any).inspectBoss(document,'https://www.zhipin.com/web/geek/chat'));
 expect(r.chatLayoutProbe.anchors.some((a:any)=>a.label==='常用语')).toBe(true);
 expect(r.chatLayoutProbe.editors).toHaveLength(1);
 expect(r.chatLayoutProbe.headerNodes.some((n:any)=>n.text==='姚女士')).toBe(true);
 expect(r.chatLayoutProbe.controlsNodes.some((n:any)=>n.classes.includes('saved-phrase'))).toBe(true);
 expect(r.chatLayoutProbe.messageNodes.some((n:any)=>n.classes.includes('own-message'))).toBe(true);
 for(const s of ['PRIVATE_CHAT','PRIVATE_DRAFT','PRIVATE_PHRASE'])expect(JSON.stringify(r)).not.toContain(s);
 }finally{await b.close();}
});
it('reads minimal job regions without exposing chat bodies or navigating; cannot use a name as account ID',async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
 const page=await browser.newPage();
 await page.setContent('<input placeholder="搜索职位、公司"><span>示例用户</span><div class="job-card-wrapper"><a class="job-name" href="https://www.zhipin.com/job_detail/abc.html">AI应用开发工程师</a><div class="job-card-footer"><a class="boss-info"><span class="boss-name">测试公司</span></a></div></div><div class="chat">PRIVATE_CHAT</div>');
 await page.addScriptTag({content:readFileSync('extensions/boss-page/dom-adapter.js','utf8').replaceAll('export ','')+';window.inspectBoss=inspectBoss;'});
 const result=await page.evaluate(()=> (window as any).inspectBoss(document,'https://www.zhipin.com/web/geek/jobs'));
 expect(result.searchBox.count).toBe(1);expect(result.jobs[0].key).toBe('abc');
 expect(result.jobs[0].company).toBe('测试公司');
 expect(result.identityCapability).toBe('unavailable');expect(result.writeEnabled).toBe(false);
 expect(JSON.stringify(result)).not.toContain('PRIVATE_CHAT');expect(page.url()).toBe('about:blank');
 await page.setContent('<input placeholder="搜索职位、公司"><input placeholder="搜索职位、公司">');
 expect((await page.evaluate(()=> (window as any).inspectBoss(document,'https://www.zhipin.com/web/geek/jobs'))).searchBox.count).toBe(2);
 }finally{await browser.close();}
});
it('does not collect account identifiers or names in current-page mode',async()=>{
 const srv=await fixtureServer('<div class="nav-figure"><a class="user-name" data-user-id="account-private-123" data-token="SECRET">同名用户</a><a href="/web/geek/resume?token=SECRET">简历</a></div><div style="display:none" class="user-info" data-account-id="HIDDEN"></div><div class="job-card-wrapper" data-user-id="RECRUITER"></div>');
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage();await page.goto(srv.url);
  await page.addScriptTag({content:readFileSync('extensions/boss-page/dom-adapter.js','utf8').replaceAll('export ','')+';window.inspectBoss=inspectBoss;'});
  const result=await page.evaluate(()=> (window as any).inspectBoss(document,'https://www.zhipin.com/web/geek/jobs'));
  expect(result.accountProbe).toBeUndefined();
  for(const secret of ['account-private-123','SECRET','HIDDEN','RECRUITER','同名用户'])expect(JSON.stringify(result)).not.toContain(secret);
  expect(result.identityCapability).toBe('unavailable');
 }finally{await browser.close();await srv.close();}
});
