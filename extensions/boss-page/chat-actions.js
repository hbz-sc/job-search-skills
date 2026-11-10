import {S,all,clean,unique,textButton,assertPageReady} from './selectors.js';
import {detailView,detailRoot} from './search-actions.js';
import {searchViewV3,assertSearchCandidate} from './search-filters.js';
export async function phraseHash(text){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),x=>x.toString(16).padStart(2,'0')).join('');}
export function checkChat(doc,target){
 if(!target)throw Error('CHAT_TARGET_MISSING');
 const candidates=all(doc,S.chat),roots=candidates.filter(e=>!candidates.some(other=>other!==e&&e.contains(other)));if(!roots.length)throw Error('CHAT_NOT_READY');
 if(roots.length!==1)throw Error('CHAT_AMBIGUOUS:matches='+roots.length);const root=roots[0];
 // The user accepts every search-result job, including anonymous headhunters.
 // Job/company labels may change across pages; only keep recipient readiness.
 if(!all(root,S.chatJob+', .top-info-content .position-name').some(e=>clean(e)))throw Error('CHAT_NOT_READY');
 if(!target.recruiter||!all(root,S.chatRecruiter+', .top-info-content .name-text').some(e=>clean(e)===target.recruiter))throw Error('CHAT_TARGET_MISMATCH');
 return root;
}
export function outgoing(root){return all(root,S.messages).map(e=>({text:(e.querySelector('.text-content')||e.querySelector(S.messageText))?.textContent??'',status:clean(e.querySelector(S.messageStatus))}));}
function checkSearchChat(doc,target){
 const root=checkChat(doc,target);const header=unique(doc,'.top-info-content','CHAT_HEADER_AMBIGUOUS');
 if(target.recovered)verifyVisibleChatKey(header,target.conversationKey);
 const title=clean(unique(header,'.position-name','CHAT_JOB_AMBIGUOUS'));const companies=all(header,'.base-info > span:not(.base-title)').map(clean);
 if(title!==target.title||companies.length!==1||!target.company||companies[0]!==target.company)throw Error('CHAT_IDENTITY_MISMATCH');return root;
}
function verifyVisibleChatKey(header,expected){
 const keys=[];
 for(const element of [header,...all(header,'[data-job-id],[data-jobid],a[href*="/job_detail/"]')]){
  for(const name of ['data-job-id','data-jobid']){const key=element.getAttribute(name);if(key)keys.push(key);}
  const href=element.getAttribute('href');if(href){try{const u=new URL(href,'https://www.zhipin.com');const key=u.origin==='https://www.zhipin.com'&&u.pathname.match(/^\/job_detail\/([a-zA-Z0-9_-]+)\.html$/)?.[1];if(key)keys.push(key);}catch{}}
 }
 if(!keys.length||keys.some(k=>k!==expected))throw Error('CHAT_JOB_KEY_UNVERIFIED');
}
async function receiptBaseline(root,receipt){
 if(!receipt||!Number.isSafeInteger(receipt.beforeCount)||receipt.beforeCount<0||receipt.beforeCount>10000||typeof receipt.beforeHash!=='string'||!/^[a-f0-9]{64}$/.test(receipt.beforeHash))throw Error('INVALID_RECEIPT');
 const current=outgoing(root),baseline=current.slice(0,receipt.beforeCount);
 if(baseline.length!==receipt.beforeCount||await phraseHash(JSON.stringify(baseline.map(m=>m.text)))!==receipt.beforeHash)throw Error('SEND_HISTORY_CHANGED');
 return baseline;
}
export function newPhraseStatus(root,baseline,text){
 const now=outgoing(root);if(now.length<=baseline.length||!baseline.every((m,i)=>m.text===now[i]?.text))return 'absent';
 const added=now.slice(baseline.length).filter(m=>m.text===text);if(added.length!==1)return 'unknown';
 if(/发送失败|失败/.test(added[0].status))return 'failed';if(/发送中/.test(added[0].status))return 'pending';return /^(送达|已送达|已读)$/.test(added[0].status)?'confirmed':'pending';
}
export async function chatAction(doc,url,stage,c,state,beforeEffect=async()=>{}){
 assertPageReady(doc);const tool=c.tool;
 if(c.version===3&&tool==='read_saved_phrase'){
  if(new URL(url).pathname!=='/web/geek/chat')throw Error('CURRENT_CHAT_REQUIRED');
  if(stage==='prepare')return {};
  if(stage==='perform'){if(!all(doc,S.phrases).length){await beforeEffect();unique(doc,S.phraseButton,'PHRASE_BUTTON_AMBIGUOUS').click();}return {};}
  if(stage==='observe'){const text=all(doc,S.phrases)[0]?.textContent;if(!text?.trim())throw Error('PHRASE_MENU_EMPTY');return {text,hash:await phraseHash(text)};}
 }
 if(tool==='inspect_chat'&&stage==='prepare'&&!state.chat){
  if(new URL(url).pathname!=='/web/geek/chat')throw Error('CURRENT_CHAT_REQUIRED');
  const header=unique(doc,'.top-info-content','CHAT_HEADER_AMBIGUOUS');
  if(c.version>=3)verifyVisibleChatKey(header,c.payload.conversationKey);
  const companies=all(header,'.base-info > span:not(.base-title)');if(companies.length>1)throw Error('CHAT_COMPANY_AMBIGUOUS');
  const target={conversationKey:c.payload.conversationKey,...(c.version>=3?{recovered:true}:{}),title:clean(unique(header,'.position-name','CHAT_JOB_AMBIGUOUS')),company:clean(companies[0]),recruiter:clean(unique(header,'.name-text','CHAT_RECRUITER_AMBIGUOUS'))};
  if(!target.title||!target.recruiter)throw Error('CHAT_HEADER_EMPTY');
  const root=checkChat(doc,target);return {target:{...target,baseline:outgoing(root)}};
 }
 if(tool==='open_chat'){
  if(stage==='prepare'){
   if(c.version===3){if(!state.query)throw Error('FILTER_UNVERIFIED');assertSearchCandidate(doc,url,state.query,c.payload.jobKey);}
   if(!state.job||state.job.key!==c.payload.jobKey)throw Error('JOB_TARGET_MISSING');
   // The SPA may temporarily remove or replace the detail after open_job.
   // Preparation is read-only: wait for the same stable key, never click a
   // replacement card's recruiter. Leave time for the no-op result to return.
   const deadline=Date.parse(c.context?.deadline);
   const until=Math.min(Date.now()+4000,Number.isFinite(deadline)?deadline-750:Infinity);
   let job;
   while(true){
    assertPageReady(doc);
    try{job=detailView(doc,state.job);break;}catch(e){
     if(!/^(DETAIL_NOT_READY|DETAIL_JOB_MISMATCH|DETAIL_JOB_KEY_MISMATCH|DETAIL_JOB_KEY_UNPROVEN|DETAIL_COMPANY_MISMATCH|DETAIL_COMPANY_UNPROVEN)$/.test(e.message))throw e;
     if(Date.now()>=until)return {unavailable:true,reason:e.message};
     await new Promise(r=>setTimeout(r,Math.min(200,Math.max(1,until-Date.now()))));
    }
   }
   if(!job.recruiter)throw Error('RECRUITER_UNPROVEN');
   const root=detailRoot(doc),label=job.alreadyContacted?'继续沟通':'立即沟通';textButton(root,label);return {target:{...job,conversationKey:job.key},label,...(c.version===3?{query:state.query}:{})};
  }
  if(state.unavailable){
   if(stage==='perform')return {};
   return {status:'unavailable',reason:state.reason};
  }
  if(stage==='perform'){
   await beforeEffect();assertPageReady(doc);
   if(c.version===3)assertSearchCandidate(doc,url,state.query,state.target.key);
   const notice=all(doc,'.chat-block-dialog').at(-1);
   if(notice){
    const message=clean(notice).replace(/\s/g,''),remaining=message.match(/^温馨提示您今天已与\d+位BOSS沟通，还剩(\d+)次沟通机会哦好$/);
    if(!remaining)throw Error('CHAT_NOTICE_UNSUPPORTED');
    if(Number(remaining[1])===0)throw Error('QUOTA_REACHED');
    const buttons=all(notice,'button,a,[role="button"],div,span').filter(e=>!e.children.length&&clean(e)==='好');
    if(buttons.length!==1)throw Error('CHAT_NOTICE_BUTTON_AMBIGUOUS');
    buttons[0].click();return {};
   }
   const job=detailView(doc,state.target);if(job.recruiter!==state.target.recruiter||job.alreadyContacted!==state.target.alreadyContacted)throw Error('RECRUITER_CHANGED');textButton(detailRoot(doc),state.label).click();return {};
  }
  let root;try{root=c.version>=3?checkSearchChat(doc,state.target):checkChat(doc,state.target);}catch(e){if(e.message==='CHAT_TARGET_MISMATCH')throw Error('CHAT_TARGET_NOT_READY');throw e;}return {...state.target,baseline:outgoing(root),existingMessages:outgoing(root).length};
 }
 const target=stage==='prepare'?state.chat:state.target;let root=c.version>=3?checkSearchChat(doc,target):checkChat(doc,target);
 if(target.conversationKey!==c.payload.conversationKey)throw Error('CONVERSATION_MISMATCH');
 if(stage==='prepare'){
  const common={target,phrase:state.phrase,selection:state.selection};
  if(tool==='read_first_phrase')return common;
  if(tool==='inspect_chat')return common;
  if(!state.phrase||state.phrase.hash!==c.payload.expectedHash)throw Error('PHRASE_MISMATCH');
  if(tool==='choose_first_phrase'){
   const first=all(doc,S.phrases)[0];if(!first||await phraseHash(first.textContent??'')!==c.payload.expectedHash)throw Error('FIRST_PHRASE_CHANGED');
   const editor=unique(root,S.editor,'EDITOR_AMBIGUOUS');if(('value' in editor?editor.value:editor.textContent))throw Error('EDITOR_NOT_EMPTY');
   return {...common,baseline:outgoing(root)};
  }
  if(tool==='submit_filled_phrase'){
   if(c.version>=3&&c.payload.receipt)return {...common,baseline:await receiptBaseline(root,c.payload.receipt)};
   if(state.selection?.result.status!=='filled')throw Error('NOT_FILLED');
   return {...common,baseline:state.selection.baseline};
  }
  if(tool==='inspect_send_result')return {...common,baseline:c.version>=3&&c.payload.receipt?await receiptBaseline(root,c.payload.receipt):state.selection?.baseline};
 }
 if(stage==='perform'){
  if(tool==='read_first_phrase'&&!all(doc,S.phrases).length){await beforeEffect();checkChat(doc,target);unique(root,S.phraseButton,'PHRASE_BUTTON_AMBIGUOUS').click();}
  if(tool==='choose_first_phrase'){
   const first=all(doc,S.phrases)[0],raw=first?.textContent??'';if(!first||await phraseHash(raw)!==c.payload.expectedHash)throw Error('FIRST_PHRASE_CHANGED');
   await beforeEffect();assertPageReady(doc);root=c.version>=3?checkSearchChat(doc,target):checkChat(doc,target);
   if(!first.isConnected||all(doc,S.phrases)[0]!==first||first.textContent!==raw)throw Error('FIRST_PHRASE_CHANGED');first.click();
  }
  if(tool==='submit_filled_phrase'){
   await beforeEffect();assertPageReady(doc);root=c.version>=3?checkSearchChat(doc,target):checkChat(doc,target);
   if(c.version>=3&&c.payload.receipt){await receiptBaseline(root,c.payload.receipt);root=checkSearchChat(doc,target);}
   if(c.version>=3&&c.payload.receipt){const current=outgoing(root);if(!state.baseline.every((m,i)=>m.text===current[i]?.text))throw Error('SEND_HISTORY_CHANGED');}
   if(newPhraseStatus(root,state.baseline,state.phrase.text)!=='absent')throw Error('POSSIBLE_PRIOR_SEND');
   const editor=unique(root,S.editor,'EDITOR_AMBIGUOUS');if(('value' in editor?editor.value:editor.textContent)!==state.phrase.text)throw Error('EDITOR_TEXT_CHANGED');
   const send=unique(root,S.send,'SEND_BUTTON_AMBIGUOUS');if(send.disabled||send.getAttribute('aria-disabled')==='true')throw Error('SEND_DISABLED');send.click();
  }
  return {};
 }
 if(stage==='observe'){
  if(tool==='inspect_chat')return {...target,existingMessages:outgoing(root).length};
  if(tool==='read_first_phrase'){const first=all(doc,S.phrases)[0];const text=first?.textContent;if(!text?.trim())throw Error('PHRASE_MENU_EMPTY');return {text,hash:await phraseHash(text)};}
  const status=state.baseline?newPhraseStatus(root,state.baseline,state.phrase.text):'unknown';
  if(tool==='inspect_send_result'){if(!['confirmed','failed','pending'].includes(status))throw Error('SEND_NOT_CONFIRMED:'+status);return {status};}
  const receipt=c.version>=3&&state.baseline?{receipt:{beforeCount:state.baseline.length,beforeHash:await phraseHash(JSON.stringify(state.baseline.map(m=>m.text)))}}:{};
  if(status==='confirmed'||status==='pending'||status==='failed')return {status:'submitted',...receipt};
  const editor=unique(root,S.editor,'EDITOR_AMBIGUOUS');if(tool==='choose_first_phrase'&&status==='absent'&&('value' in editor?editor.value:editor.textContent)===state.phrase.text)return {status:'filled',...receipt};
  throw Error('SELECTION_NOT_OBSERVED');
 }
 throw Error('INVALID_CHAT_ACTION');
}
