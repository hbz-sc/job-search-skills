import {existsSync,readFileSync} from 'node:fs';
import {parse} from 'csv-parse/sync';
export function canonicalUrl(raw:string):string {try{const u=new URL(raw);if(u.protocol!=='https:'||u.hostname!=='www.zhipin.com'||!/^\/job_detail\/[^/]+\.html$/.test(u.pathname))return '';return u.origin+u.pathname;}catch{return '';}}
export function loadLegacySentJobs(paths:string[]):Set<string>{
 const keys=new Set<string>();
 for(const file of paths){if(!existsSync(file))continue;
  const rows=parse(readFileSync(file,'utf8'),{columns:true,bom:true,skip_empty_lines:true}) as Record<string,string>[];
  for(const r of rows){if(!['user_sent_greeting','resume_sent','awaiting_reply'].includes(r.status))continue;
   if(r.job_id?.trim())keys.add(r.job_id.trim()); const u=canonicalUrl(r.source_url??'');if(u)keys.add(u);
  }
 }
 return keys;
}
