import {setTimeout as delay} from 'node:timers/promises';
import {Stop,evidence,template,type BossPages,type Account,type Job,type Template,type Conversation,type Attempt,type SendResult,type ChatInspection,type PageState} from '../domain.js';
import type {McpPort} from '../mcp/client.js';
import {decodeToolResult} from '../mcp/result.js';
import {buildReadCode} from './mcp-scripts.js';
import {productionContract,type SiteContract} from './mcp-selectors.js';
import type {EdgeBinding,EdgeConnection} from './edge-binding.js';
export type PageOptions={connection:EdgeConnection;binding?:EdgeBinding;signal:AbortSignal;timeoutMs:number;allowedOrigin:string;contract?:SiteContract};
type Snapshot={url:string;account?:Account;state:{kind:PageState['kind'];alert:string};jobs:Job[];city:string;filters:string;empty:boolean;query?:{keyword:string;ready:boolean;error?:string};conversation?:Conversation;phrases:string[];messages:Array<{text:string;status:string}>;editor?:string;detailJob?:string;platformGreeting:boolean;historyCount:number};
export class McpBossPages implements BossPages {
 private active?:string;private searchTab?:string;private searchUrl?:string;private expectedAccount?:Account;private keyword?:string;
 private expectedConversation?:Conversation;
 private expectedScope?:{city:string;keyword:string;filters:string;tabId:string};
 protected contract:SiteContract;
 constructor(private port:McpPort,private options:PageOptions){this.contract=options.contract??productionContract;if(options.binding)this.expectedAccount={key:options.binding.accountKey,displayName:options.binding.displayName};}
 private check(){if(this.options.signal.aborted)throw new Stop('user','用户停止');}
 private async exec(op:string,extra:Record<string,unknown>={}){
  this.check();const result=decodeToolResult(await this.port.call('browser_run_code_unsafe',{code:buildReadCode({op,origin:this.options.allowedOrigin,contract:this.contract,tabId:this.active,accountKey:this.expectedAccount?.key,scope:this.expectedScope,...extra})},this.options.signal));
  this.check();if(typeof result.error==='string'){const block=result.error.match(/BLOCK:(quota|login|verification)/)?.[1];throw new Stop(block as 'quota'|'login'|'verification'??'layout',result.error);}return result.value;
 }
 async tabs():Promise<Array<{id:string;url:string}>>{const v=await this.exec('tabs');if(!Array.isArray(v)||v.some(t=>typeof t.id!=='string'||typeof t.url!=='string'))throw new Stop('layout','MCP 标签结果无效');return v;}
 private async ensureTab(){
  if(this.active)return;
  const tabs=(await this.tabs()).filter(t=>{try{return new URL(t.url).origin===this.options.allowedOrigin;}catch{return false;}});
  const preferred=this.options.connection.preferredUrl;
  const candidates=preferred?tabs.filter(t=>t.url===preferred):tabs.filter(t=>new URL(t.url).pathname==='/web/geek/jobs');
  const target=candidates.length?candidates:tabs.filter(t=>new URL(t.url).pathname==='/web/geek/chat');
  if(target.length!==1)throw new Stop('identity','BOSS 标签页缺失或不唯一，请明确保留一个搜索页');
  this.active=target[0].id;if(new URL(target[0].url).pathname==='/web/geek/jobs'){this.searchTab=this.active;this.searchUrl=target[0].url;}
 }
 private async read():Promise<Snapshot>{
  await this.ensureTab();const v=await this.exec('read') as Snapshot;
  if(!v||typeof v.url!=='string'||!v.state||!Array.isArray(v.jobs)||!Array.isArray(v.phrases)||!Array.isArray(v.messages)||new URL(v.url).origin!==this.options.allowedOrigin)throw new Stop('layout','页面读取结果不完整');return v;
 }
 private async guarded():Promise<Snapshot>{const v=await this.read();if(v.state.kind!=='ready')throw new Stop(v.state.kind,'页面阻断：'+v.state.kind,evidence(v.state.alert,v.url));
  if(!v.account)throw new Stop('identity','无法从页面核实稳定账号标识');
  if(this.expectedAccount&&v.account.key!==this.expectedAccount.key)throw new Stop('identity','账号已改变');this.expectedAccount=v.account;return v;}
 async state():Promise<PageState>{const s=await this.read();return {kind:s.state.kind,evidence:evidence(s.state.alert||'未发现阻断提示',s.url)};}
 async account(){const s=await this.read();if(s.account){if(this.expectedAccount&&s.account.key!==this.expectedAccount.key)throw new Stop('identity','账号已改变');this.expectedAccount=s.account;}return s.account;}
 private async until(predicate:(v:Snapshot)=>boolean):Promise<Snapshot>{const end=Date.now()+this.options.timeoutMs;do{const v=await this.guarded();if(predicate(v))return v;await delay(50,undefined,{signal:this.options.signal});}while(Date.now()<end);throw new Stop('layout','等待页面完成超时，未继续写操作');}
 async search(city:string,keyword:string){
  await this.restoreSearch();const v=await this.guarded();if(!v.city.includes(city))throw new Stop('layout','当前网页城市不是'+city);
  await this.exec('search',{keyword});this.keyword=keyword;
  const loaded=await this.until(v=>{if(v.query?.error)throw new Stop('layout',v.query.error);return v.query?.keyword===keyword&&v.query.ready;});
  this.searchUrl=loaded.url;return {filters:loaded.filters};
 }
 async visibleJobs(){const v=await this.until(v=>{if(v.query?.error)throw new Stop('authorization',v.query.error);return !!this.keyword&&v.query?.keyword===this.keyword&&v.query.ready;});return v.jobs;}
 async assertSearchScope(scope:{city:string;keyword:string;filtersHash:string}){
  if(!this.searchTab)throw new Stop('identity','未绑定搜索页');const v=await this.exec('read',{tabId:this.searchTab}) as Snapshot;
  if(!v.account||v.account.key!==this.expectedAccount?.key||v.city.trim()!==scope.city||template(v.filters||'（无额外筛选）').hash!==scope.filtersHash||v.query?.keyword!==scope.keyword||!v.query.ready)throw new Stop('authorization','授权搜索范围已改变');
  this.expectedScope={city:scope.city,keyword:scope.keyword,filters:v.filters,tabId:this.searchTab};
 }
 async advanceList(){await this.guarded();return !!(await this.exec('advance') as {advanced:boolean}).advanced;}
 async restoreSearch(){await this.ensureTab();if(!this.searchTab||!this.searchUrl)throw new Stop('layout','请打开 BOSS 搜索页');this.active=this.searchTab;const v=await this.guarded();if(v.url!==this.searchUrl){await this.exec('restore',{url:this.searchUrl});if(this.keyword){await this.exec('search',{keyword:this.keyword});await this.until(v=>v.query?.keyword===this.keyword&&!!v.query?.ready);}}}
 async readInitialTemplate(){
  await this.ensureTab();const originTab=this.active;const chats=(await this.tabs()).filter(t=>{const u=new URL(t.url);return u.origin===this.options.allowedOrigin&&u.pathname==='/web/geek/chat';});
  if(chats.length>1)throw new Stop('identity','已有聊天标签页不唯一');
  if(chats.length===1)this.active=chats[0].id;else{await this.guarded();await this.exec('chat-route');}
  await this.until(v=>!!v.conversation);const before=await this.guarded();
  if(!before.phrases.length)await this.exec('phrase-panel');
  const v=await this.until(v=>v.phrases.length>0);const t=template(v.phrases[0]);
  await this.exec('phrase-panel');await this.until(v=>v.phrases.length===0);this.active=originTab;if(this.searchTab)await this.restoreSearch();return t;
 }
 private target(c=this.expectedConversation){if(!this.expectedAccount||!c)throw new Stop('identity','尚未绑定目标会话');return {accountKey:this.expectedAccount.key,jobKey:c.jobKey,conversationKey:c.key,recruiterId:c.recruiterId};}
 private message(v:Snapshot,t:Template):ChatInspection['templateStatus']{
  const matches=v.messages.filter(m=>m.text===t.text);if(matches.some(m=>/失败|重试/.test(m.status)))return 'failed';
  if(matches.some(m=>/^(送达|已送达|已读)$/.test(m.status)))return 'confirmed';return matches.length?'pending':'absent';
 }
 private matches(a:Conversation|undefined,b:Conversation){return !!a&&a.key===b.key&&a.jobKey===b.jobKey&&a.company===b.company&&a.title===b.title&&(!b.recruiterId||a.recruiterId===b.recruiterId);}
 private async checkedChat(){const v=await this.guarded();if(!this.expectedConversation||!this.matches(v.conversation,this.expectedConversation))throw new Stop('identity','会话已改变');return v;}
 async openChat(j:Job):Promise<Conversation>{
  if(!this.contract.verified)throw new Stop('layout','实站写操作契约未验证');
  const url=new URL(j.url);if(url.origin!==this.options.allowedOrigin||url.pathname!=='/job_detail/'+j.key+'.html')throw new Stop('identity','岗位链接身份不符');
  await this.restoreSearch();await this.guarded();const target={accountKey:this.expectedAccount!.key,jobKey:j.key,recruiterId:j.recruiterId};
  await this.exec('select-job',{target});await this.until(v=>v.detailJob===j.key);
  await this.exec('open_chat',{target});
  const end=Date.now()+this.options.timeoutMs;
  do{
   const chats=(await this.tabs()).filter(t=>{const u=new URL(t.url);return u.origin===this.options.allowedOrigin&&u.pathname==='/web/geek/chat';});
   const matches:Array<{id:string;c:Conversation}>=[];
   for(const tab of chats){this.active=tab.id;const v=await this.guarded();const c=v.conversation;if(c&&c.jobKey===j.key&&c.company===j.company&&c.title===j.title&&(!j.recruiterId||c.recruiterId===j.recruiterId))matches.push({id:tab.id,c});}
   if(matches.length>1)throw new Stop('identity','目标会话标签不唯一');
   if(matches.length===1){this.active=matches[0].id;this.expectedConversation=matches[0].c;return matches[0].c;}
   await delay(50,undefined,{signal:this.options.signal});
  }while(Date.now()<end);throw new Stop('identity','开聊结果无法核对，禁止重试');
 }
 async inspectChat(c:Conversation,t:Template):Promise<ChatInspection>{
  const v=await this.guarded();const identityMatches=this.matches(v.conversation,c);if(identityMatches)this.expectedConversation=c;
  const templateStatus=this.message(v,t);return {identityMatches,existingConversation:v.historyCount>0,templateStatus,platformGreeting:v.platformGreeting,evidence:evidence('会话核对='+identityMatches+'；常用语状态='+templateStatus,v.url)};
 }
 async chooseTemplate(t:Template):Promise<'filled'|'submitted'|'unknown'>{
  const before=await this.checkedChat();if(this.message(before,t)!=='absent')return 'submitted';
  if(!before.phrases.length)await this.exec('phrase-panel');await this.until(v=>v.phrases.length>0);
  await this.checkedChat();await this.exec('choose_phrase',{target:this.target(),text:t.text});
  const end=Date.now()+this.options.timeoutMs;
  do{const v=await this.checkedChat();if(this.message(v,t)!=='absent')return 'submitted';if(this.contract.phraseMode==='fill'&&v.editor?.trim()===t.text)return 'filled';await delay(50,undefined,{signal:this.options.signal});}while(Date.now()<end);
  return 'unknown';
 }
 async submitFilledTemplate(t:Template):Promise<void>{await this.checkedChat();await this.exec('submit_phrase',{target:this.target(),text:t.text});}
 async verifyTemplate(t:Template):Promise<SendResult>{
  const end=Date.now()+this.options.timeoutMs;let v:Snapshot,status:ChatInspection['templateStatus'];
  do{v=await this.checkedChat();status=this.message(v,t);if(status==='confirmed'||status==='failed')break;await delay(50,undefined,{signal:this.options.signal});}while(Date.now()<end);
  return {status:status==='confirmed'?'confirmed':'unconfirmed',evidence:evidence('目标常用语状态='+status,v.url)};
 }
 async reopenAttempt(a:Attempt):Promise<Conversation|undefined>{
  if(!a.conversationKey||!a.conversationUrl)return;
  const url=new URL(a.conversationUrl);if(url.origin!==this.options.allowedOrigin||url.pathname!=='/web/geek/chat')return;
  const tabs=(await this.tabs()).filter(t=>{const u=new URL(t.url);return u.origin===url.origin&&u.pathname==='/web/geek/chat';});
  if(tabs.length!==1)return;this.active=tabs[0].id;let v=await this.guarded();
  if(v.conversation?.key!==a.conversationKey){await this.exec('existing-chat',{target:{accountKey:a.accountKey,jobKey:a.jobKey,conversationKey:a.conversationKey}});v=await this.guarded();}
  if(v.conversation?.key===a.conversationKey&&v.conversation.jobKey===a.jobKey){this.expectedConversation=v.conversation;return v.conversation;}return;
 }
 async captureDiagnostic(reason:string){let url='local:';try{url=(await this.read()).url;}catch{}return evidence(reason,url);}
 async close(){await this.port.close();}
}
