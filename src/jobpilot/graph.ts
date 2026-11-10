import {StateGraph,START,END,type BaseCheckpointSaver} from '@langchain/langgraph';import {State,type JobState} from './state.js';import type {ModelAdapter} from './model.js';import {errorCode} from './model.js';import type {JobpilotStore} from './store.js';import type {LocalJobSource} from './tools/local-jobs.js';import type {JobpilotConfig} from './config.js';import {researchNodes} from './nodes/research.js';import {analyzeNode} from './nodes/analyze.js';import {draftNode} from './nodes/draft.js';
export {runResearchTool} from './nodes/research.js';export {applyRecommendationPolicy} from './nodes/analyze.js';
import {reviewNode} from './nodes/review.js';import {saveResultNode} from './nodes/save-result.js';
import type {JobpilotEvent} from './events.js';
import {disableExternalTracing} from './privacy.js';import {PROMPT_VERSION} from './prompts.js';
export type GraphDependencies={model:ModelAdapter;store:JobpilotStore;source:LocalJobSource;checkpointer:BaseCheckpointSaver;config:JobpilotConfig;onEvent?:(event:JobpilotEvent)=>void};
export function buildJobGraph(deps:GraphDependencies){
 disableExternalTracing();
 const safe=(fn:(s:JobState)=>Promise<JobState>,node:string)=>async({data}:{data:JobState})=>{data={...data,execution:data.execution??{model:deps.config.model||'test-injected',promptVersion:PROMPT_VERSION}};const start=performance.now();deps.onEvent?.({threadId:data.threadId,node,status:'running'});try{const result=await fn(data);deps.onEvent?.({threadId:data.threadId,node,status:'completed',durationMs:Math.round(performance.now()-start)});return {data:result};}catch(e){deps.onEvent?.({threadId:data.threadId,node,status:'failed',errorCode:errorCode(e)});return {data:{...data,status:data.analysis?'partial' as const:'failed' as const,error:errorCode(e)}};}};
 const research=researchNodes(deps);
 return new StateGraph(State)
  .addNode('decide',safe(research.decide,'decide')).addNode('execute_tool',safe(research.executeTool,'execute_tool'))
  .addNode('analyze',safe(analyzeNode(deps),'analyze')).addNode('draft',safe(draftNode(deps),'draft'))
  .addNode('human_review',reviewNode(deps.config.limits.revisions)).addNode('revise',safe(draftNode(deps,true),'revise')).addNode('save_result',saveResultNode(deps))
  .addEdge(START,'decide')
  .addConditionalEdges('decide',({data})=>data.error?'save_result':data.researchDone?'analyze':'execute_tool',['save_result','analyze','execute_tool'])
  .addConditionalEdges('execute_tool',({data})=>data.error?'save_result':data.researchDone?'analyze':'decide',['save_result','analyze','decide'])
  .addConditionalEdges('analyze',({data})=>!data.error&&['recommended','consider'].includes(data.analysis?.recommendation??'')?'draft':'save_result',['draft','save_result'])
  .addConditionalEdges('draft',({data})=>data.error?'save_result':'human_review',['save_result','human_review'])
  .addConditionalEdges('human_review',({data})=>data.review?.decision==='revise'?'revise':'save_result',['revise','save_result'])
  .addConditionalEdges('revise',({data})=>data.error?'save_result':'human_review',['save_result','human_review'])
  .addEdge('save_result',END).compile({checkpointer:deps.checkpointer});
}
export type JobGraph=ReturnType<typeof buildJobGraph>;
