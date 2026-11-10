import {test,expect,beforeAll,afterAll} from 'vitest';
import {chromium,type Browser} from 'playwright';
import {DomBossPages} from '../src/browser/boss-pages.js';
import {fixtureServer} from './fixtures/server.js';
import {chatPage} from './fixtures/pages.js';
import {greetOne,reconcile} from '../src/greeting.js';
import {openStore} from '../src/storage/store.js';
import {loadConfig} from '../src/config.js';
import {template} from '../src/domain.js';
let browser:Browser;
beforeAll(async()=>{browser=await chromium.launch({channel:'msedge',headless:true});});afterAll(async()=>{await browser?.close();});
const account={key:'account-1',displayName:'求职者'},t=template('你好，想了解这个岗位。');
async function setup(mode:Parameters<typeof chatPage>[0]){
 const srv=await fixtureServer(chatPage(mode));const ctx=await browser.newContext();const page=await ctx.newPage();await page.goto(srv.url);
 const pages=new DomBossPages(ctx,page,{baseUrl:srv.url,timeout:500});
 const job={key:'one',url:srv.url+'/job_detail/one.html',company:'同名公司',title:'AI工程师',collectedAt:new Date().toISOString()};
 const c={key:'chat1',jobKey:'one',recruiterId:'boss1',company:'同名公司',title:'AI工程师',url:srv.url};
 pages.openChat=async()=>c;pages.reopenAttempt=async()=>c;
 const store=openStore(':memory:');const runId=store.beginRun(account,loadConfig({keywords:['AI']},process.cwd()),t);
 return {page,pages,job,c,store,runId,account,template:t,signal:new AbortController().signal,cleanup:async()=>{store.close();await ctx.close();await srv.close();}};
}
test.each(['direct','fill'] as const)('%s produces exactly one confirmed template',async mode=>{
 const f=await setup(mode);try{expect((await greetOne(f)).status).toBe('confirmed');expect(await f.page.evaluate('window.sends')).toBe(1);expect((await greetOne(f)).status).toBe('skipped');expect(await f.page.evaluate('window.sends')).toBe(1);}finally{await f.cleanup();}
});
test.each(['failed','bubble','unknown'] as const)('%s is unconfirmed and never retries Enter',async mode=>{
 const f=await setup(mode);try{expect((await greetOne(f)).status).toBe('unconfirmed');expect(await f.page.evaluate('window.sends')).toBe(mode==='unknown'?0:1);await reconcile(f);expect(await f.page.evaluate('window.sends')).toBe(mode==='unknown'?0:1);}finally{await f.cleanup();}
});
test('wrong recipient stops before selecting template',async()=>{const f=await setup('direct');try{await f.page.locator('.chat-conversation').evaluate(e=>e.setAttribute('data-job-id','wrong'));await expect(greetOne(f)).rejects.toThrow('会话');expect(await f.page.evaluate('window.sends')).toBe(0);}finally{await f.cleanup();}});
test('template edited stops; reordered template uses content',async()=>{const f=await setup('direct');try{await f.page.locator('.phrase-panel').evaluate(e=>e.prepend(e.lastElementChild!));expect((await greetOne(f)).status).toBe('confirmed');}finally{await f.cleanup();}const g=await setup('direct');try{await g.page.locator('.phrase-item').first().evaluate(e=>e.textContent='已修改');await expect(greetOne(g)).rejects.toThrow('常用语');expect(await g.page.evaluate('window.sends')).toBe(0);}finally{await g.cleanup();}});
test('existing target is skipped, crash reconciliation is read-only',async()=>{const f=await setup('direct');try{await f.page.evaluate('send()');const a=f.store.reserve(f.runId,account.key,f.job,t);f.store.updateAttempt(a.id,'sending',undefined,'chat1',f.c.url);await reconcile(f);expect(f.store.pending(account.key)).toHaveLength(0);expect(await f.page.evaluate('window.sends')).toBe(1);}finally{await f.cleanup();}});
test('ambiguous old conversation is never messaged',async()=>{const f=await setup('direct');try{await f.page.locator('.chat-record').evaluate(e=>e.innerHTML='<div class="message-item">旧消息</div>');await expect(greetOne(f)).rejects.toThrow('已有');expect(await f.page.evaluate('window.sends')).toBe(0);}finally{await f.cleanup();}});
