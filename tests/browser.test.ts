import {test,expect,beforeAll,afterAll} from 'vitest';
import {chromium,type Browser} from 'playwright';
import {DomBossPages} from '../src/browser/boss-pages.js';
import {fixtureServer} from './fixtures/server.js';
import {listing} from './fixtures/pages.js';
let browser:Browser;
beforeAll(async()=>{browser=await chromium.launch({channel:'msedge',headless:true});});
afterAll(async()=>{await browser?.close();});
test('reads stable jobs, missing fields, reordered cards without communicating',async()=>{
 const srv=await fixtureServer(listing);const ctx=await browser.newContext();const page=await ctx.newPage();await page.goto(srv.url);
 const p=new DomBossPages(ctx,page,{baseUrl:srv.url,timeout:1000});
 try {
  expect((await p.account())?.key).toBe('account-1');
  const jobs=await p.visibleJobs();expect(jobs.map(j=>j.key)).toEqual(['one','two']);expect(jobs[1].salary).toBeUndefined();
  expect(await page.evaluate('window.opens||0')).toBe(0);
  await page.evaluate(()=>document.body.prepend(document.querySelectorAll('.job-card-wrapper')[1]));
  expect((await p.visibleJobs())[0].key).toBe('two');
  await page.locator('.user-name').evaluate(e=>e.removeAttribute('data-user-id'));expect(await p.account()).toBeUndefined();
 }finally{await ctx.close();await srv.close();}
});
test.each([['当日沟通次数已达上限','quota'],['请完成安全验证','verification'],['扫码登录','login']])('recognizes explicit blocker %s',async(text,kind)=>{
 const ctx=await browser.newContext();const page=await ctx.newPage();await page.setContent('<div role="dialog">'+text+'</div>');
 const p=new DomBossPages(ctx,page,{timeout:500});expect((await p.state()).kind).toBe(kind);await ctx.close();
});
