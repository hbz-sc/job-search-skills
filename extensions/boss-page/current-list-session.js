import {safeListUrl,listConditionsChanged} from './current-list-actions.js';
// Raw destination is captured only from the bound tab and kept in extension storage.
// It is never accepted from a command payload or included in a result/event.
export class CurrentListSession{
 constructor(controller){this.controller=controller;this.original=null;}
 async start(batchId){
  const w=this.controller,b=w.owner.binding,key='current-list:'+batchId;
  this.key=key;this.original=null;
  const saved=(await w.api.storage?.local?.get(key))?.[key];
  if(saved){
   if(saved.sessionId!==b.sessionId||saved.tabId!==b.tabId&&saved.chatTabId!==b.tabId)throw Error('LIST_SESSION_CHANGED');
   safeListUrl(saved.rawUrl);this.original=saved;w.state.snapshot=saved.snapshot;return;
  }
  const tab=await w.api.tabs.get(b.tabId);safeListUrl(tab.url);
  this.original={sessionId:b.sessionId,tabId:b.tabId,documentId:b.documentId,rawUrl:tab.url};
 }
 async save(){if(this.original?.snapshot)await this.controller.api.storage?.local?.set({[this.key]:this.original});}
 async observe(value){
  if(!value.snapshot)throw Error('LIST_SNAPSHOT_MISSING');
  if(this.original.snapshot&&value.snapshot.fingerprint!==this.original.snapshot.fingerprint)throw listConditionsChanged(this.original.snapshot,value.snapshot);
  this.original.snapshot??=value.snapshot;this.controller.state.snapshot=this.original.snapshot;await this.save();
 }
 async restore(c,check){
  const w=this.controller,o=this.original;if(!o?.snapshot)throw Error('ORIGINAL_LIST_MISSING');
  safeListUrl(o.rawUrl);check();const tab=await w.api.tabs.get(o.tabId).catch(()=>null);check();
  if(!tab)throw Error('LIST_PAGE_UNAVAILABLE');
  const u=new URL(tab.url);if(u.origin!=='https://www.zhipin.com'||!['/web/geek/jobs','/web/geek/chat'].includes(u.pathname))throw Error('LIST_PAGE_UNAVAILABLE');
  w.navigation={tool:'restore_list',sourceTab:o.tabId,until:Date.parse(c.context.deadline)};
  try{
   // Reuse the original list tab when it survived. Same-tab chat navigates only
   // to the original internally captured destination, then verifies all filters.
   await w.api.tabs.update(o.tabId,{active:true,...(u.pathname==='/web/geek/chat'?{url:o.rawUrl}:{})});
   const end=Math.min(Date.now()+15000,Date.parse(c.context.deadline));
   while(Date.now()<end){check();const frame=await w.api.webNavigation.getFrame({tabId:o.tabId,frameId:0});
    if(frame?.url&&new URL(frame.url).pathname==='/web/geek/jobs'){safeListUrl(frame.url);await w.adopt(o.tabId);c.context.binding=w.owner.binding;return;}
    await new Promise(r=>setTimeout(r,100));
   }
   throw Error('LIST_RESTORE_TIMEOUT');
  }finally{w.navigation=null;}
 }
}
