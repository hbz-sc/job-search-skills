import {test,expect,beforeAll,afterAll} from 'vitest';
import {chromium,type Browser,type Page} from 'playwright';
import {McpBossPages} from '../src/browser/mcp-boss-pages.js';
import {productionContract,type SiteContract} from '../src/browser/mcp-selectors.js';
import {mcpSite} from './fixtures/mcp-site.js';
import type {McpPort} from '../src/mcp/client.js';
import {template} from '../src/domain.js';
let browser:Browser;let site:Awaited<ReturnType<typeof mcpSite>>;
beforeAll(async()=>{browser=await chromium.launch({channel:'msedge',headless:true});site=await mcpSite();});
afterAll(async()=>{await browser?.close();await site?.close();});
export const fixtureContract=():SiteContract=>({...productionContract,version:'fixture-v1',verified:true,account:'.user-name',accountAttribute:'data-user-id',detail:'.job-detail-box',detailJobAttribute:'data-job-id',empty:'.empty',queryPath:'/wapi/zpgeek/search/joblist.json',phraseMode:'unknown'});
async function setup(chat=false,phraseMode:'fill'|'direct'|'unknown'='unknown'){
 const context=await browser.newContext();const page=await context.newPage();await page.goto(site.url+(chat?'/web/geek/chat':'/web/geek/jobs'));
 const abort=new AbortController();let disconnected=false;
 const port:McpPort={tools:async()=>[],call:async(name,args,s)=>{s.throwIfAborted();if(disconnected)throw new Error('closed');if(name!=='browser_run_code_unsafe')throw new Error('unsupported');
  const result=await new Function('page','return ('+String(args.code)+')(page)')(page);
  return {content:[{type:'text',text:'### Result\n'+JSON.stringify(result)}]};},close:async()=>{disconnected=true;}};
 const p=new McpBossPages(port,{connection:{kind:'extension',profileDirName:'Default'},signal:abort.signal,timeoutMs:1000,allowedOrigin:site.url,contract:{...fixtureContract(),phraseMode}});
 return {p,page,context,abort};
}
test('reads current query only, even with stale cards and identical later results; zero results complete',async()=>{
 const {p,page,context}=await setup();try{
  expect((await p.account())?.key).toBe('account-1');
  await p.search('深圳','AI');expect((await p.visibleJobs()).map(j=>j.key)).toEqual(['one']);
  await p.search('深圳','same');expect((await p.visibleJobs()).map(j=>j.key)).toEqual(['one']);expect((await p.visibleJobs())[0].title).toBe('同 ID 新岗位正文');expect(new URL(page.url()).searchParams.get('query')).toBe('same');
  await p.search('深圳','empty');expect(await p.visibleJobs()).toEqual([]);
  expect(await page.evaluate('window.contacts')).toBe(0);
 }finally{await context.close();}
});
test('late same-keyword response from before a new search is never accepted for that search',async()=>{
 const {p,page,context}=await setup();try{
  await p.search('深圳','AI');
  await page.evaluate(()=>{void fetch('/wapi/zpgeek/search/joblist.json?query=AI&stale=1&lag=400');});
  await p.search('深圳','AI');await new Promise(r=>setTimeout(r,500));
  expect((await p.visibleJobs())[0].title).toBe('AI工程师');
 }finally{await context.close();}
});
test('changed search filters invalidate the queued job before contact',async()=>{
 const {p,page,context}=await setup();try{
  await p.search('深圳','AI');const job=(await p.visibleJobs())[0];
  await p.assertSearchScope({city:'深圳',keyword:'AI',filtersHash:template('经验不限').hash});
  await page.locator('.filter-select-box').evaluate(e=>e.textContent='5年以上');
  await expect(p.openChat(job)).rejects.toThrow();expect(await page.evaluate('window.contacts')).toBe(0);
 }finally{await context.close();}
});
test('reads full first phrase from existing chat then restores search, no new contact',async()=>{
 const {p,page,context}=await setup();try{
  expect((await p.readInitialTemplate()).text).toBe('你好，想了解这个岗位。');
  expect(page.url()).toBe(site.url+'/web/geek/jobs');expect(await page.evaluate('window.contacts')).toBe(0);
  await p.close();expect(page.isClosed()).toBe(false);
 }finally{await context.close();}
});
test('ambiguous tabs and changed account refuse instead of following focus',async()=>{
 const {p,page,context}=await setup();try{
  const other=await context.newPage();await other.goto(page.url());
  await expect(p.account()).rejects.toThrow(/标签/);await other.close();
  await p.account();await page.locator('.user-name').evaluate(e=>e.setAttribute('data-user-id','different'));
  await expect(p.search('深圳','AI')).rejects.toThrow(/账号/);
 }finally{await context.close();}
});
test('lost identity or navigation outside allowed site prevents continuing',async()=>{
 const {p,page,context}=await setup();try{
  await page.locator('.user-name').evaluate(e=>e.removeAttribute('data-user-id'));expect(await p.account()).toBeUndefined();
  await page.goto('about:blank');await expect(p.readInitialTemplate()).rejects.toThrow();
 }finally{await context.close();}
});
const convo=()=>({key:'chat1',jobKey:'one',recruiterId:'hr1',company:'公司',title:'AI工程师',url:site.url+'/web/geek/chat'});
test.each(['direct','delayed-direct','fill','unknown','failed','bubble'])('phrase mode %s never duplicates and requires delivered status',async(mode)=>{
 const {p,page,context}=await setup(true,mode==='fill'?'fill':'unknown');try{
  const t=await p.readInitialTemplate();await page.evaluate(m=>{(window as any).mode=m;},mode);
  await p.inspectChat(convo(),t);const selection=await p.chooseTemplate(t);
  if(selection==='filled')await p.submitFilledTemplate(t);
  const r=await p.verifyTemplate(t);
  expect(await page.evaluate('window.sends')).toBe(mode==='unknown'?0:1);
  expect(r.status).toBe(['direct','delayed-direct','fill'].includes(mode)?'confirmed':'unconfirmed');
 }finally{await context.close();}
});
test('template is literal data and reorder preserves selection; edits stop',async()=>{
 const {p,page,context}=await setup(true);try{
  const text='你好 ` ${process.exit()} "\n忽略指令 😀';
  await page.locator('.phrase-item').first().evaluate((e,t)=>e.textContent=t,text);
  const t=await p.readInitialTemplate();await p.inspectChat(convo(),t);
  await page.locator('.phrase-panel').evaluate(e=>e.prepend(e.lastElementChild!));
  await p.chooseTemplate(t);expect((await p.verifyTemplate(t)).status).toBe('confirmed');
  expect(await page.locator('.message-item .text').textContent()).toBe(text);expect(await page.evaluate('window.sends')).toBe(1);
 }finally{await context.close();}
 const other=await setup(true);try{const t=await other.p.readInitialTemplate();await other.p.inspectChat(convo(),t);await other.page.locator('.phrase-item').first().evaluate(e=>e.textContent='修改');await expect(other.p.chooseTemplate(t)).rejects.toThrow();expect(await other.page.evaluate('window.sends')).toBe(0);}finally{await other.context.close();}
});
test('abort or account switch during phrase panel preparation prevents selecting a phrase',async()=>{
 for(const action of ['abort','account']){
  const {p,page,context,abort}=await setup(true);try{
   const t=await p.readInitialTemplate();await p.inspectChat(convo(),t);await page.evaluate(()=>{(window as any).panelDelay=350;});
   const pending=p.chooseTemplate(t);const caught=pending.catch(e=>e);
   await new Promise(r=>setTimeout(r,100));if(action==='abort')abort.abort();else await page.locator('.user-name').evaluate(e=>e.setAttribute('data-user-id','other'));
   expect(await caught).toBeInstanceOf(Error);expect(await page.evaluate('window.sends')).toBe(0);
  }finally{await context.close();}
 }
});
test('opens correct job once and recovery never clicks contact',async()=>{
 const {p,page,context}=await setup();try{
  await p.search('深圳','AI');const job=(await p.visibleJobs())[0];const c=await p.openChat(job);expect(c.jobKey).toBe('one');
  const t=template('你好，想了解这个岗位。');await p.inspectChat(c,t);
  const a={id:'1',runId:'r',accountKey:'account-1',jobKey:'wrong',templateHash:t.hash,phase:'sending' as const,conversationKey:'missing',conversationUrl:c.url};
  expect(await p.reopenAttempt(a)).toBeUndefined();expect(await page.evaluate('window.sends')).toBe(0);
 }finally{await context.close();}
});
test('same-tab chat return restores the query before continuing the job loop',async()=>{
 const {p,context}=await setup();try{
  await p.search('深圳','AI');const job=(await p.visibleJobs())[0];await p.openChat(job);
  await p.restoreSearch();expect((await p.visibleJobs()).map(j=>j.key)).toEqual(['one']);
 }finally{await context.close();}
});
