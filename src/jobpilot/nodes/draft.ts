import type {JobState} from '../state.js';import type {GraphDependencies} from '../graph.js';import {draftSchema} from '../schemas.js';import {runStructured} from '../model.js';import {PROMPTS} from '../prompts.js';import {validateEvidence,hash} from '../evidence.js';
export function draftNode(deps:GraphDependencies,revise=false){return async(s:JobState):Promise<JobState>=>{
 const content={job:s.jobSummary,analysis:s.analysis,resumeEvidence:s.resume.evidence,previousDraft:revise?s.draft:undefined,feedback:revise?s.review?.feedback:undefined};
 const id=`${s.threadId}:${revise?'revise':'draft'}:${s.draftVersion??0}:${hash(content)}`;
 if(revise&&deps.store.getOperation(id)===undefined)deps.store.incrementRevision(s.threadId,id);
 const draft=await runStructured({operation:revise?'revise':'draft',messages:[{role:'system',content:revise?PROMPTS.revise:PROMPTS.draft},{role:'user',content:JSON.stringify(content)}]},draftSchema,{model:deps.model,store:deps.store,scopeId:s.threadId,operationId:id,limits:deps.config.limits},d=>validateEvidence(s.analysis!,d,[...s.resume.evidence,...(s.jobDetail?.evidence??[])]));
 return {...s,draft,draftVersion:(s.draftVersion??0)+1,revisionCount:deps.store.getBudget(s.threadId).revisionCount};
};}
