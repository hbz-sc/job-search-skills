// Bundled after dom-adapter.js by build-boss-extension.mjs; no remote code.
if(globalThis.__bossPageBridgeInstalled?.version!=='0.8.0'){
 const previous=globalThis.__bossPageBridgeInstalled;
 if(previous?.listener)chrome.runtime.onMessage.removeListener(previous.listener);
 if(previous?.onExit)removeEventListener('pagehide',previous.onExit);
 const event=(stage,requestId)=>chrome.runtime.sendMessage({kind:'content_event',stage,requestId}).catch(()=>{});
 event('content_started');
 const onExit=()=>event('content_exited');
 const stoppedRuns=new Map();
 addEventListener('pagehide',onExit);
 const listener=(message,sender,respond)=>{
  if(sender.id!==chrome.runtime.id)return;
  if(message?.kind==='cancel_run'){stoppedRuns.set(message.runId,message.reason==='DOCUMENT_CHANGED'?message.reason:'RUN_STOPPED');respond({stopped:true});return;}
  if(message?.kind==='action'){
   const c=message.command;event('content_received',c?.context?.requestId);
   Promise.resolve().then(()=>{
    validateAction(c);if(!['prepare','perform','observe','pointer'].includes(message.stage)||Date.parse(c.context.deadline)<=Date.now())throw Error('INVALID_OR_EXPIRED_COMMAND');
    if(message.stage==='pointer'&&(c.version!==3||!['search_jobs','restore_search'].includes(c.tool)))throw Error('SCOPE_DENIED');
    const fn=c.version===4?currentListAction:['search_jobs','list_jobs','open_job','restore_search'].includes(c.tool)?searchAction:chatAction;
    const beforeEffect=async()=>{
     const check=()=>{if(stoppedRuns.has(c.context.runId))throw Error(stoppedRuns.get(c.context.runId));if(Date.parse(c.context.deadline)<=Date.now())throw Error('RUN_STOPPED');};
     check();const grant=await chrome.runtime.sendMessage({kind:'authorize_click',requestId:c.context.requestId});check();
     if(!grant?.allowed)throw Error(grant?.error||'CLICK_NOT_AUTHORIZED');
    };
    return fn(document,location.href,message.stage,c,message.state,beforeEffect);
   }).then(value=>respond({value}),e=>respond({error:e.message||'DOM_ACTION_FAILED',...(e.message==='LIST_CONDITIONS_CHANGED'?{details:e.details}:{})}));return true;
  }
  if(message?.kind!=='read')return;
  const c=message.command;
  event('content_received',c?.context?.requestId);
  if(c?.version!==1||c.tool!=='inspect_session'||Object.keys(c.payload||{}).length||Date.parse(c.context?.deadline)<=Date.now()){
   respond({error:'INVALID_OR_EXPIRED_COMMAND'});return;
  }
  Promise.resolve().then(()=>inspectBoss(document,location.href)).then(value=>{event('dom_read_complete',c.context.requestId);respond({value});},()=>{event('content_error',c.context.requestId);respond({error:'DOM_READ_FAILED'});});
  return true;
 };
 chrome.runtime.onMessage.addListener(listener);
 globalThis.__bossPageBridgeInstalled={version:'0.8.0',listener,onExit};
}
