import {loadEnvFile} from 'node:process';
import {loadJobpilotConfig} from '../dist/src/jobpilot/config.js';
import {createModelAdapter} from '../dist/src/jobpilot/model.js';
try{loadEnvFile('.env');}catch(e){if(e.code!=='ENOENT')throw e;}
const model=createModelAdapter(loadJobpilotConfig(process.env));
for(const [name,request] of [
 ['text',{operation:'analyze',messages:[{role:'user',content:'Reply READY'}]}],
 ['tool',{operation:'decide',messages:[{role:'user',content:'Call finish_research with reason ready'}],tools:[{name:'finish_research',description:'Finish research',parameters:{type:'object',properties:{reason:{type:'string'}},required:['reason'],additionalProperties:false}}]}],
 ['json',{operation:'analyze',messages:[{role:'user',content:'Return value 1 as JSON'}],outputSchema:{type:'object',properties:{value:{type:'number'}},required:['value'],additionalProperties:false}}]
]){
 try{const r=await model.request(request,AbortSignal.timeout(45000));const ok=name==='tool'?r.toolCalls.length===1&&r.toolCalls[0].name==='finish_research':name==='json'?JSON.parse(r.content).value===1:r.content.includes('READY');console.log(JSON.stringify({check:name,passed:ok,usage:r.usage}));if(!ok)process.exitCode=1;}catch(e){console.log(JSON.stringify({check:name,passed:false,errorCode:e.status??'request_failed'}));process.exitCode=1;}
}
