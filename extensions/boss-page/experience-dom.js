import {observedSearchCity,S,all,clean,unique,visible,assertPageReady} from './selectors.js';
const experienceNames={exp_1_3:'1-3年',exp_3_5:'3-5年'};
const experienceOptions=['不限','在校生','应届生','经验不限','1年以内','1-3年','3-5年','5-10年','10年以上'];
const experienceText=e=>clean(e).replace(/[–—]/g,'-').replace(/\s/g,'');
export function experienceRoot(doc){
 const roots=all(doc,'.condition-filter-select').filter(root=>{
  const labels=[...root.querySelectorAll('.filter-select-dropdown li')].map(experienceText);
  return labels.includes('1-3年')&&labels.includes('3-5年');
 });
 if(roots.length!==1||all(roots[0],'.current-select').length!==1)throw Error('EXPERIENCE_CONTROL_AMBIGUOUS');
 return roots[0];
}
export function expectedExperienceLabels(root,query){
 const target=experienceNames[query.experience];if(!target)throw Error('INVALID_SCOPE');
 if(query.experienceMode!=='auto')return [target];
 if(root.querySelector('[aria-multiselectable="true"],input[type="checkbox"],.select-num'))return ['1-3年','3-5年'];
 if(root.querySelector('[aria-multiselectable="false"],input[type="radio"]'))return [target];
 throw Error('EXPERIENCE_CONTROL_UNVERIFIED');
}
export function autoExperienceSelection(doc,query){
 const root=experienceRoot(doc),selection=experienceSelection(root),expected=expectedExperienceLabels(root,query);
 if(!selection.known||selection.labels.length!==expected.length||!expected.every(t=>selection.labels.includes(t)))throw Error('EXPERIENCE_SELECTION_UNVERIFIED');
 return selection.labels;
}
export function experienceSelection(root){
 const label=experienceText(root.querySelector('.current-select'));
 const options=[...root.querySelectorAll('.filter-select-dropdown li')];
 // Semantic selection attributes are authoritative. Site-specific classes must
 // be added only after observation; a decorative check icon proves nothing.
 const marked=options.filter(e=>e.getAttribute('aria-selected')==='true'||e.getAttribute('aria-checked')==='true'||e.querySelector('input[type="checkbox"]:checked,input[type="radio"]:checked'));
 const selected=marked.map(experienceText).filter(t=>experienceOptions.includes(t));
 if(marked.length)return {known:new Set(selected).size===marked.length&&marked.every(e=>experienceOptions.includes(experienceText(e))),labels:[...new Set(selected)]};
 // Observed on BOSS: the control keeps “工作经验” plus a count; selected
 // options carry .active even while the menu is collapsed. Cross-check both.
 const active=options.filter(e=>e.classList.contains('active'));
 const countNodes=root.querySelectorAll('.current-select .select-num');
 if(active.length||countNodes.length||root.classList.contains('is-select')){
  const count=countNodes.length===1?experienceText(countNodes[0]).replace(/^\((\d+)\)$/,'$1'):'';
  const labels=active.map(experienceText);
  const known=root.matches('.condition-filter-select.is-select')&&/^[1-9]\d*$/.test(count)&&Number(count)===active.length&&new Set(labels).size===labels.length&&labels.every(t=>experienceOptions.includes(t)&&t!=='不限');
  return {known,labels:known?labels:[]};
 }
 if(label==='工作经验'||label==='不限')return {known:true,labels:[]};
 const labels=label.split(/[、,，]/);return {known:labels.every(t=>experienceOptions.includes(t)),labels};
}
function experiencePoint(doc,element){
 if(!visible(element))throw Error('EXPERIENCE_TARGET_HIDDEN');
 const r=element.getBoundingClientRect(),w=doc.defaultView.innerWidth,h=doc.defaultView.innerHeight;
 const left=Math.max(0,r.left),right=Math.min(w,r.right),top=Math.max(0,r.top),bottom=Math.min(h,r.bottom);
 if(right-left<2||bottom-top<2)throw Error('EXPERIENCE_TARGET_OFFSCREEN');
 const x=(left+right)/2,y=(top+bottom)/2,hit=doc.elementFromPoint(x,y);
 if(!hit||!(hit===element||element.contains(hit)))throw Error('EXPERIENCE_TARGET_COVERED');
 return {x,y,viewportWidth:w,viewportHeight:h};
}
export async function experiencePointerView(doc,query,state,beforeEffect=async()=>{}){
 if(!['深圳','current'].includes(query.city)||!experienceNames[query.experience]||!['control','option','selection','scroll'].includes(state?.step))throw Error('INVALID_SCOPE');
 assertPageReady(doc);
 if(unique(doc,S.search,'SEARCH_BOX_AMBIGUOUS').value!==query.keyword)throw Error('EXPERIENCE_QUERY_MISMATCH');
 observedSearchCity(doc,doc.location?.href,query.city);
 let root=experienceRoot(doc);const expectedLabel=experienceNames[query.experience];
 if(state.step==='scroll'){
  await beforeEffect();assertPageReady(doc);root=experienceRoot(doc);
  root.querySelector('.current-select').scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
 }
 const selection=experienceSelection(root),menuVisible=all(root,'.filter-select-dropdown').length===1&&all(root,'.filter-select-dropdown li').some(e=>experienceText(e)===expectedLabel);
 const expectedLabels=expectedExperienceLabels(root,{...query,experienceMode:state.experienceMode??query.experienceMode});
 const result={selection,expectedLabel,expectedLabels,menuVisible};
 if(state.step==='control')return {...result,point:experiencePoint(doc,root.querySelector('.current-select'))};
 if(state.step==='option'){
  if(!menuVisible)throw Error('EXPERIENCE_MENU_NOT_OPEN');
  const label=state.label;
  if(!expectedLabels.includes(label)&&!(selection.known&&selection.labels.includes(label)&&experienceOptions.includes(label)))throw Error('INVALID_SCOPE');
  const options=all(root,'.filter-select-dropdown li').filter(e=>experienceText(e)===label);
  if(options.length!==1)throw Error('EXPERIENCE_OPTION_AMBIGUOUS');
  return {...result,label,point:experiencePoint(doc,options[0])};
 }
 return result;
}
