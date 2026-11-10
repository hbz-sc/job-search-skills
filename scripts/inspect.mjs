// Read-only DOM diagnostics for the project's dedicated browser. Never sends a message.
import {loadConfig} from '../dist/src/config.js';
import {launchBossPages} from '../dist/src/browser/session.js';
import {mkdir,writeFile} from 'node:fs/promises';
import {acquireRunLock} from '../dist/src/run-lock.js';
const c=loadConfig({keywords:['AI 应用开发工程师']},process.cwd());
const unlock=await acquireRunLock('private/boss-run.lock');
let pages;
try{
 pages=await launchBossPages(c);const page=pages.context.pages().find(p=>p.url().includes('zhipin.com'));
 await page.waitForLoadState('domcontentloaded');
 await page.locator('body').waitFor();
 await page.waitForFunction(()=>document.body.innerText.trim().length>30,{},{timeout:15000}).catch(()=>{});
 await mkdir('output/boss',{recursive:true});
 await page.screenshot({path:'output/boss/inspect.png'});
 const snapshot=await page.evaluate(()=>({url:location.href,text:document.body.innerText,elements:Array.from(document.querySelectorAll('a,input,button,[class*="user"],[class*="city"],[class*="search"],[class*="job-card"]')).filter(e=>e.getClientRects().length).map(e=>({tag:e.tagName,cls:e.className,text:e.textContent?.trim().slice(0,180),href:e.tagName==='A'?e.getAttribute('href'):undefined,placeholder:e.getAttribute('placeholder'),data:Object.fromEntries(Array.from(e.attributes).filter(a=>a.name.startsWith('data-')).map(a=>[a.name,a.value]))})).slice(0,150)}));
 await writeFile('output/boss/inspect.json',JSON.stringify(snapshot,null,2),'utf8');
 console.log(JSON.stringify({url:page.url(),state:await pages.state(),account:await pages.account(),text:snapshot.text.slice(0,2000)}));
}finally{await pages?.close();await unlock();}
