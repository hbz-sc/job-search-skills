import {AIMessage,ToolMessage} from '@langchain/core/messages';import {z} from 'zod';import type {JobState} from '../state.js';import type {GraphDependencies} from '../graph.js';import {runDecision,type ToolSpec} from '../model.js';import {PROMPTS} from '../prompts.js';import {hash} from '../evidence.js';import {withBudget} from '../budget.js';import type {LocalJobSource} from '../tools/local-jobs.js';
export const RESEARCH_TOOLS:ToolSpec[]=[{name:'get_job_detail',description:'Read the current job full description',parameters:{type:'object',properties:{jobId:{type:'string'}},required:['jobId'],additionalProperties:false}},{name:'finish_research',description:'Finish collecting job information',parameters:{type:'object',properties:{reason:{type:'string'}},required:['reason'],additionalProperties:false}}];
export async function runResearchTool(name:string,args:unknown,currentJobId:string,source:LocalJobSource){
 if(name==='finish_research'){const a=z.object({reason:z.string().min(1)}).strict().parse(args);return {status:'finished' as const,reason:a.reason};}
 if(name!=='get_job_detail')throw Error('tool_not_allowed');const a=z.object({jobId:z.string()}).strict().parse(args);if(a.jobId!==currentJobId)throw Error('tool_scope_denied');return source.getJobDetail(a.jobId);
}
export function researchNodes(deps:GraphDependencies){const {model,store,source,config}=deps;return {
 async decide(s:JobState):Promise<JobState>{
  const turn=s.decisionTurns??0;const id=`${s.threadId}:decide:${turn}:${hash(s.toolMessages??[])}`;
  if(!store.hasStep(s.threadId,id)&&store.getOperation(id)===undefined&&store.getBudget(s.threadId).decisionTurns>=config.limits.decisionTurns)return {...s,researchDone:true};
  if(store.getOperation(id)===undefined)store.incrementDecision(s.threadId,id);
  const decision=await runDecision({operation:'decide',messages:[{role:'system',content:PROMPTS.decide},{role:'user',content:JSON.stringify({job:s.jobSummary,detail:s.jobDetail??null})},...(s.toolMessages??[])],tools:RESEARCH_TOOLS},{model,store,scopeId:s.threadId,operationId:id,limits:config.limits});
  return {...s,decision,decisionTurns:turn+1};
 },
 async executeTool(s:JobState):Promise<JobState>{
  const decision=s.decision!;const calls=decision.toolCalls;const messages=[...(s.toolMessages??[])];
  if(!calls.length)return {...s,toolMessages:[...messages,{role:'user',content:'请调用一个允许的工具。'}]};
  const normalized=calls.map((c,i)=>({...c,id:c.id||`turn-${s.decisionTurns}-${i}`,args:c.args&&typeof c.args==='object'?c.args as Record<string,unknown>:{},type:'tool_call' as const}));
  messages.push(new AIMessage({content:decision.content,tool_calls:normalized}));let next={...s};
  for(const call of normalized){let observation:unknown;
   if(calls.length!==1)observation={status:'rejected',message:'only_one_tool_allowed'};
   else if(call.name==='get_job_detail'&&s.jobDetail)observation={status:'rejected',message:'detail_already_available'};
   else try{
    // Validate before consuming the tool/network budget.
    if(call.name==='finish_research'){observation=await runResearchTool(call.name,call.args,s.jobId,source);next.researchDone=true;}
    else{
     if(call.name!=='get_job_detail'||Object.keys(call.args).length!==1||call.args.jobId!==s.jobId)throw Error('tool_scope_denied');
     const id=`${s.threadId}:detail:${s.jobId}`;
     let result;for(;;){try{result=await withBudget(store,config.limits,s.threadId,id,'tool',()=>runResearchTool(call.name,call.args,s.jobId,source));break;}catch(e){if(store.operationAttempts(id)>=2||(e instanceof Error&&e.message==='budget_exceeded'))throw e;}}
     observation=result;if(result.status==='ok')next.jobDetail=result.detail;
    }
   }catch(e){if(e instanceof Error&&e.message==='budget_exceeded')throw e;observation={status:'unavailable',message:'tool_unavailable'};}
   messages.push(new ToolMessage({tool_call_id:call.id,content:JSON.stringify(observation)}));
  }
  return {...next,toolMessages:messages};
 }
};}
