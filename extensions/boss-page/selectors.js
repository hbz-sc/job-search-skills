export const S={search:'input[placeholder*="搜索职位"]',searchButton:'.search-btn, .btn-search, button[type="submit"]',city:'.city-label, .city-name, .city-select .city, .city-current',cards:'.job-card-wrapper, .job-card-box',jobLink:'a[href*="/job_detail/"]',detail:'.job-detail-box, .job-detail-container',title:'.job-name, .job-title, h2',company:'.company-name, .company-info .name',recruiter:'.boss-name, .boss-info .name',chat:'.chat-conversation, .chat-container',chatJob:'.chat-position, .chat-job, .job-info',chatCompany:'.chat-company, .boss-info .company-name',chatRecruiter:'.boss-name, .chat-header .name',phraseButton:'[title="常用语"], [aria-label="常用语"], .icon-phrase',phrases:'.phrase-panel .phrase-item, .common-phrase .phrase-item, .sentence-panel ul > li',editor:'textarea.chat-input, .chat-input[contenteditable="true"], #chat-input',send:'.btn-send',messages:'.chat-record .message-item.item-myself, .chat-message-list .item-myself',messageText:'.text, .text-content',messageStatus:'.message-status, .status',alerts:'[role="dialog"], .dialog-wrap, .toast, .toast-content, .error-content, .verify-dialog, .verify-wrap',empty:'.job-empty, .search-empty'};
export const visible=e=>Boolean(e?.getClientRects().length)&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
export const all=(root,selector)=>[...root.querySelectorAll(selector)].filter(visible);
export const clean=e=>(e?.textContent||'').replace(/\s+/g,' ').trim();
export function unique(root,selector,code){const es=all(root,selector);if(es.length!==1)throw Error(code+':matches='+es.length);return es[0];}
export function textButton(root,label){const es=all(root,'a,button,[role="button"]').filter(e=>clean(e)===label);if(es.length!==1)throw Error('BUTTON_AMBIGUOUS:'+label+':matches='+es.length);return es[0];}
export function assertPageReady(doc){
 for(const e of all(doc,S.alerts)){const t=clean(e);if(/验证|验证码/.test(t))throw Error('VERIFICATION_REQUIRED');if(/扫码登录|登录后|登录.*(失效|过期)|重新登录/.test(t))throw Error('LOGIN_REQUIRED');if(/(沟通|招呼).*(上限|用完)|今日.*已达/.test(t))throw Error('QUOTA_REACHED');}
}
export function jobCards(doc){const seen=new Set();const out=[];for(const card of all(doc,S.cards)){const link=card.querySelector(S.jobLink);let key;try{const u=new URL(link?.getAttribute('href')||'','https://www.zhipin.com');if(u.origin==='https://www.zhipin.com')key=u.pathname.match(/^\/job_detail\/([a-zA-Z0-9_-]+)\.html$/)?.[1];}catch{}if(!key||seen.has(key))continue;seen.add(key);out.push({key,title:clean(card.querySelector('.job-name')||link),company:clean(card.querySelector('.job-card-footer .boss-info .boss-name')||card.querySelector(S.company)),url:'https://www.zhipin.com/job_detail/'+key+'.html',...(all(card,'span,div').some(e=>!e.children.length&&clean(e)==='猎头')?{unsupportedChat:true}:{}),element:card});}return out;}
export const serialJobs=doc=>jobCards(doc).map(({element,...j})=>j);

// Observe the page's city without changing its filter. URL codes are explicitly labelled.
export function observedSearchCity(doc,url=doc.location?.href,mode='深圳'){
 if(!['深圳','current'].includes(mode))throw Error('INVALID_SCOPE');
 const labels=[...new Set(all(doc,S.city).map(clean).filter(Boolean))];
 let code;try{code=new URL(url).searchParams.get('city');}catch{}
 if(mode==='深圳'){
  if(!labels.length)throw Error('CITY_NOT_READY');
  if(!labels.includes('深圳')||code&&code!=='101280600')throw Error('CITY_MISMATCH');
  return '深圳';
 }
 // The URL can update before the visible city label does after a search.
 if(code&&/^\d{6,12}$/.test(code))return 'city-code:'+code;
 if(labels.length===1)return labels[0];
 throw Error('CITY_NOT_READY');
}
