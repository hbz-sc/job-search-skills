import type {JobState} from '../state.js';import type {JobResult} from '../types.js';import type {GraphDependencies} from '../graph.js';import {PROMPT_VERSION} from '../prompts.js';
export function stateResult(s:JobState,deps:Pick<GraphDependencies,'config'|'store'>):JobResult{return {
 threadId:s.threadId,batchId:s.batchId,jobId:s.jobId,draftVersion:s.draftVersion??0,taskStatus:s.error?(s.analysis?'partial':'failed'):'completed',analysis:s.analysis,draft:s.draft,review:s.review,error:s.error,
 provenance:{model:s.execution?.model??deps.store.latestResult(s.threadId)?.provenance.model??'unknown-legacy',promptVersion:s.execution?.promptVersion??deps.store.latestResult(s.threadId)?.provenance.promptVersion??'unknown-legacy',schemaVersion:s.schemaVersion,inputHashes:s.inputHashes??{resume:s.resume.hash,job:s.jobDetail?.hash??null},sourceMode:s.jobSummary.source,budget:deps.store.getBudget(s.threadId)}
};}
export function saveResultNode(deps:GraphDependencies){return ({data}:{data:JobState})=>{const result=stateResult(data,deps);deps.store.saveResult(result);return {data:{...data,status:result.taskStatus}};};}
