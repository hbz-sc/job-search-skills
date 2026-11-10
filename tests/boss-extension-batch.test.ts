import {it,expect} from 'vitest';
import {openPageWorkflowStore} from '../src/boss-extension/store.js';
import {runWorkflow} from '../src/boss-extension/workflow.js';
const jobs=[{key:'a',title:'AI应用开发工程师',company:'甲',url:'https://www.zhipin.com/job_detail/a.html'},{key:'b',title:'AI应用开发工程师',company:'乙',url:'https://www.zhipin.com/job_detail/b.html'}];
function fake(status='confirmed'){
 const calls:string[]=[];let key='';return {calls,action:async(tool:string,p:any={})=>{calls.push(tool);if(tool==='search_jobs'||tool==='list_jobs'||tool==='restore_search')return {jobs,keyword:'AI应用开发工程师',city:'深圳'};if(tool==='open_job'){key=p.jobKey;return jobs.find(j=>j.key===key);}if(tool==='open_chat')return {conversationKey:key};if(tool==='read_first_phrase')return {text:'第一条',hash:'a'.repeat(64)};if(tool==='choose_first_phrase')return {status:'submitted'};if(tool==='inspect_send_result')return {status};return {};}};
}
it('does not leave a startup blocker when chat fails before any phrase send',async()=>{
 const s=openPageWorkflowStore(':memory:'),c=fake(),base=c.action;c.action=async(t,p={})=>{if(t==='open_chat')throw Error('POSTCONDITION_TIMEOUT:CHAT_TARGET_NOT_READY');return base(t,p);};
 try{const r=await runWorkflow(c,s,{mode:'batch',maxContacts:2},{},true,new AbortController().signal);expect(r.skipped).toBe(1);expect(r.uncertain).toBe(0);expect(s.getBlockers()).toEqual([]);expect(s.shouldSkip('a')).toBe(true);expect(c.calls).not.toContain('choose_first_phrase');}finally{s.close();}
});
it('continues to the next job when detail disappears before communication and never reads a phrase for that job',async()=>{
 const s=openPageWorkflowStore(':memory:'),c=fake(),base=c.action;const reads:string[]=[];
 c.action=async(t,p={})=>{if(t==='open_chat'&&p.jobKey==='a')return {status:'unavailable',reason:'DETAIL_NOT_READY'};if(t==='read_first_phrase')reads.push(p.conversationKey);return base(t,p);};
 try{const r=await runWorkflow(c,s,{mode:'batch',maxContacts:2},{},true,new AbortController().signal);expect(r.confirmed).toBe(1);expect(r.skipped).toBe(1);expect(r.uncertain).toBe(0);expect(r.stopReason).toBe('CONTACT_LIMIT');expect(reads.every(k=>k==='b')).toBe(true);expect(s.getBlockers()).toEqual([]);}finally{s.close();}
});
it('resets send tracking between contacts while retaining prior delivery records',async()=>{
 const s=openPageWorkflowStore(':memory:'),c=fake(),base=c.action;let chats=0;c.action=async(t,p={})=>{if(t==='open_chat'&&++chats===2)throw Error('CHAT_TARGET_NOT_READY');return base(t,p);};
 try{const r=await runWorkflow(c,s,{mode:'batch',maxContacts:2},{},true,new AbortController().signal);expect(r.confirmed).toBe(1);expect(r.skipped).toBe(1);expect(r.uncertain).toBe(0);expect(s.getBlockers()).toEqual([]);}finally{s.close();}
});
it('keeps a send-command timeout unresolved because delivery may have occurred',async()=>{
 const s=openPageWorkflowStore(':memory:'),c=fake(),base=c.action;c.action=async(t,p={})=>{if(t==='choose_first_phrase')throw Error('MCP_TIMEOUT');return base(t,p);};
 try{const r=await runWorkflow(c,s,{mode:'batch',maxContacts:1},{},true,new AbortController().signal);expect(r.uncertain).toBe(1);expect(r.skipped).toBe(0);expect(s.getBlockers()).toContain('UNRESOLVED_CONTACT');}finally{s.close();}
});
it('search-only reads one detail and restores without contact',async()=>{
 const s=openPageWorkflowStore(':memory:'),c=fake();try{const r=await runWorkflow(c,s,{mode:'search_only',maxContacts:0},{},false,new AbortController().signal);expect(r.confirmed).toBe(0);expect(c.calls).toEqual(['search_jobs','open_job','restore_search']);}finally{s.close();}
});
it('refreshes the candidate list after a job disappears without contacting stale cards or using contact budget',async()=>{
 const s=openPageWorkflowStore(':memory:'),c=fake(),base=c.action,opened:string[]=[],contacts:string[]=[];let refreshed=false;
 c.action=async(t,p={})=>{
  if(t==='search_jobs')return {jobs:[jobs[0],{...jobs[0],key:'stale'}],keyword:'AI应用开发工程师',city:'深圳'};
  if(t==='list_jobs'&&p.advance===false){refreshed=true;return {jobs:[jobs[1]],keyword:'AI应用开发工程师',city:'深圳'};}
  if(t==='open_job'){opened.push(p.jobKey);if(p.jobKey==='a')return {status:'unavailable',reason:'JOB_NOT_VISIBLE'};}
  if(t==='open_chat')contacts.push(p.jobKey);
  return base(t,p);
 };
 try{const r=await runWorkflow(c,s,{mode:'batch',maxContacts:1},{},true,new AbortController().signal);expect(refreshed).toBe(true);expect(opened).toEqual(['a','b']);expect(contacts).toEqual(['b']);expect(r.contacted).toBe(1);expect(r.skipped).toBe(1);expect(r.confirmed).toBe(1);expect(s.getBlockers()).toEqual([]);}finally{s.close();}
});
it('does not claim search verification when its selected job disappeared',async()=>{
 const s=openPageWorkflowStore(':memory:'),c=fake(),base=c.action;c.action=async(t,p={})=>t==='open_job'?{status:'unavailable',reason:'JOB_NOT_VISIBLE'}:base(t,p);
 try{const r=await runWorkflow(c,s,{mode:'search_only',maxContacts:0},{},false,new AbortController().signal);expect(r.stopReason).toBe('JOB_LIST_CHANGED');expect(r.skipped).toBe(1);expect(c.calls).not.toContain('open_chat');}finally{s.close();}
});
it('rebuilds traversal from stable keys when a same-tab return resets the list to page one',async()=>{
 const a=jobs[0],b=jobs[1],c={...jobs[1],key:'c'};let current=[a];const contacted:string[]=[];
 const transport={action:async(tool:string,p:any={})=>{
  if(tool==='search_jobs'||tool==='restore_search'){current=[a];return {jobs:current};}
  if(tool==='list_jobs'){current=[b,c];return {jobs:current};}
  if(tool==='open_job'){const j=current.find(j=>j.key===p.jobKey);if(!j)throw Error('JOB_NOT_VISIBLE');return j;}
  if(tool==='open_chat'){contacted.push(p.jobKey);return {conversationKey:p.jobKey};}
  if(tool==='read_first_phrase')return {text:'第一条',hash:'a'.repeat(64)};
  if(tool==='choose_first_phrase')return {status:'submitted'};
  if(tool==='inspect_send_result')return {status:'confirmed'};
 }};
 const s=openPageWorkflowStore(':memory:');try{const r=await runWorkflow(transport,s,{mode:'batch',maxContacts:3},{},true,new AbortController().signal);expect(r.confirmed).toBe(3);expect(contacted).toEqual(['a','b','c']);}finally{s.close();}
});
it('batch stops on no new jobs and never submits an already directly sent phrase',async()=>{
 const s=openPageWorkflowStore(':memory:'),c=fake();try{const r=await runWorkflow(c,s,{mode:'batch',maxContacts:10},{},true,new AbortController().signal);expect(r.confirmed).toBe(2);expect(r.stopReason).toBe('NO_NEW_JOBS');expect(c.calls.filter(x=>x==='open_chat')).toHaveLength(2);expect(c.calls).not.toContain('submit_filled_phrase');}finally{s.close();}
});
it('unknown send blocks the second contact and persists an unresolved attempt',async()=>{
 const s=openPageWorkflowStore(':memory:'),c=fake('unconfirmed');try{const r=await runWorkflow(c,s,{mode:'batch',maxContacts:10},{},true,new AbortController().signal);expect(r.uncertain).toBe(1);expect(c.calls.filter(x=>x==='open_chat')).toHaveLength(1);expect(s.getBlockers()).toContain('UNRESOLVED_CONTACT');}finally{s.close();}
});
it('records explicit failures without retry and continues when authorized',async()=>{
 const s=openPageWorkflowStore(':memory:'),c=fake('failed');try{const r=await runWorkflow(c,s,{mode:'batch',maxContacts:2},{},true,new AbortController().signal,()=>{},undefined,{continueOnSendFailure:true});expect(r.failed).toBe(2);expect(r.confirmed).toBe(0);expect(r.stopReason).toBe('CONTACT_LIMIT');expect(c.calls.filter(x=>x==='choose_first_phrase')).toHaveLength(2);expect(s.getBlockers()).toEqual([]);expect(s.shouldSkip('a')).toBe(true);}finally{s.close();}
});
it('contacts headhunter cards just like other search results',async()=>{
 const s=openPageWorkflowStore(':memory:'),c=fake(),base=c.action;c.action=async(t,p={})=>{const v:any=await base(t,p);return v?.jobs?{...v,jobs:[{...jobs[0],unsupportedChat:true},jobs[1]]}:v;};try{const r=await runWorkflow(c,s,{mode:'batch',maxContacts:1},{},true,new AbortController().signal);expect(r.confirmed).toBe(1);expect(r.skipped).toBe(0);expect(c.calls.filter(x=>x==='open_chat')).toHaveLength(1);}finally{s.close();}
});
it('honors a 50-contact cap even when every confirmed failure is skipped',async()=>{
 const list=Array.from({length:60},(_,i)=>({...jobs[0],key:'job'+i}));const c=fake('failed'),base=c.action;c.action=async(t,p:any={})=>{if(['search_jobs','restore_search','list_jobs'].includes(t))return {jobs:list,keyword:'AI应用开发工程师',city:'深圳'};const v=await base(t,p);return t==='open_job'?list.find(j=>j.key===p.jobKey):v;};
 const s=openPageWorkflowStore(':memory:');try{const r=await runWorkflow(c,s,{mode:'batch',maxContacts:50},{},true,new AbortController().signal,()=>{},undefined,{continueOnSendFailure:true});expect(r.contacted).toBe(50);expect(r.failed).toBe(50);expect(c.calls.filter(x=>x==='open_chat')).toHaveLength(50);}finally{s.close();}
});
it('keeps pending separate from failed when explicitly allowed to continue, without replay',async()=>{
 const s=openPageWorkflowStore(':memory:'),c=fake('pending');try{const r=await runWorkflow(c,s,{mode:'batch',maxContacts:1},{},true,new AbortController().signal,()=>{},undefined,{continueOnPendingSend:true});expect(r.pending).toBe(1);expect(r.failed).toBe(0);expect(r.confirmed).toBe(0);expect(r.stopReason).toBe('CONTACT_LIMIT');expect(c.calls.filter(x=>x==='choose_first_phrase')).toHaveLength(1);expect(s.getBlockers()).toEqual([]);}finally{s.close();}
});
it('waits for the saved first phrase when the next chat initially shows a default phrase',async()=>{
 const s=openPageWorkflowStore(':memory:'),c=fake(),base=c.action;let reads=0;
 c.action=async(t,p={})=>{const v=await base(t,p);if(t==='read_first_phrase'&&++reads===2)return {text:'默认询问简历',hash:'b'.repeat(64)};return v;};
 try{const r=await runWorkflow(c,s,{mode:'batch',maxContacts:2},{},true,new AbortController().signal);expect(r.confirmed).toBe(2);expect(reads).toBeGreaterThanOrEqual(3);expect(c.calls.filter(x=>x==='choose_first_phrase')).toHaveLength(2);}finally{s.close();}
});
it('does not pin a transient default phrase at the start of a batch',async()=>{
 const s=openPageWorkflowStore(':memory:'),c=fake(),base=c.action;let reads=0;let selected='';
 c.action=async(t,p:any={})=>{const v=await base(t,p);if(t==='read_first_phrase'&&++reads===1)return {text:'临时默认短句',hash:'b'.repeat(64)};if(t==='choose_first_phrase')selected=p.expectedHash;return v;};
 try{const r=await runWorkflow(c,s,{mode:'batch',maxContacts:1},{},true,new AbortController().signal);expect(r.confirmed).toBe(1);expect(selected).toBe('a'.repeat(64));}finally{s.close();}
});
