import {Controller} from './controller.js';
import {allowedUrl,validateSender} from './binding.js';
let logChain=Promise.resolve();
function log(stage,metadata){
 logChain=logChain.catch(()=>{}).then(async()=>{
  const meta={};for(const k of ['requestId','tabId','documentId','frameId','code','phase','transitionType','correlation'])if(metadata[k]!==undefined)meta[k]=metadata[k];
  if(metadata.url){try{const u=new URL(metadata.url);meta.url=u.origin+u.pathname;}catch{}}
  const {events=[]}=await chrome.storage.local.get('events');events.push({at:new Date().toISOString(),stage,...meta});
  await chrome.storage.local.set({events:events.slice(-1000)});
 });return logChain;
}
const controller=new Controller(chrome,log);
chrome.runtime.onMessage.addListener((m,sender,respond)=>{
 if(sender.id!==chrome.runtime.id)return;
 if(m?.kind==='authorize_click'){
  if(!validateSender(sender,controller.binding)||!allowedUrl(sender.url)){respond({allowed:false});return;}
  try{respond(controller.workflow.authorizeClick(m.requestId));}catch(e){respond({allowed:false,error:e.message});}return;
 }
 if(m?.kind==='content_event'){
  if(validateSender(sender,controller.binding)&&allowedUrl(sender.url)&&['content_received','dom_read_complete','content_error','content_started','content_exited'].includes(m.stage))void controller.event(m.stage,m.requestId,{documentId:sender.documentId,tabId:sender.tab.id});
  return;
 }
 if(sender.tab||sender.url!==chrome.runtime.getURL('popup.html'))return;
 if(m?.kind==='connect'){controller.connect().then(respond,e=>respond({status:e.message,writeEnabled:false}));return true;}
 if(m?.kind==='status'){respond(controller.snapshot());return;}
 if(m?.kind==='disconnect'){controller.disconnect();respond(controller.snapshot());return;}
 if(m?.kind==='diagnostics'){chrome.storage.local.get('events').then(respond);return true;}
});
chrome.webNavigation.onCommitted.addListener(d=>{void controller.changed('document_changed',d);});
chrome.webNavigation.onHistoryStateUpdated.addListener(d=>{void controller.changed('history_changed',d);});
chrome.tabs.onRemoved.addListener(tabId=>{void controller.changed('tab_removed',{tabId});});
chrome.tabs.onCreated.addListener(tab=>controller.workflow.createdTab(tab));
chrome.tabs.onUpdated.addListener((tabId,change)=>{if(change.status==='loading')void controller.changed('page_loading',{tabId,url:change.url});});
