import {chromium} from 'playwright';
import type {RunConfig} from '../domain.js';
import {DomBossPages} from './boss-pages.js';
export async function launchBossPages(config:RunConfig){
 const context=await chromium.launchPersistentContext(config.browserDir,{channel:'msedge',headless:false,viewport:null,acceptDownloads:false});
 const page=context.pages().find(p=>p.url().startsWith('https://www.zhipin.com/web/geek/jobs'))??await context.newPage();
 if(!page.url().startsWith('https://www.zhipin.com'))await page.goto('https://www.zhipin.com/web/geek/jobs',{waitUntil:'domcontentloaded'});
 return new DomBossPages(context,page,{timeout:config.actionTimeoutMs});
}
