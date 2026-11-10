import {createHash} from 'node:crypto';import type {Evidence,Analysis,Draft} from './types.js';
export const hash=(value:unknown)=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export function redactInput(text:string){return text.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'[邮箱已隐藏]').replace(/\b\d{17}[\dXx]\b/g,'[证件已隐藏]').replace(/(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/g,'[电话已隐藏]');}
export function makeEvidence(text:string,source:'resume'|'job'):Evidence[]{const sourceHash=hash(text);return text.split(/\r?\n+/).map(t=>t.trim()).filter(Boolean).map((t,i)=>({id:`${source}:${sourceHash.slice(0,16)}:${i}`,source,text:t,sourceHash}));}
export function validateEvidence(analysis:Analysis,draft:Draft|undefined,evidence:Evidence[]){
 const ids=new Map(evidence.map(e=>[e.id,e.source]));const check=(list:string[],source:'resume'|'job')=>{if(!list.length||list.some(id=>ids.get(id)!==source))throw Error('invalid_output: evidence');};
 const requirements=new Set<string>();for(const r of analysis.requirements){if(requirements.has(r.requirementId))throw Error('invalid_output: duplicate requirement');requirements.add(r.requirementId);check(r.jobEvidenceIds,'job');}
 for(const m of analysis.matches){if(!requirements.has(m.requirementId))throw Error('invalid_output: requirement');check(m.resumeEvidenceIds,'resume');}
 for(const g of analysis.gaps)if(!requirements.has(g.requirementId))throw Error('invalid_output: gap');
 if(draft)check(draft.evidenceIds,'resume');
}
