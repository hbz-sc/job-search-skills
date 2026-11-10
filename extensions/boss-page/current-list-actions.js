import {S,all,clean,unique,jobCards,observedSearchCity,assertPageReady} from './selectors.js';
import {searchAction,detailRoot} from './search-actions.js';
import {chatAction,phraseHash} from './chat-actions.js';
const listBusinessKeys=['query','city','experience','degree','salary','industry','scale','stage','position','jobType','areaBusiness','business','district','metro','subway'];
export function safeListUrl(url){
 const u=new URL(url);if(u.origin!=='https://www.zhipin.com'||u.pathname!=='/web/geek/jobs')throw Error('CURRENT_LIST_REQUIRED');
 const safe=new URL(u.origin+u.pathname);for(const key of listBusinessKeys)for(const value of u.searchParams.getAll(key).sort())safe.searchParams.append(key,key!=='query'&&/^\d+(,\d+)+$/.test(value)?value.split(',').sort().join(','):value);return safe.href;
}
export async function currentListView(doc,url){
 assertPageReady(doc);const safe=safeListUrl(url),keyword=unique(doc,S.search,'SEARCH_BOX_AMBIGUOUS').value;
 const city=observedSearchCity(doc,url,'current');
 const filters={cityLabels:[...new Set(all(doc,S.city).map(clean))],controls:all(doc,'.current-select,.filter-select .selected,.condition-filter .selected').map(clean),selectedOptions:[...doc.querySelectorAll('.condition-filter-select .filter-select-dropdown li.active')].map(clean).sort()};
 const fingerprint=await phraseHash(JSON.stringify({url:safe,keyword,city,filters}));
 const jobs=jobCards(doc).map(({element,...job})=>{const labels=all(element,'li,.job-experience,[data-experience]').map(clean).map(t=>t.replace(/[–—]/g,'-').replace(/\s/g,'')).filter(t=>/^\d+-\d+年$|经验不限|应届生|在校生|1年以内|10年以上/.test(t));return {...job,experience:labels.length===1?({'1-3年':'exp_1_3','3-5年':'exp_3_5'}[labels[0]]??null):null};});
 const exhausted=all(doc,S.empty).length>0||all(doc,'.no-more,.load-more,.list-end').some(e=>/没有更多|已显示全部|全部加载完成/.test(clean(e)));
 if(!jobs.length&&!exhausted)throw Error('RESULTS_NOT_READY');
 return {snapshot:{fingerprint,keyword,city,url:safe,filters},jobs,exhausted};
}
export async function assertCurrentList(doc,url,snapshot,key){
 const view=await currentListView(doc,url);if(!snapshot||view.snapshot.fingerprint!==snapshot.fingerprint)throw listConditionsChanged(snapshot,view.snapshot);
 if(key&&!view.jobs.some(j=>j.key===key&&j.experience))throw Error('JOB_EXPERIENCE_CHANGED');return view;
}
export function listConditionsChanged(expected,observed){
 const evidence=s=>s?{fingerprint:s.fingerprint,keyword:s.keyword,city:s.city,filters:s.filters}:null;
 return Object.assign(Error('LIST_CONDITIONS_CHANGED'),{details:{expected:evidence(expected),observed:evidence(observed)}});
}
function currentDetailExperience(doc){
 const labels=all(detailRoot(doc),'.job-limit .text-desc,.job-experience,[data-experience]').map(clean).map(t=>t.replace(/[–—]/g,'-').replace(/\s/g,'')).filter(t=>/^\d+-\d+年$|经验不限|应届生|在校生|1年以内|10年以上/.test(t));
 return labels.length===1?({'1-3年':'exp_1_3','3-5年':'exp_3_5'}[labels[0]]??null):null;
}
export async function currentListAction(doc,url,stage,c,state,beforeEffect=async()=>{}){
 const tool=c.tool,listTools=['inspect_current_list','advance_list','restore_list'];
 if(listTools.includes(tool)){
  const view=state.snapshot?await assertCurrentList(doc,url,state.snapshot):await currentListView(doc,url);
  if(stage==='prepare')return {snapshot:view.snapshot,before:view.jobs.map(j=>j.key)};
  if(stage==='perform'){
   if(tool==='advance_list')return searchAction(doc,url,'perform',{...c,version:2,tool:'list_jobs',payload:{advance:true}},state,async()=>{await beforeEffect();await assertCurrentList(doc,url,state.snapshot);});
   return {};
  }
  if(tool==='advance_list'&&!view.exhausted&&JSON.stringify(view.jobs.map(j=>j.key).sort())===JSON.stringify([...(state.before??[])].sort()))throw Error('LIST_NOT_ADVANCED');
  return view;
 }
 if(['open_job','open_chat'].includes(tool)){
  let view;if(stage!=='observe'||tool==='open_job')view=await assertCurrentList(doc,url,state.snapshot,c.payload.jobKey);
  if(tool==='open_chat'&&stage!=='observe'&&currentDetailExperience(doc)!==view.jobs.find(j=>j.key===c.payload.jobKey)?.experience)throw Error('JOB_EXPERIENCE_CHANGED');
  const fn=tool==='open_job'?searchAction:chatAction;
  const value=await fn(doc,url,stage,c,state,async()=>{await beforeEffect();const fresh=await assertCurrentList(doc,url,state.snapshot,c.payload.jobKey);if(tool==='open_chat'&&currentDetailExperience(doc)!==fresh.jobs.find(j=>j.key===c.payload.jobKey)?.experience)throw Error('JOB_EXPERIENCE_CHANGED');});
  if(tool==='open_job'&&stage==='observe'&&value.status!=='unavailable'){
   const experience=currentDetailExperience(doc);if(!experience||experience!==view.jobs.find(j=>j.key===c.payload.jobKey)?.experience)return {status:'unavailable',reason:'JOB_EXPERIENCE_UNVERIFIED'};
   return {...value,experience,experienceSource:'detail'};
  }
  return stage==='prepare'?{...value,snapshot:state.snapshot}:value;
 }
 return chatAction(doc,url,stage,c,state,beforeEffect);
}
