import {loadConfig} from '../dist/src/config.js';
import {launchBossPages} from '../dist/src/browser/session.js';
import {acquireRunLock} from '../dist/src/run-lock.js';
import {mkdir,writeFile} from 'node:fs/promises';
const c=loadConfig({keywords:['AI 应用开发工程师']},process.cwd());
const unlock=await acquireRunLock('private/boss-run.lock');let pages;
try{
 pages=await launchBossPages(c);const page=pages.context.pages().find(p=>p.url().includes('zhipin.com'));
 console.log('请在新开的专用 Edge 登录。此程序只读取页面，不发送消息。');
 await mkdir('output/boss',{recursive:true});
 for(let i=0;i<300;i++){
  if(page.isClosed())break;
  const text=await page.locator('body').innerText().catch(()=>'');
  if(text.includes('消息')&&text.includes('简历')&&!text.includes('登录/注册')){
   await page.screenshot({path:'output/boss/logged-in.png'});
   const snapshot=await page.evaluate(()=>({url:location.href,text:document.body.innerText,elements:Array.from(document.querySelectorAll('a,input,button,[class*="user"],[class*="nav"],[class*="city"],[class*="search"],[class*="job-card"]')).filter(e=>e.getClientRects().length).map(e=>({tag:e.tagName,cls:e.className,text:e.textContent?.trim().slice(0,120),href:e.tagName==='A'?e.getAttribute('href'):undefined,placeholder:e.getAttribute('placeholder'),data:Object.fromEntries(Array.from(e.attributes).filter(a=>a.name.startsWith('data-')).map(a=>[a.name,a.value])),html:e.className.toString().includes('user')?e.outerHTML.slice(0,2500):undefined})).slice(0,200)}));
   await writeFile('output/boss/logged-in.json',JSON.stringify(snapshot,null,2),'utf8');console.log('已观察到登录后的消息/简历导航，已保存只读页面结构。窗口将关闭以便程序下一步复用登录。');break;
  }
  await new Promise(r=>setTimeout(r,2000));
 }
}finally{await pages?.close();await unlock();}
