import type {BrowserContext,Page,Locator} from 'playwright';
import {selectors as S} from './selectors.js';
import {Stop,evidence,template,normalize,type BossPages,type PageState,type Account,type Job,type Template,type Conversation,type Attempt,type SendResult,type ChatInspection} from '../domain.js';
export class DomBossPages implements BossPages {
 readonly baseUrl:string; readonly timeout:number; protected searchPage:Page; protected active:Page;
 protected searchUrl:string; protected expected?:Conversation;
 constructor(readonly context:BrowserContext,page:Page,options:{baseUrl?:string;timeout?:number}={}){
  this.baseUrl=options.baseUrl??'https://www.zhipin.com';this.timeout=options.timeout??15000;
  this.searchPage=page;this.active=page;this.searchUrl=page.url();context.setDefaultTimeout(this.timeout);
 }
 async unique(l:Locator){if(await l.count()!==1)throw new Stop('layout','页面元素缺失或不唯一');return l;}
 async state():Promise<PageState>{
  const alerts=(await this.active.locator(S.alerts).filter({visible:true}).allTextContents()).join('\n');
  const has=(r:RegExp)=>r.test(alerts);
  let kind:PageState['kind']='ready';
  if(has(/(?:沟通|招呼|联系).{0,20}(?:上限|用完|耗尽)|(?:今日|当日).{0,15}(?:次数|额度).{0,10}(?:不足|已满|用完)/))kind='quota';
  else if(has(/安全验证|验证码|操作频繁|访问异常|滑块验证/))kind='verification';
  else if(has(/扫码登录|请先登录|登录已失效/) || /\/web\/user\//.test(this.active.url()))kind='login';
  return {kind,evidence:evidence(kind==='ready'?'未发现阻断提示':alerts,this.active.url())};
 }
 async account():Promise<Account|undefined>{
  const l=this.active.locator(S.account).filter({visible:true});if(await l.count()!==1)return;
  const key=await l.getAttribute('data-user-id');const displayName=(await l.innerText()).trim();
  if(key&&displayName)return {key,displayName};
 }
 async search(city:string,keyword:string){
  this.active=this.searchPage;await this.blockCheck();
  // Keep the user's active filters; only change the query using the visible form.
  const cityText=(await this.active.locator(S.city).allTextContents()).join(' ');
  if(!cityText.includes(city))throw new Stop('layout','请在专用浏览器中选择城市：'+city);
  const input=await this.unique(this.active.getByPlaceholder(/搜索职位|搜索岗位/));
  await input.fill(keyword);await this.active.getByRole('button',{name:'搜索',exact:true}).click();
  await this.active.locator(S.cards).first().waitFor({state:'visible'});
  this.searchUrl=this.active.url();await this.blockCheck();
  return {filters:(await this.active.locator(S.filters).allTextContents()).join(' | ')};
 }
 async visibleJobs():Promise<Job[]>{
  await this.blockCheck();
  const rows=await this.active.locator(S.cards).evaluateAll((cards,s)=>cards.map(el=>{
   const a=el.querySelector<HTMLAnchorElement>(s.jobLink);const tx=(q:string)=>el.querySelector(q)?.textContent?.trim();
   return {url:a?.href,title:a?.textContent?.trim(),company:tx(s.company),salary:tx(s.salary),district:tx(s.district)};
  }),S);
  const jobs:Job[]=[];
  for(const row of rows){if(!row.url||!row.title)continue;const u=new URL(row.url);const id=u.pathname.match(/^\/job_detail\/([^/]+)\.html$/)?.[1];
   if(!id||u.origin!==this.baseUrl)continue;
   jobs.push({key:id,url:u.origin+u.pathname,title:row.title,company:row.company??'',salary:row.salary,district:row.district,collectedAt:new Date().toISOString()});
  }return jobs;
 }
 async assertSearchScope(scope:{city:string;keyword:string;filtersHash:string}){
  const city=(await this.searchPage.locator(S.city).allTextContents()).join(' ');
  const query=await this.searchPage.getByPlaceholder(/搜索职位|搜索岗位/).inputValue();
  const filters=(await this.searchPage.locator(S.filters).allTextContents()).join(' | ');
  if(city.trim()!==scope.city||query!==scope.keyword||template(filters||'（无额外筛选）').hash!==scope.filtersHash)throw new Stop('authorization','搜索范围改变');
 }
 async advanceList(){const cards=this.active.locator(S.cards);if(!await cards.count())return false;await cards.last().scrollIntoViewIfNeeded();await this.active.mouse.wheel(0,650);return true;}
 async restoreSearch(){this.active=this.searchPage;if(this.active.url()!==this.searchUrl)await this.active.goto(this.searchUrl,{waitUntil:'domcontentloaded'});}
 async blockCheck(){const s=await this.state();if(s.kind!=='ready')throw new Stop(s.kind,'页面需要处理：'+s.kind,s.evidence);}
 async readInitialTemplate():Promise<Template>{
  // Read-only existing conversation/settings route, never click a new job to obtain a template.
  const chat=this.context.pages().find(p=>p.url().startsWith(this.baseUrl+'/web/geek/chat'));
  if(!chat)throw new Stop('template','请先在专用浏览器打开已有会话，显示常用语后重试；不会为读取模板新建沟通。');
  this.active=chat;await this.blockCheck();
  const button=await this.unique(chat.locator(S.phraseButton).filter({visible:true}));await button.click();
  const first=chat.locator(S.phrases).filter({visible:true}).first();await first.waitFor({state:'visible'});
  const t=template(await first.innerText());await button.click();await this.restoreSearch();return t;
 }
 async conversation():Promise<Conversation|undefined>{
  const root=this.active.locator(S.conversation).filter({visible:true});if(await root.count()!==1)return;
  const key=await root.getAttribute('data-conversation-id');const jobKey=await root.getAttribute('data-job-id');
  const a=root.locator(S.chatJob);if(await a.count()!==1)return;
  const href=await a.getAttribute('href');if(!href||!key||!jobKey)return;
  const id=new URL(href,this.baseUrl).pathname.match(/^\/job_detail\/([^/]+)\.html$/)?.[1];if(id!==jobKey)return;
  return {key,jobKey,recruiterId:await root.getAttribute('data-boss-id')??undefined,company:(await root.locator(S.chatCompany).innerText()).trim(),title:(await a.innerText()).trim(),url:this.active.url()};
 }
 async openChat(job:Job):Promise<Conversation>{
  if(new URL(job.url).origin!==this.baseUrl)throw new Stop('identity','岗位域名不符');
  const before=await this.account();if(!before)throw new Stop('identity','账号标识缺失');
  const detail=await this.context.newPage();this.active=detail;
  await detail.goto(job.url,{waitUntil:'domcontentloaded'});await this.blockCheck();
  if(new URL(detail.url()).pathname!==new URL(job.url).pathname)throw new Stop('identity','岗位链接发生跳转');
  if((await this.account())?.key!==before.key)throw new Stop('identity','账号发生变化');
  const panel=await this.unique(detail.locator('.job-banner, .job-detail-box').filter({has:detail.getByText(job.title,{exact:true})}).filter({visible:true}));
  const button=await this.unique(panel.getByText('立即沟通',{exact:true}));
  await button.click();
  const until=Date.now()+this.timeout;
  do {
   const candidates=this.context.pages().filter(p=>p.url().startsWith(this.baseUrl+'/web/geek/chat'));
   for(const page of candidates){this.active=page;await this.blockCheck();const c=await this.conversation();if(c?.jobKey===job.key&&c.company===job.company&&c.title===job.title){this.expected=c;return c;}}
   this.active=detail;await this.blockCheck();await new Promise(r=>setTimeout(r,100));
  }while(Date.now()<until);
  throw new Stop('identity','开聊后无法确认对应会话，保留待确认记录');
 }
 async message(t:Template){
  const rows=this.active.locator(S.messages).filter({visible:true});
  let result:'absent'|'pending'|'failed'|'confirmed'='absent';
  for(const row of await rows.all()){
   const text=row.locator(S.messageText);if(await text.count()!==1||normalize(await text.innerText())!==t.text)continue;
   const status=(await row.locator(S.messageStatus).allTextContents()).join('');
   if(/发送失败|重试/.test(status))return 'failed';
   if(/^(送达|已送达|已读|已发送)$/.test(status.trim()))result='confirmed';
   else if(result!=='confirmed')result='pending';
  }return result;
 }
 async inspectChat(c:Conversation,t:Template):Promise<ChatInspection>{
  const actual=await this.conversation();
  const identityMatches=!!actual&&actual.key===c.key&&actual.jobKey===c.jobKey&&actual.company===c.company&&actual.title===c.title;
  if(identityMatches)this.expected=c;
  const templateStatus=await this.message(t);
  const existingConversation=await this.active.locator('.chat-record .message-item:not(.platform-auto)').count()>0;
  return {identityMatches,existingConversation,templateStatus,evidence:evidence('会话核对='+identityMatches+'；目标常用语状态='+templateStatus,this.active.url())};
 }
 async checkExpected(){
  await this.blockCheck();const c=await this.conversation();
  if(!this.expected||!c||c.key!==this.expected.key||c.jobKey!==this.expected.jobKey||c.company!==this.expected.company||c.title!==this.expected.title)throw new Stop('identity','会话已改变');
 }
 async editorText(){const e=this.active.locator(S.editor).filter({visible:true});if(await e.count()!==1)return undefined;return normalize(await e.evaluate(el=>el instanceof HTMLTextAreaElement?(el as HTMLTextAreaElement).value:el.textContent??''));}
 async chooseTemplate(t:Template):Promise<'filled'|'submitted'|'unknown'>{
  await this.checkExpected();await (await this.unique(this.active.locator(S.phraseButton).filter({visible:true}))).click();
  const items=this.active.locator(S.phrases).filter({visible:true});await items.first().waitFor({state:'visible'});
  const matches:Locator[]=[];for(const item of await items.all())if(normalize(await item.innerText())===t.text)matches.push(item);
  if(matches.length!==1)throw new Stop('template','指定常用语缺失、重复或已修改');
  await this.checkExpected();await matches[0].click();
  const until=Date.now()+this.timeout;
  do {await this.checkExpected();if(await this.message(t)!=='absent')return 'submitted';if(await this.editorText()===t.text)return 'filled';await new Promise(r=>setTimeout(r,100));}while(Date.now()<until);
  return 'unknown';
 }
 async submitFilledTemplate(t:Template):Promise<void>{
  await this.checkExpected();if(await this.message(t)!=='absent')return;
  if(await this.editorText()!==t.text)throw new Stop('template','输入框正文与指定常用语不符');
  await (await this.unique(this.active.locator(S.send).filter({visible:true}))).click();
 }
 async verifyTemplate(t:Template):Promise<SendResult>{
  const until=Date.now()+this.timeout;let status='absent';
  do {await this.checkExpected();status=await this.message(t);if(status==='confirmed'||status==='failed')break;await new Promise(r=>setTimeout(r,100));}while(Date.now()<until);
  return {status:status==='confirmed'?'confirmed':'unconfirmed',evidence:evidence('目标常用语状态='+status,this.active.url())};
 }
 async reopenAttempt(a:Attempt):Promise<Conversation|undefined>{
  if(!a.conversationKey||!a.conversationUrl||!a.conversationUrl.startsWith(this.baseUrl+'/web/geek/chat'))return;
  // Only reopen a previously recorded chat; never click a job's contact button here.
  const p=await this.context.newPage();this.active=p;await p.goto(a.conversationUrl,{waitUntil:'domcontentloaded'});await this.blockCheck();
  const c=await this.conversation();if(c?.key===a.conversationKey&&c.jobKey===a.jobKey){this.expected=c;return c;}return;
 }
 async captureDiagnostic(reason:string){return evidence(reason,this.active.url());}
 async close(){await this.context.close();}
}
