import {it,expect} from 'vitest';
import {openPageWorkflowStore} from '../src/boss-extension/store.js';
import {recoverGreeting,proveUnsentRecovery,skipAuditedUnsent} from '../src/boss-extension/recovery.js';
const job={key:'a',title:'AI',company:'甲',url:'https://www.zhipin.com/job_detail/a.html'};
it('archives only audited unsent contact as skipped and retains its deduplication record',()=>{
 const s=openPageWorkflowStore(':memory:');try{
  const r=s.beginRun({mode:'greet_once',maxContacts:1}),id=s.reserveContact(r,job);s.updateAttempt(id,'uncertain');
  const audit={workflow:{runId:r,diagnosticRunId:'d'},diagnostic:{runId:'d',events:[{stage:'mcp_received',tool:'open_chat'}]}};
  skipAuditedUnsent(s,id,audit);expect(s.getAttempt(id)?.phase).toBe('skipped');expect(s.shouldSkip(job.key)).toBe(true);expect(s.getBlockers()).toEqual([]);
  const other=s.reserveContact(r,{...job,key:'b'});s.updateAttempt(other,'uncertain');s.pinPhrase(other,{text:'你好',hash:'a'.repeat(64)});
  expect(()=>skipAuditedUnsent(s,other,audit)).toThrow('RECOVERY_NOT_PROVEN_UNSENT');expect(s.getBlockers()).toContain('UNRESOLVED_CONTACT');
 }finally{s.close();}
});
it('only resumes a recorded failed open-chat with no phrase action, never clears other unresolved contacts',async()=>{
 const s=openPageWorkflowStore(':memory:');try{
 const r=s.beginRun({mode:'greet_once',maxContacts:1}),id=s.reserveContact(r,job);s.updateAttempt(id,'uncertain',{code:'CHAT_AMBIGUOUS:matches=0'});
 const audit={workflow:{runId:r,diagnosticRunId:'d'},diagnostic:{runId:'d',events:[{stage:'mcp_received',tool:'open_chat'},{stage:'mcp_received',tool:'open_job'}]}};
 const attempt=s.getAttempt(id)!;expect(()=>proveUnsentRecovery(attempt,audit)).not.toThrow();
 expect(()=>proveUnsentRecovery(attempt,{...audit,diagnostic:{...audit.diagnostic,events:[...audit.diagnostic.events,{stage:'mcp_received',tool:'choose_first_phrase'}]}})).toThrow('RECOVERY_NOT_PROVEN_UNSENT');
 const calls:string[]=[];const client={action:async(tool:string)=>{calls.push(tool);if(tool==='open_job')return {...job,recruiter:'李',alreadyContacted:true};if(tool==='open_chat')return {...job,recruiter:'李',conversationKey:'a'};if(tool==='read_first_phrase')return {text:'第一条',hash:'a'.repeat(64)};if(tool==='choose_first_phrase')return {status:'submitted'};if(tool==='inspect_send_result')return {status:'confirmed'};return {};}};
 await recoverGreeting(client,s,attempt,audit,{...job,recruiter:'李'},new AbortController().signal);
 expect(calls).toEqual(['restore_search','open_job','open_chat','read_first_phrase','choose_first_phrase','inspect_send_result','restore_search']);expect(s.getAttempt(id)?.phase).toBe('confirmed');
 const other=s.reserveContact(r,{...job,key:'b'});expect(s.getRecoveryBlockers(id)).toContain('UNRESOLVED_CONTACT');expect(s.getAttempt(other)?.phase).toBe('opening');
 }finally{s.close();}
});
it('does not reopen a new contact if the original conversation cannot be proven already opened',async()=>{
 const s=openPageWorkflowStore(':memory:');try{const r=s.beginRun({mode:'greet_once',maxContacts:1}),id=s.reserveContact(r,job);s.updateAttempt(id,'uncertain');const a=s.getAttempt(id)!;
 const audit={workflow:{runId:r,diagnosticRunId:'d'},diagnostic:{runId:'d',events:[{stage:'mcp_received',tool:'open_chat'}]}};const calls:string[]=[];
 await expect(recoverGreeting({action:async(t:string)=>{calls.push(t);return {...job,recruiter:'李',alreadyContacted:false};}},s,a,audit,{...job,recruiter:'李'},new AbortController().signal)).rejects.toThrow('EXISTING_CHAT_NOT_PROVEN');expect(calls).not.toContain('open_chat');
 }finally{s.close();}
});
it('continues a matching current chat without restoring or reopening the job first',async()=>{
 const s=openPageWorkflowStore(':memory:');try{
 const r=s.beginRun({mode:'greet_once',maxContacts:1}),id=s.reserveContact(r,job);s.updateAttempt(id,'uncertain');
 const audit={workflow:{runId:r,diagnosticRunId:'d'},diagnostic:{runId:'d',events:[{stage:'mcp_received',tool:'open_chat'}]}};
 const calls:string[]=[];const client={action:async(t:string)=>{calls.push(t);if(t==='inspect_chat')return {...job,recruiter:'李',conversationKey:'a'};if(t==='read_first_phrase')return {text:'第一条',hash:'a'.repeat(64)};if(t==='choose_first_phrase')return {status:'submitted'};return {status:'confirmed'};}};
 await recoverGreeting(client,s,s.getAttempt(id)!,audit,{...job,recruiter:'李'},new AbortController().signal,()=>{},true);
 expect(calls).toEqual(['inspect_chat','read_first_phrase','choose_first_phrase','inspect_send_result','restore_search']);
 }finally{s.close();}
});
