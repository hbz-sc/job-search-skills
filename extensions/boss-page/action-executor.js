// Fixed business actions only. No caller-provided selectors, URLs, or scripts.
export const actionFields={search_jobs:['city','keyword'],list_jobs:['advance'],open_job:['jobKey'],restore_search:[],open_chat:['jobKey'],inspect_chat:['conversationKey'],read_first_phrase:['conversationKey'],choose_first_phrase:['conversationKey','expectedHash'],submit_filled_phrase:['conversationKey','expectedHash'],inspect_send_result:['conversationKey','expectedHash']};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const searchKeywords=['Java开发工程师','Java全栈开发工程师','全栈开发工程师','AI应用开发工程师','Agent应用开发工程师'];
const searchFields={...actionFields,read_saved_phrase:[],search_jobs:['city','keyword','experience'],restore_search:['city','keyword','experience'],list_jobs:['city','keyword','experience','advance']};
const currentListFields={inspect_current_list:[],advance_list:[],restore_list:[],open_job:['jobKey'],open_chat:['jobKey'],inspect_chat:['conversationKey'],read_first_phrase:['conversationKey'],bind_phrase:['conversationKey','expectedHash','observationRequestId'],choose_first_phrase:['conversationKey','expectedHash'],submit_filled_phrase:['conversationKey','expectedHash'],inspect_send_result:['conversationKey','expectedHash']};
export function validateCurrentListScope(s){
 if(!exact(s,['mode','batchId','maxContacts'])||!['preview','run'].includes(s.mode)||typeof s.batchId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(s.batchId)||!Number.isSafeInteger(s.maxContacts)||s.maxContacts<0||s.maxContacts>150||s.mode==='preview'&&s.maxContacts!==0)throw Error('INVALID_SCOPE');return s;
}
export function validateSearchScope(s){
 if(!exact(s,['mode','batchId','planHash','allowedKeywords','city','experienceBands','maxContacts','expectedPhraseHash',...(Object.hasOwn(s,'experienceMode')?['experienceMode']:[])])||s.experienceMode!==undefined&&!['manual','auto'].includes(s.experienceMode)||!['preview','run'].includes(s.mode)||!Number.isSafeInteger(s.maxContacts)||s.maxContacts<0||s.maxContacts>150||!['深圳','current'].includes(s.city)||!Array.isArray(s.allowedKeywords)||s.allowedKeywords.length<1||s.allowedKeywords.length>4||new Set(s.allowedKeywords).size!==s.allowedKeywords.length||s.allowedKeywords.some(k=>!searchKeywords.includes(k))||JSON.stringify(s.experienceBands)!=='["exp_1_3","exp_3_5"]'||typeof s.batchId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(s.batchId)||typeof s.planHash!=='string'||!/^[a-f0-9]{64}$/.test(s.planHash)||s.expectedPhraseHash!==null&&(typeof s.expectedPhraseHash!=='string'||!/^[a-f0-9]{64}$/.test(s.expectedPhraseHash))||s.mode==='preview'&&s.maxContacts!==0||s.mode==='run'&&s.expectedPhraseHash===null)throw Error('INVALID_SCOPE');return s;
}
export function validateAction(c){
 if(!exact(c,['version','tool','context','payload'])||![2,3,4].includes(c.version)||!Object.hasOwn(c.version===4?currentListFields:c.version===3?searchFields:actionFields,c.tool))throw Error('INVALID_COMMAND');
 const x=c.context;if(!exact(x,['runId','requestId','binding','deadline','leaseId']))throw Error('INVALID_CONTEXT');
 for(const k of ['runId','requestId','leaseId'])if(typeof x[k]!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(x[k]))throw Error('INVALID_ID');
 const b=x.binding;if(!exact(b,['sessionId','tabId','frameId','documentId'])||typeof b.sessionId!=='string'||!b.sessionId||!Number.isSafeInteger(b.tabId)||b.tabId<0||b.frameId!==0||typeof b.documentId!=='string'||!b.documentId)throw Error('INVALID_BINDING');
 if(typeof x.deadline!=='string'||!Number.isFinite(Date.parse(x.deadline)))throw Error('INVALID_DEADLINE');
 const receiptAllowed=c.version>=3&&['submit_filled_phrase','inspect_send_result'].includes(c.tool)&&Object.hasOwn(c.payload,'receipt');
 if(!exact(c.payload,[...(c.version===4?currentListFields:c.version===3?searchFields:actionFields)[c.tool],...(receiptAllowed?['receipt']:[])]))throw Error('INVALID_PAYLOAD');
 if(receiptAllowed){const r=c.payload.receipt;if(!exact(r,['beforeCount','beforeHash'])||!Number.isSafeInteger(r.beforeCount)||r.beforeCount<0||r.beforeCount>10000||typeof r.beforeHash!=='string'||!/^[a-f0-9]{64}$/.test(r.beforeHash))throw Error('INVALID_RECEIPT');}
 for(const [k,v] of Object.entries(c.payload)){
  if(k==='city'&&!(v==='深圳'||c.version===3&&v==='current')||k==='keyword'&&!(c.version===3?searchKeywords.includes(v):v==='AI应用开发工程师')||k==='advance'&&typeof v!=='boolean'||k==='experience'&&!['exp_1_3','exp_3_5'].includes(v))throw Error('INVALID_SCOPE');
  if(['jobKey','conversationKey'].includes(k)&&(typeof v!=='string'||!/^[a-zA-Z0-9_-]{1,200}$/.test(v)))throw Error('INVALID_TARGET');
  if(k==='observationRequestId'&&(typeof v!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(v)))throw Error('INVALID_ID');
  if(k==='expectedHash'&&(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v)))throw Error('INVALID_HASH');
 }
 return c;
}
export function validateScope(s){
 if(!exact(s,['mode','maxContacts'])||!['search_only','greet_once','batch'].includes(s.mode)||!Number.isSafeInteger(s.maxContacts)||s.maxContacts<0||s.maxContacts>1000||s.mode==='search_only'&&s.maxContacts!==0||s.mode==='greet_once'&&s.maxContacts!==1||s.mode==='batch'&&s.maxContacts<1)throw Error('INVALID_SCOPE');return s;
}
export class ActionExecutor{
 constructor(journal,now=()=>performance.now()){this.journal=journal;this.now=now;this.run=null;this.busy=false;this.stopped=new Set();this.stopReasons=new Map();}
 start(runId,leaseId,scope,binding,version=2){
  (version===4?validateCurrentListScope:version===3?validateSearchScope:validateScope)(scope);if(this.stopped.has(runId)||this.run||this.busy)throw Error('RUN_BUSY_OR_STOPPED');
  this.run={runId,leaseId,version,scope:structuredClone(scope),binding:structuredClone(binding),expires:this.now()+30000,contacts:0};
 }
 check(runId,leaseId){const r=this.run;if(!r||this.stopped.has(runId)||r.runId!==runId||r.leaseId!==leaseId)throw Error(this.stopReasons.get(runId)||'RUN_STOPPED');if(this.now()>=r.expires)throw Error('LEASE_EXPIRED');return r;}
 renew(runId,leaseId){this.check(runId,leaseId).expires=this.now()+30000;}
 stop(runId,reason='RUN_STOPPED'){this.stopped.add(runId);this.stopReasons.set(runId,reason==='DOCUMENT_CHANGED'?reason:'RUN_STOPPED');if(this.run?.runId===runId)this.run=null;}
 rebind(binding){if(this.run)this.run.binding=structuredClone(binding);}
 assert(c){const r=this.check(c.context.runId,c.context.leaseId);if(c.version!==r.version)throw Error('VERSION_MISMATCH');if(JSON.stringify(r.binding)!==JSON.stringify(c.context.binding))throw Error('BINDING_CHANGED');if(Date.parse(c.context.deadline)<=Date.now())throw Error('DEADLINE_EXPIRED');return r;}
 async execute(raw,perform){
  const c=validateAction(raw),id=c.context.requestId,fingerprint=JSON.stringify(c);if(this.busy)throw Error('ACTION_BUSY');
  this.busy=true;try{
   const previous=await this.journal.get(id);
   if(previous){if(previous.fingerprint!==fingerprint)throw Error('REQUEST_ID_CONFLICT');return previous.result||{requestId:id,phase:'uncertain',error:{code:'RESULT_UNKNOWN',message:'Do not replay'},evidenceIds:[]};}
   const r=this.assert(c);if(c.version!==4&&['search_only','preview'].includes(r.scope.mode)&&!['search_jobs','list_jobs','open_job','restore_search',...(c.version===3?['read_saved_phrase']:[])].includes(c.tool))throw Error('SCOPE_DENIED');
   if(c.version===3&&((c.payload.city&&c.payload.city!==r.scope.city)||(c.payload.keyword&&!r.scope.allowedKeywords.includes(c.payload.keyword))||(c.payload.experience&&!r.scope.experienceBands.includes(c.payload.experience))||(c.payload.expectedHash&&c.payload.expectedHash!==r.scope.expectedPhraseHash)))throw Error('SCOPE_DENIED');
   if(c.version===4){
    if(r.scope.maxContacts===0&&['choose_first_phrase','submit_filled_phrase'].includes(c.tool))throw Error('SCOPE_DENIED');
    if(r.scope.mode==='preview'&&!['inspect_current_list','advance_list','restore_list','open_job'].includes(c.tool))throw Error('SCOPE_DENIED');
    if(['choose_first_phrase','submit_filled_phrase','inspect_send_result'].includes(c.tool)&&!r.phraseHash)throw Error('PHRASE_NOT_BOUND');
    if(c.payload.expectedHash&&r.phraseHash&&c.payload.expectedHash!==r.phraseHash)throw Error('PHRASE_MISMATCH');
    if(c.tool==='open_chat'&&!r.phraseHash&&r.contacts>0)throw Error('BOOTSTRAP_CHAT_LIMIT');
    if(c.tool==='open_chat'&&r.pendingChat)throw Error('CHAT_UNRESOLVED');
    if(['choose_first_phrase','submit_filled_phrase'].includes(c.tool)&&r.sendOperations?.has(c.tool+':'+c.payload.conversationKey))throw Error('POSSIBLE_PRIOR_SEND');
    if(c.tool==='bind_phrase'&&(!r.observation||r.observation.requestId!==c.payload.observationRequestId||r.observation.conversationKey!==c.payload.conversationKey||r.observation.hash!==c.payload.expectedHash))throw Error('PHRASE_OBSERVATION_MISMATCH');
   }
   if(c.tool==='open_chat'&&r.contacts>=r.scope.maxContacts)throw Error('CONTACT_LIMIT');
   await this.journal.put(id,{fingerprint,phase:'executing'});this.assert(c);
   if(c.tool==='open_chat'){r.contacts++;if(c.version===4)r.pendingChat=c.payload.jobKey;}
   if(c.version===4&&['choose_first_phrase','submit_filled_phrase'].includes(c.tool)){r.sendOperations??=new Set();r.sendOperations.add(c.tool+':'+c.payload.conversationKey);}
   let result;
   try{const value=c.version===4&&c.tool==='bind_phrase'?{hash:(r.phraseHash=c.payload.expectedHash),binding:r.binding}:await perform(c,()=>this.assert(c));
    if(c.version===4){
     if(c.tool==='read_first_phrase'){if(typeof value.hash!=='string'||!/^[a-f0-9]{64}$/.test(value.hash)||!value.text?.trim())throw Error('PHRASE_MENU_EMPTY');r.observation={requestId:id,conversationKey:c.payload.conversationKey,hash:value.hash};}
     if(c.tool==='open_chat'&&value.status==='unavailable')r.pendingChat=null;
     if(c.tool==='inspect_send_result'&&['confirmed','failed'].includes(value.status))r.pendingChat=null;
    }
    result={requestId:id,phase:'observed',value,evidenceIds:[]};}
   catch(e){result={requestId:id,phase:'uncertain',error:{code:e.message||'ACTION_FAILED',message:e.message||'ACTION_FAILED',...(e.message==='LIST_CONDITIONS_CHANGED'?{details:e.details}:{})},evidenceIds:[]};this.stop(c.context.runId);}
   await this.journal.put(id,{fingerprint,phase:result.phase,result});return result;
  }finally{this.busy=false;}
 }
}
