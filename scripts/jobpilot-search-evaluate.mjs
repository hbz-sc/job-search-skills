import {loadEnvFile} from 'node:process';
import {readFile,mkdir,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {loadJobpilotConfig} from '../dist/src/jobpilot/config.js';
import {createModelAdapter} from '../dist/src/jobpilot/model.js';
import {createSearchService} from '../dist/src/jobpilot/search-service.js';
import {SEARCH_PROMPT_VERSION} from '../dist/src/jobpilot/search-prompts.js';
try{loadEnvFile('.env');}catch(e){if(e.code!=='ENOENT')throw e;}
const cases=JSON.parse(await readFile('tests/fixtures/jobpilot/search-evaluation.json','utf8'));
const config=loadJobpilotConfig(process.env),adapter=createModelAdapter(config);
const root=await mkdtemp(path.join(tmpdir(),'jobpilot-search-eval-'));
const output=path.resolve('output/jobpilot/search-evaluation',new Date().toISOString().replaceAll(':','-'));
await mkdir(output,{recursive:true});let calls=0;
const service=await createSearchService({root,config,model:{request(req,signal){calls++;return adapter.request(req,signal);}}});
const results=[];
try{for(const c of cases){calls=0;const start=Date.now();try{
 const plan=await service.plan(c.resume),roles=plan.roles.map(r=>r.roleId);
 const checks={allowed:roles.every(r=>c.allowed.includes(r)),required:c.required.every(r=>roles.includes(r)),boundedCalls:calls<=2};
 results.push({id:c.id,calls,elapsedMs:Date.now()-start,plan,checks,humanReview:null});
 console.log(JSON.stringify({id:c.id,calls,roles,checks}));
 }catch(e){const code=/^[a-z_]+$/.test(e.message)?e.message:'evaluation_failed';results.push({id:c.id,calls,error:code,humanReview:null});console.log(JSON.stringify({id:c.id,calls,error:code}));}
 await writeFile(path.join(output,'results.json'),JSON.stringify({date:new Date().toISOString(),model:config.model,promptVersion:SEARCH_PROMPT_VERSION,results},null,2));
}}finally{await service.close();}
console.log(JSON.stringify({output,caseCount:results.length,humanReview:'pending'}));
