import {mkdir,writeFile} from 'node:fs/promises';import path from 'node:path';import {z} from 'zod';import type {BatchStatus,JobResult} from './types.js';
const escape=(s:string)=>s.replace(/[\\`*_{}\[\]<>|]/g,c=>'\\'+c);
export async function exportBatch(batch:BatchStatus,results:JobResult[],root:string){
 z.uuid().parse(batch.batchId);const dir=path.join(root,'output/jobpilot',batch.batchId);await mkdir(dir,{recursive:true});
 const jsonPath=path.join(dir,'report.json'),markdownPath=path.join(dir,'report.md');
 const sections=results.map(r=>[
  `## ${escape(r.jobId)} — ${r.taskStatus}`,
  `任务：${r.threadId}；草稿版本：${r.draftVersion}；审核：${r.review?.decision??'未审核'}`,
  r.analysis?`结论：${r.analysis.recommendation}\n\n${escape(r.analysis.rationale)}`:'暂无有效分析',
  ...(r.analysis?.matches.map(m=>`- 匹配：${escape(m.reason)}（${m.resumeEvidenceIds.map(escape).join('、')}）`)??[]),
  ...(r.analysis?.gaps.map(g=>`- 缺口：${escape(g.reason)}`)??[]),
  ...(r.analysis?.unknowns.map(u=>`- 待确认：${escape(u)}`)??[]),
  r.draft?`沟通草稿：\n\n${escape(r.draft.text)}`:'',r.error?`执行错误：${escape(r.error)}`:'',
  `来源与执行信息：\n\n\`\`\`json\n${JSON.stringify(r.provenance,null,2)}\n\`\`\``
 ].filter(Boolean).join('\n\n'));
 await writeFile(jsonPath,JSON.stringify({batch,results},null,2));await writeFile(markdownPath,['# JobPilot 求职分析报告','草稿仅供人工审核，审核接受不代表已联系招聘方。',...sections].join('\n\n'));return {jsonPath,markdownPath};
}
