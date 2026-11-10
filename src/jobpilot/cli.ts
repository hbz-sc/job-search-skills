import {parseArgs} from 'node:util';import {loadEnvFile} from 'node:process';import path from 'node:path';import {fileURLToPath} from 'node:url';import {z} from 'zod';
import {createJobpilotService,type JobpilotService} from './service.js';import {loadJobpilotConfig} from './config.js';import {createModelAdapter} from './model.js';import {loadInputs} from './inputs.js';import {reviewSchema} from './schemas.js';import {exportBatch} from './report.js';import {emitEvent} from './events.js';
import {searchMain} from './search-cli.js';
type CliDependencies={root?:string;env?:Record<string,string|undefined>;loadEnv?:boolean;stdout?:(s:string)=>void;stderr?:(s:string)=>void;service?:JobpilotService};
export async function main(argv=process.argv.slice(2),deps:CliDependencies={}):Promise<number>{
 if(argv[0]==='search')return searchMain(argv.slice(1),{root:deps.root,stdout:deps.stdout,stderr:deps.stderr,loadEnv:deps.loadEnv});
 const root=deps.root??process.cwd(),out=deps.stdout??console.log,err=deps.stderr??console.error;let service=deps.service;
 try{
  if(!argv.length||argv[0]==='--help'){out('JobPilot: analyze --resume file.txt --jobs jobs.json --preferences prefs.json | status --batch id | review --thread id --version n --review-id uuid --decision approve|revise|reject [--feedback text] | resume --thread id | export --batch id | demo');return 0;}
  const command=argv[0];if(!['analyze','status','review','resume','export','demo'].includes(command))throw Error('invalid_input');
  const {values}=parseArgs({args:argv.slice(1),options:Object.fromEntries(['resume','jobs','preferences','batch','thread','version','review-id','decision','feedback'].map(k=>[k,{type:'string' as const}])),strict:true,allowPositionals:false});
  const required=(key:string)=>{const v=values[key];if(typeof v!=='string'||!v)throw Error('invalid_input');return v;};
  const review=command==='review'?reviewSchema.parse({reviewId:required('review-id'),threadId:required('thread'),draftVersion:Number(required('version')),decision:required('decision'),feedback:values.feedback}):undefined;
  if(['status','export'].includes(command))z.uuid().parse(required('batch'));if(command==='resume')z.uuid().parse(required('thread'));
  if(deps.loadEnv!==false&&!deps.env){try{loadEnvFile(path.join(root,'.env'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
  const config=loadJobpilotConfig(deps.env??process.env);
  if(['analyze','demo'].includes(command)&&!service)createModelAdapter(config);
  service??=await createJobpilotService({root,config,onEvent:event=>emitEvent(event,err)});
  let result:unknown;
  if(command==='analyze'||command==='demo'){
   const base=path.join(root,'examples/jobpilot');const input=await loadInputs(command==='demo'?{resume:path.join(base,'resume.txt'),jobs:path.join(base,'jobs.json'),preferences:path.join(base,'preferences.json')}:{resume:path.resolve(root,required('resume')),jobs:path.resolve(root,required('jobs')),preferences:path.resolve(root,required('preferences'))});result=await service.analyze(input);
  }else if(command==='status')result=await service.status(required('batch'));
  else if(command==='resume')result=await service.resume(required('thread'));
  else if(command==='review')result=await service.review(review!);
  else{const {batch,results}=await service.reportData(required('batch'));result=await exportBatch(batch,results,root);}
  out(JSON.stringify(result,null,2));const r=result as {taskStatus?:string;tasks?:{status:string}[]};return r.taskStatus==='failed'||r.taskStatus==='partial'||r.tasks?.some(t=>['failed','partial'].includes(t.status))?1:0;
 }catch(e){const m=e instanceof Error?e.message:'';const invalid=e instanceof z.ZodError||m.startsWith('invalid_input')||(e as NodeJS.ErrnoException).code?.startsWith('ERR_PARSE_ARGS');
  err(JSON.stringify({error:invalid?'invalid_input':['MODEL_CONFIG_REQUIRED','stale_review','revision_limit','review_conflict','pending_review_conflict','incompatible_checkpoint','not_waiting_review'].includes(m)?m:'operation_failed'}));return invalid?2:1;
 }finally{if(service&&!deps.service)await service.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=await main();
