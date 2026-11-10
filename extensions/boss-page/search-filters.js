import {observedSearchCity,S,all,clean,unique,jobCards,serialJobs,assertPageReady} from './selectors.js';
import {experienceRoot,experienceSelection,autoExperienceSelection} from './experience-dom.js';
const experienceLabels={exp_1_3:'1-3年',exp_3_5:'3-5年'};
const normalizeExperience=text=>text.replace(/[–—]/g,'-').replace(/\s/g,'');
export function manualExperienceSelection(doc){
 const root=experienceRoot(doc),options=[...root.querySelectorAll('.filter-select-dropdown li')];
 const labels=options.filter(e=>e.classList.contains('active')).map(e=>normalizeExperience(clean(e)));
 if(!root.classList.contains('is-select')||!['1-3年','3-5年'].every(t=>labels.includes(t))||new Set(labels).size!==labels.length||labels.some(t=>!['不限','在校生','应届生','经验不限','1年以内','1-3年','3-5年','5-10年','10年以上'].includes(t)))throw Error('MANUAL_EXPERIENCE_REQUIRED');
 return labels;
}
function experienceControl(doc){
 const found=all(doc,'.current-select').filter(e=>{const t=normalizeExperience(clean(e));return t.includes('工作经验')||Object.values(experienceLabels).includes(t);});
 if(found.length!==1)throw Error('FILTER_UNVERIFIED');return found[0];
}
export function readSearchFilters(doc,city='深圳',url=doc.location?.href){
 const keyword=unique(doc,S.search,'SEARCH_BOX_AMBIGUOUS').value;
 const observedCity=observedSearchCity(doc,url,city);
 let label=normalizeExperience(clean(experienceControl(doc)));
 if(doc.querySelector('.condition-filter-select .filter-select-dropdown')){
  const selection=experienceSelection(experienceRoot(doc));
  label=selection.known?selection.labels.join('、'):'unverified';
 }
 const experience=Object.keys(experienceLabels).find(k=>experienceLabels[k]===label)??null;
 return {keyword,city:observedCity,experience,evidence:{keyword,city:observedCity,experience:label,results:''}};
}
export async function setSearchFilters(doc,query,beforeEffect=async()=>{}){
 if(!['深圳','current'].includes(query.city)||!experienceLabels[query.experience])throw Error('INVALID_SCOPE');
 for(let step=0;step<4;step++){
  assertPageReady(doc);const current=readSearchFilters(doc,query.city);if(current.experience===query.experience)return;
  const control=experienceControl(doc);let root=control.parentElement;let options=[];
  for(let depth=0;root&&depth<3;depth++,root=root.parentElement){
   if(all(root,'.current-select').length!==1)break;
   // Live BOSS markup: each dropdown li contains an empty ui-icon-check child.
   options=all(root,'.filter-select-dropdown li').filter(e=>normalizeExperience(clean(e))===experienceLabels[query.experience]);
   if(!options.length)options=all(root,'span,a,li,div,button').filter(e=>!e.children.length&&normalizeExperience(clean(e))===experienceLabels[query.experience]);
   if(options.length)break;
  }
  if(options.length>1)throw Error('FILTER_UNVERIFIED');
  await beforeEffect();assertPageReady(doc);
  if(options.length===1){if(!options[0].isConnected||normalizeExperience(clean(options[0]))!==experienceLabels[query.experience])throw Error('FILTER_UNVERIFIED');options[0].click();}
  else control.click();
  await new Promise(r=>setTimeout(r,150));
 }
 if(readSearchFilters(doc,query.city).experience!==query.experience)throw Error('FILTER_UNVERIFIED');
}
export function searchViewV3(doc,url,query){
 const city=observedSearchCity(doc,url,query.city);
 if(query.experienceMode==='auto')autoExperienceSelection(doc,query);
 if(doc.querySelector('.condition-filter-select .filter-select-dropdown')){
  assertPageReady(doc);const selected=query.experienceMode==='auto'?autoExperienceSelection(doc,query):manualExperienceSelection(doc),keyword=unique(doc,S.search,'SEARCH_BOX_AMBIGUOUS').value;
  if(keyword!==query.keyword||new URL(url).searchParams.get('query')!==query.keyword||!['深圳','current'].includes(query.city)||!experienceLabels[query.experience])throw Error('FILTER_UNVERIFIED');
  const cards=jobCards(doc),empty=all(doc,S.empty).length>0;if(!cards.length&&!empty)throw Error('RESULTS_NOT_READY');
  const keys=new Set();for(const card of cards){const labels=all(card.element,'li').map(e=>normalizeExperience(clean(e))).filter(t=>/^\d+-\d+年$|经验不限|应届生|在校生|1年以内|10年以上/.test(t));if(labels.length!==1||!selected.includes(labels[0]))throw Error('RESULTS_NOT_READY');if(labels[0]===experienceLabels[query.experience])keys.add(card.key);}
  return {observedKeyword:keyword,observedCity:city,observedExperience:query.experience,filterEvidence:{keyword,city,experience:`${query.experienceMode==='auto'?'auto':'manual'}:${selected.join('、')};candidate:${experienceLabels[query.experience]}`,results:empty?'visible-empty-result':`visible-cards:${cards.map(c=>c.key).join(',')}`},jobs:serialJobs(doc).filter(j=>keys.has(j.key)),exhausted:empty||all(doc,'.no-more, .load-more, .list-end').some(e=>/没有更多|已显示全部|全部加载完成/.test(clean(e)))};
 }
 assertPageReady(doc);const f=readSearchFilters(doc,query.city,url),u=new URL(url);
 if(f.keyword!==query.keyword||u.searchParams.get('query')!==query.keyword||query.city!=='current'&&f.city!==query.city||f.experience!==query.experience)throw Error('FILTER_UNVERIFIED');
 const cards=jobCards(doc),empty=all(doc,S.empty).length>0;
 if(!cards.length&&!empty)throw Error('RESULTS_NOT_READY');
 // The card's visible experience is an additional guard against stale results.
 for(const card of cards){const labels=all(card.element,'li').map(e=>normalizeExperience(clean(e))).filter(t=>/^\d+-\d+年$|经验不限|应届生|在校生/.test(t));if(labels.length!==1||labels[0]!==experienceLabels[query.experience])throw Error('RESULTS_NOT_READY');}
 return {observedKeyword:f.keyword,observedCity:f.city,observedExperience:f.experience,filterEvidence:{...f.evidence,results:empty?'visible-empty-result':`visible-cards:${cards.map(c=>c.key).join(',')}`},jobs:serialJobs(doc),exhausted:empty||all(doc,'.no-more, .load-more, .list-end').some(e=>/没有更多|已显示全部|全部加载完成/.test(clean(e)))};
}
export function assertSearchCandidate(doc,url,query,key){
 if(!query||!searchViewV3(doc,url,query).jobs.some(j=>j.key===key))throw Error('JOB_EXPERIENCE_CHANGED');
}
