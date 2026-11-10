import type {SiteContract} from './mcp-selectors.js';
export type ProgramArgs={op:string;origin:string;contract:SiteContract;tabId?:string;accountKey?:string;keyword?:string;url?:string;text?:string;scope?:{city:string;keyword:string;filters:string;tabId:string};target?:{accountKey:string;jobKey:string;conversationKey?:string;recruiterId?:string}};
// Fixed source, never page-authored code. Parameters are serialized data, never shell text.
const body=String.raw`
 const ctx=page.context();
 const session=ctx.__bossJobSearchV1??(ctx.__bossJobSearchV1={tabs:new WeakMap(),next:0,queries:new WeakMap()});
 const pages=ctx.pages();for(const tab of pages)if(!session.tabs.has(tab))session.tabs.set(tab,'tab-'+(++session.next));
 const envelope=value=>({schemaVersion:1,value});
 if(p.op==='tabs')return envelope(pages.map(tab=>({id:session.tabs.get(tab),url:tab.url()})));
 const tab=pages.find(tab=>session.tabs.get(tab)===p.tabId);
 if(!tab||new URL(tab.url()).origin!==p.origin)throw new Error('目标标签页已关闭或域名改变');
 const s=p.contract;
 async function snapshot(readTab=tab){
  const v=await readTab.evaluate(s=>{
   const visible=e=>!!(e.getClientRects().length)&&getComputedStyle(e).visibility!=='hidden';
   const all=q=>Array.from(document.querySelectorAll(q)).filter(visible);
   const one=q=>{const a=all(q);return a.length===1?a[0]:null;};
   const text=e=>e?.textContent?.replace(/\r\n?/g,'\n').trim()??'';
   const account=one(s.account);const key=s.accountAttribute?account?.getAttribute(s.accountAttribute):null;
   const alert=all(s.alerts).map(text).join('\n');
   const kind=/(?:沟通|招呼|联系).{0,20}(?:上限|用完|耗尽)|(?:今日|当日).{0,15}(?:次数|额度).{0,10}(?:不足|已满|用完)/.test(alert)?'quota':/安全验证|验证码|操作频繁|访问异常|滑块验证/.test(alert)?'verification':/扫码登录|请先登录|登录已失效/.test(alert)||location.pathname.startsWith('/web/user/')?'login':'ready';
   const jobId=u=>{try{const x=new URL(u,location.origin);return x.origin===location.origin?x.pathname.match(/^\/job_detail\/([^/]+)\.html$/)?.[1]:undefined;}catch{return undefined;}};
   const jobs=all(s.cards).map(card=>{const a=card.querySelector(s.jobLink);return {key:jobId(a?.href),url:a?.href?new URL(a.href).origin+new URL(a.href).pathname:undefined,title:text(a),company:text(card.querySelector(s.company)),salary:text(card.querySelector(s.salary))||undefined,district:text(card.querySelector(s.district))||undefined,collectedAt:new Date().toISOString()};}).filter(j=>j.key&&j.title&&j.url);
   const chat=one(s.conversation);const chatLink=chat?.querySelector(s.chatJob);const chatKey=chat?.getAttribute(s.conversationAttribute);const cJob=chat?.getAttribute(s.chatJobAttribute);
   const conversation=chatKey&&cJob&&jobId(chatLink?.href)===cJob?{key:chatKey,jobKey:cJob,recruiterId:chat.getAttribute(s.recruiterAttribute)||undefined,company:text(chat.querySelector(s.chatCompany)),title:text(chatLink),url:location.href}:undefined;
   const editor=one(s.editor);const detail=one(s.detail);
   const messages=all(s.messages).map(row=>({text:text(row.querySelector(s.messageText)),status:text(row.querySelector(s.messageStatus))}));
   return {url:location.href,account:key&&text(account)?{key,displayName:text(account)}:undefined,state:{kind,alert},jobs,
    city:all(s.city).map(text).join(' '),filters:all(s.filters).map(text).sort().join(' | '),empty:all(s.empty).length>0,
    input:document.querySelector('input[placeholder*="搜索职位"], input[placeholder*="搜索岗位"]')?.value,
    conversation,messages,phrases:all(s.phrases).map(text),editor:editor?('value' in editor?editor.value:text(editor)):undefined,
    detailJob:detail?.getAttribute(s.detailJobAttribute)||jobId(location.href),
    historyCount:all('.chat-record .message-item:not(.platform-auto)').length,platformGreeting:!!document.querySelector('.platform-auto')};
  },s);
  const query=session.queries.get(readTab);
  const matches=row=>v.jobs.some(j=>j.key===row.encryptJobId&&j.title===row.jobName&&j.company===row.brandName);
  const complete=query?.rows&&v.jobs.every(j=>query.rows.some(row=>row.encryptJobId===j.key&&row.jobName===j.title&&row.brandName===j.company));
  v.query=query?{keyword:query.keyword,ready:!query.error&&query.phase==='received'&&v.input===query.keyword&&new URL(v.url).searchParams.get('query')===query.keyword&&complete&&(query.latest.length===0?(query.rows.length===0?v.empty&&v.jobs.length===0:true):query.latest.some(matches)),error:query.error}:undefined;
  return v;
 }
 const before=await snapshot();
 if(p.op==='read')return envelope(before);
 if(before.state.kind!=='ready')throw new Error('BLOCK:'+before.state.kind);
 if(!before.account||before.account.key!==p.accountKey)throw new Error('账号无法核对或已改变');
 async function unique(locator){if(await locator.count()!==1)throw new Error('页面元素缺失或不唯一');return locator;}
 if(p.op==='search'){
  const previous=session.queries.get(tab);if(previous?.listener)tab.off('response',previous.listener);if(previous?.requestListener)tab.off('request',previous.requestListener);
  const query={keyword:p.keyword,rows:null,latest:[],error:null,phase:'armed',request:null,armed:false,allowNext:true};session.queries.set(tab,query);
  query.requestListener=request=>{const u=new URL(request.url());if(u.origin!==p.origin||u.pathname!==s.queryPath||u.searchParams.get('query')!==p.keyword||!query.armed)return;
   if(!query.allowNext){query.error='搜索范围发生额外请求，需重新核对';return;}
   query.allowNext=false;query.request=request;query.phase='loading';};
  query.listener=async response=>{try{if(response.request()!==query.request)return;
   if(!response.ok()){query.error='搜索请求失败';return;}const data=await response.json();const rows=data?.zpData?.jobList;
   if(!Array.isArray(rows)||rows.some(j=>typeof j.encryptJobId!=='string'||typeof j.jobName!=='string'||typeof j.brandName!=='string')){query.error='搜索结果结构未适配';return;}
   query.rows=[...(query.rows??[]).filter(old=>!rows.some(row=>row.encryptJobId===old.encryptJobId)),...rows];query.latest=rows;query.phase='received';
  }catch{query.error='搜索响应不可读取';}};
  tab.on('request',query.requestListener);tab.on('response',query.listener);
  const input=await unique(tab.getByPlaceholder(/搜索职位|搜索岗位/));await input.fill(p.keyword,{timeout:1000});
  query.armed=true;
  await (await unique(tab.getByRole('button',{name:'搜索',exact:true}))).click({timeout:1000});return envelope({started:true});
 }
 if(p.op==='chat-route'){
  const link=await unique(tab.locator('a[href*="/web/geek/chat"]').filter({visible:true}));const href=await link.getAttribute('href');const url=new URL(href,tab.url());
  if(url.origin!==p.origin||url.pathname!=='/web/geek/chat')throw new Error('聊天入口无法核对');await tab.goto(url.href,{waitUntil:'domcontentloaded',timeout:10000});return envelope({navigated:true});
 }
 if(p.op==='restore'){
  const u=new URL(p.url);if(u.origin!==p.origin||u.pathname!=='/web/geek/jobs')throw new Error('搜索地址无法核对');await tab.goto(u.href,{waitUntil:'domcontentloaded',timeout:10000});return envelope({navigated:true});
 }
 if(p.op==='phrase-panel'){if(!before.conversation)throw new Error('会话无法核对');await (await unique(tab.locator(s.phraseButton).filter({visible:true}))).click({timeout:1000});return envelope({opened:true});}
 if(p.op==='advance'){const cards=tab.locator(s.cards);if(!await cards.count())return envelope({advanced:false});const q=session.queries.get(tab);if(q)q.allowNext=true;await cards.last().scrollIntoViewIfNeeded({timeout:1000});await tab.mouse.wheel(0,650);return envelope({advanced:true});}
 if(p.op==='select-job'){
  const matches=[];for(const card of await tab.locator(s.cards).all()){
   const link=card.locator(s.jobLink);if(await link.count()!==1)continue;
   const href=await link.getAttribute('href');if(!href)continue;
   const u=new URL(href,tab.url());if(u.origin===p.origin&&u.pathname==='/job_detail/'+p.target.jobKey+'.html')matches.push(card);
  }
  if(matches.length!==1)throw new Error('岗位卡片缺失或不唯一');await matches[0].click({timeout:1000});return envelope({selected:true});
 }
 if(p.op==='existing-chat'){
  const matches=tab.locator('.user-list [data-conversation-id]').filter({visible:true});let target;
  for(const item of await matches.all())if(await item.getAttribute('data-conversation-id')===p.target.conversationKey){if(target)throw new Error('已有会话不唯一');target=item;}
  if(!target)return envelope({found:false});await target.click({timeout:1000});return envelope({found:true});
 }
 if(['open_chat','choose_phrase','submit_phrase'].includes(p.op)){
  if(!s.verified)throw new Error('实站写操作契约未验证');
  async function guardWrite(){const v=await snapshot();
   if(v.state.kind!=='ready')throw new Error('BLOCK:'+v.state.kind);
   if(!v.account||v.account.key!==p.target.accountKey)throw new Error('账号已改变');
   if(p.scope){const searchTab=pages.find(t=>session.tabs.get(t)===p.scope.tabId);if(!searchTab)throw new Error('授权搜索页已关闭');
    if(searchTab!==tab||new URL(searchTab.url()).pathname==='/web/geek/jobs'){
     const scope=await snapshot(searchTab);if(scope.account?.key!==p.target.accountKey||scope.city.trim()!==p.scope.city||scope.filters!==p.scope.filters||scope.query?.keyword!==p.scope.keyword||!scope.query.ready)throw new Error('授权搜索筛选或查询已改变');
    }
   }
   if(p.op==='open_chat'){if(v.detailJob!==p.target.jobKey)throw new Error('岗位身份不符');}
   else {const c=v.conversation;if(!c||c.key!==p.target.conversationKey||c.jobKey!==p.target.jobKey||(p.target.recruiterId&&c.recruiterId!==p.target.recruiterId))throw new Error('会话身份不符');}
   return v;
  }
  if(p.op==='open_chat'){
   const button=await unique(tab.locator(s.detail).getByText('立即沟通',{exact:true}).filter({visible:true}));
   await guardWrite();await button.click({timeout:1000});return envelope({clicked:true});
  }
  if(p.op==='choose_phrase'){
   const matches=[];for(const item of await tab.locator(s.phrases).filter({visible:true}).all())if((await item.textContent()??'').replace(/\r\n?/g,'\n').trim()===p.text)matches.push(item);
   if(matches.length!==1)throw new Error('常用语缺失、重复或已修改');
   const v=await guardWrite();if(v.messages.some(m=>m.text===p.text))return envelope({already:true});
   await matches[0].click({timeout:1000});return envelope({selected:true});
  }
  if(s.phraseMode!=='fill')throw new Error('未验证为仅填入模式，禁止追加发送');
  const button=await unique(tab.locator(s.send).filter({visible:true}));const v=await guardWrite();
  if(v.messages.some(m=>m.text===p.text))return envelope({already:true});
  if(v.editor?.replace(/\r\n?/g,'\n').trim()!==p.text)throw new Error('输入框正文改变');
  await button.click({timeout:1000});return envelope({clicked:true});
 }
 throw new Error('未启用的页面操作');
`;
export function buildReadCode(args:ProgramArgs):string{return `async (page) => { const p=${JSON.stringify(args)}; try { ${body} } catch(e) { return {schemaVersion:1,error:String(e.message).slice(0,300)}; } }`;}
