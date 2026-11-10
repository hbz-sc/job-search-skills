import type {JobState} from '../state.js';import type {Analysis} from '../types.js';import type {GraphDependencies} from '../graph.js';import {analysisSchema} from '../schemas.js';import {runStructured} from '../model.js';import {PROMPTS} from '../prompts.js';import {validateEvidence,hash} from '../evidence.js';
export function applyRecommendationPolicy(a:Analysis,s:JobState):Analysis{
 if(!s.jobDetail)return {...a,recommendation:'insufficient_information',requirements:[],matches:[],gaps:[],unknowns:[...a.unknowns,'缺少完整岗位正文'],rationale:'岗位信息不足，无法可靠判断。'};
 const cities=s.preferences.hardConstraints.cities;
 if(cities?.length&&s.jobSummary.city&&!cities.includes(s.jobSummary.city))return {...a,recommendation:'not_recommended',rationale:'岗位城市不满足用户明确硬约束。'};
 const min=s.preferences.hardConstraints.minMonthlySalaryCny;
 if(min){const salary=s.jobSummary.salary;const range=salary?.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*[kK]$/);if(range&&Number(range[2])*1000<min)return {...a,recommendation:'not_recommended',rationale:'月薪上限低于用户明确的最低要求。'};if(!range)a={...a,unknowns:[...a.unknowns,'薪资未能可靠解析，需人工确认']};}
 return {...a,gaps:a.gaps.map(g=>({...g,reason:g.reason.startsWith('简历未体现')?g.reason:'简历未体现：'+g.reason}))};
}
export function analyzeNode(deps:GraphDependencies){return async(s:JobState):Promise<JobState>=>{
 const content={profile:s.profile,resumeEvidence:s.resume.evidence,job:s.jobSummary,jobDetail:s.jobDetail??null,preferences:s.preferences};
 const analysis=await runStructured({operation:'analyze',messages:[{role:'system',content:PROMPTS.analyze},{role:'user',content:JSON.stringify(content)}]},analysisSchema,{model:deps.model,store:deps.store,scopeId:s.threadId,operationId:`${s.threadId}:analyze:${hash(content)}`,limits:deps.config.limits},a=>validateEvidence(a,undefined,[...s.resume.evidence,...(s.jobDetail?.evidence??[])]));
 return {...s,analysis:applyRecommendationPolicy(analysis,s)};
};}
