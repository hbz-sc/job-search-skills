// Read-only candidate selectors. Their presence does not certify a send contract.
export async function inspectBoss(doc,url){
 const visible=e=>Boolean(e&&e.getClientRects().length)&&getComputedStyle(e).visibility!=='hidden';
 const search=[...doc.querySelectorAll('input[placeholder*="搜索职位"]')].filter(visible);
 const text=e=>(e?.textContent||'').trim().slice(0,160);
 const jobs=[];const seen=new Set();
 for(const card of doc.querySelectorAll('.job-card-wrapper,.job-card-box')){
  if(!visible(card))continue;
  const link=card.querySelector('a[href*="/job_detail/"]');
  let key;try{const u=new URL(link?.getAttribute('href')||'',url);if(u.origin==='https://www.zhipin.com')key=u.pathname.match(/^\/job_detail\/([a-zA-Z0-9_-]+)\.html$/)?.[1];}catch{}
  if(!key||seen.has(key))continue;seen.add(key);
  jobs.push({key,title:text(card.querySelector('.job-name')||link),company:text(card.querySelector('.job-card-footer .boss-info .boss-name')||card.querySelector('.company-name'))});
  if(jobs.length>=30)break;
 }
 const blockers=[];
 for(const dialog of doc.querySelectorAll('[role="dialog"],[role="alert"],.dialog-wrap,.verify-dialog,.verify-wrap,.toast,.toast-content')){
  if(!visible(dialog))continue;
  const t=text(dialog);
  if(/验证|验证码/.test(t))blockers.push('verification');
  if(/扫码登录|登录后|登录.*(失效|过期)|重新登录/.test(t))blockers.push('login');
  if(/沟通.*上限|招呼.*上限/.test(t))blockers.push('quota');
 }
 const u=new URL(url);
 let experienceProbe;
 if(u.pathname.startsWith('/web/geek/jobs')){
  const labels=new Set(['工作经验','不限','经验不限','在校生','应届生','1年以内','1-3年','3-5年','5-10年','10年以上']);
  const filterStyle=e=>{if(!e.matches('.current-select,.filter-select-dropdown,.filter-select-dropdown li'))return {};const s=getComputedStyle(e),r=e.getBoundingClientRect();return {style:{display:s.display,visibility:s.visibility,opacity:s.opacity,pointerEvents:s.pointerEvents,contentVisibility:s.contentVisibility},bounds:{x:r.x,y:r.y,width:r.width,height:r.height}};};
  const describe=e=>{const own=[...e.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim().replace(/[–—]/g,'-');return {tag:e.tagName.toLowerCase(),classes:[...e.classList].slice(0,8).map(c=>c.slice(0,80)),visible:visible(e),...filterStyle(e),...(labels.has(own)?{label:own}:{}),...(e.getAttribute('aria-checked')!==null?{checked:e.getAttribute('aria-checked')}:{}),...(e.getAttribute('aria-selected')!==null?{selected:e.getAttribute('aria-selected')}:{}),...(e.tagName==='INPUT'&&e.type==='checkbox'?{checked:e.checked}:{})};};
  experienceProbe=[...doc.querySelectorAll('.current-select')].filter(e=>visible(e)&&(/工作经验|\d+\s*[-–—]\s*\d+年/.test(text(e)))).slice(0,2).map(control=>{
   const ancestors=[];let root=control.parentElement;for(let i=0;root&&root!==doc.body&&i<3;i++,root=root.parentElement){if(root.querySelectorAll('.current-select').length>1)break;ancestors.push({root:describe(root),nodes:[...root.querySelectorAll('*')].slice(0,100).map(describe)});}return {control:describe(control),ancestors};
  });
 }
 const detailProbe=u.pathname.startsWith('/web/geek/jobs')?[...doc.querySelectorAll('.job-detail-box')].filter(visible).slice(0,2).map(root=>({
  titles:[...root.querySelectorAll('.job-name,.job-title')].filter(visible).slice(0,4).map(text),
  companies:[...root.querySelectorAll('.company-name,.company-info .name')].filter(visible).slice(0,4).map(text),
  jobKeys:[...new Set([...root.querySelectorAll('a[href*="/job_detail/"]')].filter(visible).map(e=>{try{const link=new URL(e.getAttribute('href'),url);return link.origin==='https://www.zhipin.com'?link.pathname.match(/^\/job_detail\/([a-zA-Z0-9_-]+)\.html$/)?.[1]:null;}catch{return null;}}).filter(Boolean))].slice(0,4)
 })):undefined;
 const noticeProbe=u.pathname.startsWith('/web/geek/jobs')?[...doc.querySelectorAll('[role="dialog"],[role="alert"],[class*="dialog"],[class*="toast"],[class*="modal"]')].filter(visible).filter(e=>!e.querySelector('[role="dialog"],[role="alert"],[class*="dialog"],[class*="toast"],[class*="modal"]')).slice(0,12).map(e=>({classes:[...e.classList].slice(0,8),text:text(e)})):undefined;
 // Fixed public job anchors only: never serialize HTML, arbitrary attributes,
 // account headers, chat messages, form values or link query strings.
 let layoutProbe;
 if(u.pathname.startsWith('/web/geek/jobs')){
  const describe=e=>({tag:e.tagName.toLowerCase(),classes:[...e.classList].slice(0,8).map(s=>s.slice(0,80))});
  const anchors=[];
  for(const e of doc.querySelectorAll('h1,h2,h3,h4,h5,span,a,button,div')){
   if(anchors.length>=12)break;
   if(!visible(e)||e.children.length||!['职位描述','立即沟通','继续沟通'].includes((e.textContent||'').trim()))continue;
   const ancestors=[];let node=e;
   for(let i=0;node&&node!==doc.body&&i<6;i++,node=node.parentElement){
    ancestors.push({...describe(node),children:[...node.children].filter(visible).slice(0,12).map(describe)});
   }
   anchors.push({label:e.textContent.trim(),ancestors});
  }
  const regions=[];
  // Bounded structure of known public job regions; no text or attribute dump.
  const regionRoots=[...doc.querySelectorAll('.job-detail-box')].filter(visible).slice(0,2).concat([...doc.querySelectorAll('.job-card-wrapper,.job-card-box')].filter(visible).slice(0,4));
  for(const root of regionRoots){
   const nodes=[root,...root.querySelectorAll('*')].filter(visible).slice(0,120).map(e=>{
    const item=describe(e);
    if(e.tagName==='A')try{const link=new URL(e.getAttribute('href')||'',url);const key=link.pathname.match(/^\/job_detail\/([a-zA-Z0-9_-]+)\.html$/)?.[1];if(link.origin==='https://www.zhipin.com'&&key)item.jobKey=key;}catch{}
    for(const name of ['data-job-id','data-jobid']){const value=e.getAttribute(name);if(value&&jobs.some(j=>j.key===value))item.detailJobKey=value;}
    if(e.getAttribute('aria-selected')==='true')item.selected=true;
    return item;
   });
   regions.push({root:describe(root),nodes});
  }
  layoutProbe={anchors,regions,cardClasses:[...doc.querySelectorAll('.job-card-wrapper,.job-card-box')].filter(visible).slice(0,5).map(describe)};
 }
 let chatLayoutProbe;
 if(u.pathname.startsWith('/web/geek/chat')){
  const describe=e=>({tag:e.tagName.toLowerCase(),classes:[...e.classList].slice(0,8).map(s=>s.slice(0,80))});
  const ancestry=e=>{const out=[];for(let i=0;e&&e!==doc.body&&i<6;i++,e=e.parentElement)out.push({...describe(e),children:[...e.children].filter(visible).slice(0,24).map(describe)});return out;};
  const labels=['常用语','发送','发简历','查看职位','换电话','换微信'];const anchors=[];
  for(const e of doc.querySelectorAll('button,a,span,i,div')){
   if(anchors.length>=16)break;if(!visible(e))continue;
   const label=[e.getAttribute('title'),e.getAttribute('aria-label'),e.children.length?null:(e.textContent||'').trim()].find(v=>labels.includes(v));
   if(label)anchors.push({label,ancestors:ancestry(e)});
  }
  const editors=[...doc.querySelectorAll('textarea,[contenteditable="true"]')].filter(visible).slice(0,4).map(ancestry);
  const nodes=selector=>[...doc.querySelectorAll(selector)].filter(visible).slice(0,180);
  // Only the recruiter/job header carries text. Menu and message regions
  // contribute structure alone; no chat bodies, draft or saved phrase text.
  const headerNodes=nodes('.top-info-content, .top-info-content *').map(e=>({...describe(e),text:[...e.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim().slice(0,200)}));
  const controlsNodes=nodes('.chat-controls, .chat-controls *').map(describe);
  const messageNodes=nodes('.message-content, .message-content *').map(describe);
  chatLayoutProbe={anchors,editors,headerNodes,controlsNodes,messageNodes};
 }
 return {viewState:{visibility:doc.visibilityState,focused:doc.hasFocus(),width:doc.defaultView.innerWidth,height:doc.defaultView.innerHeight},url:u.origin+u.pathname,pageKind:u.pathname.startsWith('/web/geek/jobs')?'jobs':u.pathname.startsWith('/web/geek/chat')?'chat':'unsupported',identityCapability:'unavailable',searchBox:{count:search.length},jobs,blockers:[...new Set(blockers)],...(experienceProbe?{experienceProbe}:{}),...(detailProbe?{detailProbe}:{}),...(noticeProbe?{noticeProbe}:{}),...(layoutProbe?{layoutProbe}:{}),...(chatLayoutProbe?{chatLayoutProbe}:{}),adapterVersion:'boss-dom-0.8.0',writeEnabled:false};
}
