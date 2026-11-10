import {randomUUID} from 'node:crypto';
import {resumeTextSchema} from './schemas.js';
import {hash,redactInput,makeEvidence} from './evidence.js';
import {runStructured,type OperationContext} from './model.js';
import {ROLE_KEYWORDS,EXPERIENCE_BANDS,searchChoiceSchema,searchPlanSchema,type SearchPlan,type SearchQuery} from './search-types.js';
import {SEARCH_PROMPT_VERSION,SEARCH_SYSTEM_PROMPT} from './search-prompts.js';

export function prepareSearchResume(text:unknown){const value=redactInput(resumeTextSchema.parse(text));return {text:value,hash:hash(value),evidence:makeEvidence(value,'resume')};}
export function planDigest(plan:Omit<SearchPlan,'planHash'>|SearchPlan){
 return hash({resumeHash:plan.resumeHash,model:plan.model,promptVersion:plan.promptVersion,roles:plan.roles.map(r=>({roleId:r.roleId,keyword:r.keyword,priority:r.priority,evidenceIds:r.evidenceIds,reason:r.reason})),city:plan.city,experienceBands:plan.experienceBands});
}
export function validateSearchPlan(raw:unknown):SearchPlan{
 const p=searchPlanSchema.parse(raw);const roles=p.roles.map(r=>r.roleId);
 if(new Set(roles).size!==roles.length||roles.includes('java_fullstack')&&roles.includes('fullstack')||p.roles.some((r,i)=>r.keyword!==ROLE_KEYWORDS[r.roleId]||r.priority!==i+1)||p.planHash!==planDigest(p))throw Error('PLAN_INVALID');
 return p;
}
export async function planResumeSearch(resumeText:string,ctx:OperationContext,modelName:string):Promise<SearchPlan>{
 const resume=prepareSearchResume(resumeText);const ids=new Set(resume.evidence.map(e=>e.id));
 const choice=await runStructured({operation:'search_plan',messages:[{role:'system',content:SEARCH_SYSTEM_PROMPT},{role:'user',content:JSON.stringify({resumeEvidence:resume.evidence})}]},searchChoiceSchema,{...ctx,limits:{...ctx.limits,modelTimeoutMs:Math.min(45000,ctx.limits.modelTimeoutMs)}},value=>{
  const roles=value.roles.map(r=>r.roleId);
  if(new Set(roles).size!==roles.length||roles.includes('java_fullstack')&&roles.includes('fullstack')||value.roles.some(r=>r.evidenceIds.some(id=>!ids.has(id))))throw Error('invalid_output');
 });
 const plan={planId:randomUUID(),resumeHash:resume.hash,model:modelName,promptVersion:SEARCH_PROMPT_VERSION,roles:choice.roles.map((r,i)=>({...r,keyword:ROLE_KEYWORDS[r.roleId],priority:i+1})),city:'深圳' as const,experienceBands:[...EXPERIENCE_BANDS] as SearchPlan['experienceBands']};
 return validateSearchPlan({...plan,planHash:planDigest(plan)});
}
export function queriesForPlan(plan:SearchPlan):SearchQuery[]{return validateSearchPlan(plan).roles.flatMap(r=>EXPERIENCE_BANDS.map(experience=>({keyword:r.keyword,city:'深圳' as const,experience})));}
