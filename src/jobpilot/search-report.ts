import {mkdir,writeFile} from 'node:fs/promises';import path from 'node:path';import type {SearchStore} from './search-store.js';
export function searchReport(store:SearchStore,batchId:string){
 const batch=store.getBatch(batchId),plan=store.getPlan(batch.planId),attempts=store.attempts(batchId);const counts={confirmed:0,failed:0,uncertain:0,skipped:0};
 for(const a of attempts)if(a.phase==='confirmed')counts.confirmed++;else if(a.phase==='failed')counts.failed++;else if(a.phase==='skipped')counts.skipped++;else counts.uncertain++;
 return {batch,plan,counts,attempts,queries:plan.roles.flatMap(r=>['exp_1_3','exp_3_5'].map(experience=>({keyword:r.keyword,experience}))).map((q,i)=>({...q,...store.getQueryProgress(batchId,i)}))};
}
export async function exportSearchReport(root:string,report:ReturnType<typeof searchReport>){
 const dir=path.join(root,'output/jobpilot/search',report.batch.batchId);await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'report.json'),JSON.stringify(report,null,2));
 const md=`# JobPilot 搜索沟通报告\n\n批次：${report.batch.batchId}\n\n状态：${report.batch.status}；原因：${report.batch.stopReason}\n\n城市：深圳；经验：1–3年 / 3–5年\n\n尝试：${report.batch.usedContacts}/${report.batch.maxContacts}；送达：${report.counts.confirmed}；失败：${report.counts.failed}；未知：${report.counts.uncertain}；已跳过的联系尝试：${report.counts.skipped}\n\n仅发送常用语文字，不代表已上传附件简历。未看到送达证据的记录不计成功。\n\n${report.queries.map(q=>`- ${q.keyword} / ${q.experience}：查看 ${q.seenJobKeys.length} 岗位，${q.exhausted?'查询结束':'未完成或尚未执行'}`).join('\n')}\n`;
 await writeFile(path.join(dir,'report.md'),md);return {json:path.join(dir,'report.json'),markdown:path.join(dir,'report.md')};
}
