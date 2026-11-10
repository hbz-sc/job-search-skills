import {observedSearchCity,S,all,clean,unique,textButton,assertPageReady,jobCards,serialJobs} from './selectors.js';
import {readSearchFilters,setSearchFilters,searchViewV3,manualExperienceSelection,assertSearchCandidate} from './search-filters.js';
import {experiencePointerView} from './experience-dom.js';
export function searchView(doc,url,city='深圳'){
 if(!all(doc,S.search).length)throw Error('SEARCH_NOT_READY');
 const input=unique(doc,S.search,'SEARCH_BOX_AMBIGUOUS');const u=new URL(url);
 const observedCity=observedSearchCity(doc,url,city);
 return {keyword:input.value,city:observedCity,query:u.searchParams.get('query'),jobs:serialJobs(doc),empty:all(doc,S.empty).length>0};
}
function observedSearchView(doc,url){try{return searchView(doc,url);}catch(e){if(e.message==='CITY_MISMATCH')throw Error('CITY_NOT_READY');throw e;}}
export function detailRoot(doc){
 const candidates=all(doc,S.detail);
 // BOSS nests job-detail-box inside job-detail-container. Count the leaf
 // detail regions, not both wrapper and content; absence may be loading.
 const roots=candidates.filter(e=>!candidates.some(other=>other!==e&&e.contains(other)));
 if(!roots.length)throw Error('DETAIL_NOT_READY');
 if(roots.length!==1)throw Error('DETAIL_AMBIGUOUS:matches='+roots.length);
 return roots[0];
}
export function detailView(doc,job){
 const root=detailRoot(doc);const titles=all(root,S.title).map(clean);
 const identifiers=[root.getAttribute('data-job-id'),root.getAttribute('data-jobid')].filter(Boolean);
 for(const link of all(root,S.jobLink)){try{const u=new URL(link.getAttribute('href'),'https://www.zhipin.com');if(u.origin==='https://www.zhipin.com'){const k=u.pathname.match(/^\/job_detail\/([a-zA-Z0-9_-]+)\.html$/)?.[1];if(k)identifiers.push(k);}}catch{}}
 const cards=jobCards(doc),selectedCards=cards.filter(j=>j.element.matches('.active,.selected,[aria-selected="true"]'));
 const selected=selectedCards.length===1&&selectedCards[0].key===job.key?selectedCards[0]:undefined;
 if(identifiers.length){if(identifiers.some(k=>k!==job.key))throw Error('DETAIL_JOB_KEY_MISMATCH');}
 else{
  // A list title can omit suffixes shown in the full detail. An explicit
  // matching job key is authoritative; title equality is only a fallback.
  if(!titles.includes(job.title))throw Error('DETAIL_JOB_MISMATCH');
  if(!selected||cards.filter(j=>j.title===job.title).length!==1)throw Error('DETAIL_JOB_KEY_UNPROVEN');
 }
 const companies=all(root,S.company).map(clean);
 // A matching detail job URL also proves which card belongs to this detail;
 // current BOSS cards need not have an active/selected CSS marker.
 const linked=identifiers.length?cards.find(j=>j.key===job.key&&j.title===job.title):selected;
 if(!job.company)throw Error('DETAIL_COMPANY_UNPROVEN');
 if(companies.length&&!companies.includes(job.company))throw Error('DETAIL_COMPANY_MISMATCH');
 if(!companies.length&&(!linked||linked.company!==job.company))throw Error('DETAIL_COMPANY_UNPROVEN');
 const name=all(root,'.job-boss-info h2.name')[0];
 const recruiter=name?[...name.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim():all(root,S.recruiter).map(clean).filter(Boolean)[0]||null;
 return {...job,recruiter,alreadyContacted:all(root,'a,button').some(e=>clean(e)==='继续沟通')};
}
export async function searchAction(doc,url,stage,c,state,beforeEffect=async()=>{}){
 assertPageReady(doc);const tool=c.tool;
 if(c.version===3&&['search_jobs','restore_search','list_jobs'].includes(tool))return searchActionV3(doc,url,stage,c,state,beforeEffect);
 if(c.version===3&&tool==='open_job'&&stage==='prepare'){if(!state.query)throw Error('FILTER_UNVERIFIED');assertSearchCandidate(doc,url,state.query,c.payload.jobKey);}
 if(stage==='prepare'){
  if(tool==='restore_search'&&new URL(url).pathname.startsWith('/web/geek/chat')){textButton(doc,'职位');return {returnToJobs:true};}
  if(tool==='search_jobs'||tool==='restore_search'){const v=searchView(doc,url);return {keyword:'AI应用开发工程师',city:'深圳',preserve:v.keyword==='AI应用开发工程师'&&v.query==='AI应用开发工程师'};}
  if(tool==='open_job'){const job=serialJobs(doc).find(j=>j.key===c.payload.jobKey);return job?{job,...(c.version===3?{query:state.query}:{})}:{unavailable:true,reason:'JOB_NOT_VISIBLE'};}
  if(tool==='list_jobs')return {before:serialJobs(doc).map(j=>j.key)};
 }
 if(stage==='perform'){
  if(tool==='search_jobs'||tool==='restore_search'){
   if(state.preserve)return {};
   await beforeEffect();assertPageReady(doc);
   if(state.returnToJobs){textButton(doc,'职位').click();return {};}
   const input=unique(doc,S.search,'SEARCH_BOX_AMBIGUOUS');
   const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'AI应用开发工程师');
   input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
   const buttons=all(doc,S.searchButton).filter(e=>clean(e)==='搜索');(buttons.length===1?buttons[0]:textButton(doc,'搜索')).click();
  }else if(tool==='open_job'){
   if(state.unavailable)return {};
   await beforeEffect();assertPageReady(doc);const job=jobCards(doc).find(j=>j.key===state.job.key);
   if(c.version===3)assertSearchCandidate(doc,url,state.query,state.job.key);
   // List refreshes can replace the card while click authorization is pending.
   // Do not click a replacement; observation returns a non-fatal unavailable result.
   if(!job||job.title!==state.job.title||job.company!==state.job.company)return {};
   job.element.click();
  }
  else if(tool==='list_jobs'&&c.payload.advance){
   await beforeEffect();assertPageReady(doc);
   const cards=jobCards(doc);if(!cards.length)return {};
   let node=cards.at(-1).element.parentElement;while(node&&node!==doc.body&&node.scrollHeight<=node.clientHeight)node=node.parentElement;
   if(node&&node!==doc.body)node.scrollBy({top:node.clientHeight,behavior:'instant'});else cards.at(-1).element.scrollIntoView({block:'end',behavior:'instant'});
   const next=all(doc,'a,button').filter(e=>clean(e)==='下一页'&&!e.matches('[disabled],.disabled,[aria-disabled="true"]'));if(next.length===1){await beforeEffect();if(next[0].isConnected)next[0].click();}
  }
  return {};
 }
 if(stage==='observe'){
  if(tool==='restore_search'&&state.returnToJobs){observedSearchView(doc,url);return {requiresSearch:true};}
  if(tool==='open_job'){
   if(state.unavailable)return {status:'unavailable',reason:state.reason};
   const current=serialJobs(doc).find(j=>j.key===state.job.key);
   if(!current)return {status:'unavailable',reason:'JOB_NOT_VISIBLE'};
   if(current.title!==state.job.title||current.company!==state.job.company)return {status:'unavailable',reason:'JOB_CHANGED'};
   try{const detail=detailView(doc,state.job);
    if(state.query?.experienceMode==='auto'){
     assertSearchCandidate(doc,url,state.query,state.job.key);
     const labels=all(detailRoot(doc),'.job-limit .text-desc,.job-experience,[data-experience]').map(clean).filter(t=>/^\d+-\d+年$|经验不限|应届生|在校生|1年以内|10年以上/.test(t));
     const expected=state.query.experience==='exp_1_3'?'1-3年':'3-5年';
     if(labels.length!==1||labels[0]!==expected)return {status:'unavailable',reason:'JOB_EXPERIENCE_UNVERIFIED'};
     return {...detail,experience:state.query.experience,experienceSource:'detail'};
    }return detail;}catch(e){if(/^DETAIL_.*(MISMATCH|UNPROVEN)/.test(e.message))throw Error('DETAIL_NOT_READY');throw e;}
  }
  const view=observedSearchView(doc,url);
  if(view.keyword!=='AI应用开发工程师'||view.query!=='AI应用开发工程师')throw Error('SEARCH_NOT_SETTLED');
  if(!view.jobs.length&&!view.empty)throw Error('RESULTS_NOT_READY');
  if(tool==='list_jobs'&&c.payload.advance&&JSON.stringify(view.jobs.map(j=>j.key))===JSON.stringify(state.before)){
   const ended=view.empty||all(doc,'.no-more, .load-more, .list-end').some(e=>/没有更多|已显示全部|全部加载完成/.test(clean(e)));
   if(!ended)throw Error('LIST_NOT_ADVANCED');return {...view,exhausted:true};
  }
  return view;
 }
 throw Error('INVALID_SEARCH_ACTION');
}
async function searchActionV3(doc,url,stage,c,state,beforeEffect){
 const q={keyword:c.payload.keyword,city:c.payload.city,experience:c.payload.experience,experienceMode:state.experienceMode??'manual'};
 const auto=q.experienceMode==='auto';
 if(stage==='pointer'){
  if(!auto||!['search_jobs','restore_search'].includes(c.tool)||new URL(url).pathname!=='/web/geek/jobs')throw Error('SCOPE_DENIED');
  return experiencePointerView(doc,q,state,beforeEffect);
 }
 if(stage==='prepare'){
  if(['search_jobs','restore_search'].includes(c.tool)&&new URL(url).pathname.startsWith('/web/geek/chat')){textButton(doc,'职位');return {returnToJobs:true};}
  if(!auto&&doc.querySelector('.condition-filter-select .filter-select-dropdown'))manualExperienceSelection(doc);
  const v=searchView(doc,url,q.city);let preserve=false;try{searchViewV3(doc,url,q);preserve=true;}catch{}
  if(c.tool==='list_jobs'){searchViewV3(doc,url,q);return {before:serialJobs(doc).map(j=>j.key)};}
  return {preserve,queryChanged:!preserve,needKeyword:v.keyword!==q.keyword||v.query!==q.keyword,before:serialJobs(doc).map(j=>j.key)};
 }
 if(stage==='perform'){
  if(state.preserve)return {};
  if(state.returnToJobs){await beforeEffect();textButton(doc,'职位').click();return {};}
  if(c.tool==='list_jobs')return searchAction(doc,url,stage,{...c,version:2,payload:{advance:c.payload.advance}},state,beforeEffect);
  if(state.needKeyword){await beforeEffect();assertPageReady(doc);if(!auto&&doc.querySelector('.condition-filter-select .filter-select-dropdown'))manualExperienceSelection(doc);const input=unique(doc,S.search,'SEARCH_BOX_AMBIGUOUS');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,q.keyword);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));textButton(doc,'搜索').click();return {};}
  if(!auto&&doc.querySelector('.condition-filter-select .filter-select-dropdown'))manualExperienceSelection(doc);
  return auto?{requiresPointer:true}:{};
 }
 if(stage==='observe'){
  if(state.returnToJobs){searchView(doc,url,q.city);return {requiresSearch:true};}
  const keyword=unique(doc,S.search,'SEARCH_BOX_AMBIGUOUS').value;if(keyword!==q.keyword||new URL(url).searchParams.get('query')!==q.keyword)throw Error('SEARCH_NOT_SETTLED');
  let view;try{view=searchViewV3(doc,url,q);}catch(e){if(auto&&['search_jobs','restore_search'].includes(c.tool)&&e.message==='EXPERIENCE_SELECTION_UNVERIFIED')return {requiresFilters:true};throw e;}
  // Empty and reordered old results are not evidence of a completed new query.
  // Without a verified site lifecycle marker, conservatively require new keys.
  if((state.queryChanged||state.needKeyword)&&JSON.stringify(serialJobs(doc).map(j=>j.key).sort())===JSON.stringify([...(state.before??[])].sort()))throw Error('RESULTS_NOT_READY');
  return view;
 }
 throw Error('INVALID_SEARCH_ACTION');
}
