import {parseArgs} from 'node:util';import {loadEnvFile} from 'node:process';import {readFile} from 'node:fs/promises';import path from 'node:path';import {loadJobpilotConfig} from './config.js';import {createSearchService,type SearchService} from './search-service.js';
export type SearchCliDependencies={root?:string;service?:SearchService;stdout?:(s:string)=>void;stderr?:(s:string)=>void;loadEnv?:boolean};
export async function searchMain(argv:string[],deps:SearchCliDependencies={}):Promise<number>{
 const out=deps.stdout??console.log,err=deps.stderr??console.error,root=deps.root??process.cwd();let service=deps.service;
 try{
  const command=argv[0];if(!command||command==='--help'){out('jobpilot search: plan --resume file | template --file file | template-first | preview --plan id | run --plan id --template id [--max-contacts 10] [--retry-historical-quota] | resume --batch id [--retry-historical-quota] | status --batch id | export --batch id');return 0;}
  const allowed:Record<string,string[]>={plan:['resume'],template:['file'],'template-first':[],preview:['plan'],run:['plan','template','max-contacts','retry-historical-quota'],resume:['batch','retry-historical-quota'],status:['batch'],export:['batch']};if(!allowed[command])throw Error('invalid_input');
  const {values}=parseArgs({args:argv.slice(1),strict:true,allowPositionals:false,options:Object.fromEntries(allowed[command].map(k=>[k,{type:k==='retry-historical-quota'?'boolean':'string'}]))});
  const need=(k:string)=>{const v=values[k];if(typeof v!=='string'||!v)throw Error('invalid_input');return v;};
  let max=10;if(command==='run'){max=values['max-contacts']===undefined?10:Number(values['max-contacts']);if(!Number.isSafeInteger(max)||max<1||max>100)throw Error('invalid_input');need('plan');need('template');}
  if(!service){if(deps.loadEnv!==false)try{loadEnvFile(path.join(root,'.env'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}service=await createSearchService({root,config:loadJobpilotConfig(process.env),onEvent:e=>err(JSON.stringify(e))});}
  let result:any;
  if(command==='plan')result=await service.plan(await readFile(path.resolve(root,need('resume')),'utf8'));
  else if(command==='template')result=await service.bindTemplate(need('file'));
  else if(command==='template-first')result=await service.captureFirstTemplate();
  else if(command==='preview')result=await service.preview(need('plan'));
  else if(command==='run')result=await service.run(need('plan'),need('template'),max,values['retry-historical-quota']===true);
  else if(command==='resume')result=await service.resume(need('batch'),values['retry-historical-quota']===true);
  else if(command==='status')result=await service.status(need('batch'));else result=await service.export(need('batch'));
  out(JSON.stringify(result,null,2));return result?.batch?.status==='paused'?1:0;
 }catch(e){const m=e instanceof Error?e.message:'';const invalid=m==='invalid_input'||(e as NodeJS.ErrnoException).code?.startsWith('ERR_PARSE_ARGS');const publicCodes=['MODEL_CONFIG_REQUIRED','TEMPLATE_REQUIRED','FIRST_PHRASE_NOT_VISIBLE','FIRST_PHRASE_CHANGED','DEFAULT_PHRASE_NOT_READY','CONTACT_LIMIT'];err(JSON.stringify({error:invalid?'invalid_input':publicCodes.includes(m)?m:'operation_failed'}));return invalid?2:1;}
 finally{if(service&&!deps.service)await service.close();}
}
