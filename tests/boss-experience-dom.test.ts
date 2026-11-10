import {test,expect} from 'vitest';import {chromium} from 'playwright';import {readFileSync} from 'node:fs';import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';
const {ExperiencePointer}=await import(pathToFileURL(resolve('extensions/boss-page/experience-pointer.js')).href);
const source=()=>['selectors','experience-dom'].map(f=>readFileSync(`extensions/boss-page/${f}.js`,'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export ','')).join('\n')+'\nwindow.experiencePointerView=experiencePointerView;';
const fixture=`<style>.condition-filter-select{position:absolute;left:40px;top:40px;width:160px}.current-select{height:40px;background:#ddd}.filter-select-dropdown{display:none;background:#fff}.condition-filter-select:hover .filter-select-dropdown{display:block}li{height:30px;list-style:none}ul{margin:0;padding:0}</style><div class="city-label">深圳</div><input placeholder="搜索职位" value="Java开发工程师"><div class="condition-filter-select"><div class="current-select">工作经验</div><div class="filter-select-dropdown"><ul><li aria-checked="false">1-3年<i></i></li><li aria-checked="false">3-5年<i></i></li></ul></div></div><script>for(const li of document.querySelectorAll('li'))li.onclick=()=>{li.setAttribute('aria-checked',li.getAttribute('aria-checked')==='true'?'false':'true');const selected=[...document.querySelectorAll('li[aria-checked="true"]')].map(e=>e.textContent);document.querySelector('.current-select').textContent=selected.join('、')||'工作经验';};</script>`;
test.each(['multiple','single','site-count','current-city'])('browser input opens CSS hover and switches both bands: %s',async mode=>{
 const b=await chromium.launch({channel:'msedge',headless:true});try{const p=await b.newPage();await p.setContent(fixture);
 if(mode==='single')await p.evaluate(()=>{for(const li of document.querySelectorAll('li'))li.onclick=()=>{for(const peer of document.querySelectorAll('li'))peer.setAttribute('aria-checked','false');li.setAttribute('aria-checked','true');document.querySelector('.current-select')!.textContent=li.textContent;};});
 if(mode==='site-count')await p.evaluate(()=>{for(const li of document.querySelectorAll('li')){li.removeAttribute('aria-checked');li.onclick=()=>{li.classList.toggle('active');const root=document.querySelector('.condition-filter-select')!,count=root.querySelectorAll('li.active').length;root.classList.toggle('is-select',count>0);root.querySelector('.current-select')!.innerHTML='<span class="placeholder-text">工作经验</span>'+(count?'<em class="select-num">'+count+'</em>':'');};}});
 if(mode==='current-city')await p.locator('.city-label').evaluate(e=>e.textContent='广州');
 await p.addScriptTag({content:source()});let session:any;const api={permissions:{contains:async()=>true},debugger:{attach:async()=>{session=await p.context().newCDPSession(p);},detach:async()=>{await session.detach();},sendCommand:async(_t:any,m:string,v:any)=>session.send(m,v)}};
 const pointer=new ExperiencePointer(api,{pollMs:20});
 for(const experience of ['exp_1_3','exp_3_5','exp_1_3']){
  const q={city:mode==='current-city'?'current':'深圳',keyword:'Java开发工程师',experience};const observe=(step:string,label?:string)=>p.evaluate(({q,step,label})=>(window as any).experiencePointerView(document,q,{step,label},async()=>{}),{q,step,label});
  await pointer.select({binding:{tabId:1},deadline:Date.now()+6000,check:async()=>{},observe});expect((await observe('selection')).selection.labels).toEqual([experience==='exp_1_3'?'1-3年':'3-5年']);
 }
 }finally{await b.close();}
});
test('fixed DOM probe rejects duplicate controls, hidden options, and covered points',async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});try{const p=await b.newPage();await p.setContent(fixture);await p.addScriptTag({content:source()});
 const read=(step:string)=>p.evaluate(step=>(window as any).experiencePointerView(document,{city:'深圳',keyword:'Java开发工程师',experience:'exp_1_3'},{step,label:'1-3年'},async()=>{}),step);
 await expect(read('option')).rejects.toThrow('EXPERIENCE_MENU_NOT_OPEN');
 await p.evaluate(()=>document.body.insertAdjacentHTML('beforeend','<div style="position:absolute;left:40px;top:40px;width:160px;height:50px;z-index:100"></div>'));
 await expect(read('control')).rejects.toThrow('EXPERIENCE_TARGET_COVERED');
 await p.evaluate(()=>document.body.append(document.querySelector('.condition-filter-select')!.cloneNode(true)));
 await expect(read('control')).rejects.toThrow('EXPERIENCE_CONTROL_AMBIGUOUS');
 }finally{await b.close();}
});
test('scroll uses fresh coordinates, and an expired login toast blocks filter input',async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});try{const p=await b.newPage();await p.setContent(fixture+'<style>.condition-filter-select{top:1600px}body{height:2100px}</style>');await p.addScriptTag({content:source()});
 const read=(step:string)=>p.evaluate(step=>(window as any).experiencePointerView(document,{city:'深圳',keyword:'Java开发工程师',experience:'exp_1_3'},{step},async()=>{}),step);
 await expect(read('control')).rejects.toThrow('EXPERIENCE_TARGET_OFFSCREEN');await read('scroll');expect((await read('control')).point.y).toBeLessThan(720);
 await p.evaluate(()=>document.body.insertAdjacentHTML('beforeend','<div class="toast" style="position:fixed;top:0">当前登录状态已失效，请重新登录</div>'));await expect(read('control')).rejects.toThrow('LOGIN_REQUIRED');
 }finally{await b.close();}
});
test('a visible dropdown shell with hidden options is not a ready menu',async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});try{const p=await b.newPage();await p.setContent(fixture+'<style>.filter-select-dropdown{display:block}li{visibility:hidden}</style>');await p.addScriptTag({content:source()});
 const state=await p.evaluate(()=>(window as any).experiencePointerView(document,{city:'深圳',keyword:'Java开发工程师',experience:'exp_1_3'},{step:'selection'}));expect(state.menuVisible).toBe(false);
 }finally{await b.close();}
});
