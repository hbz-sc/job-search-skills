import {prepareInputs} from '../../../src/jobpilot/inputs.js';import type {ModelAdapter} from '../../../src/jobpilot/model.js';
export const demoInput=()=>prepareInputs('使用 Java 和 Spring Boot 开发订单管理服务。',{schemaVersion:1,summaries:[{jobId:'j',title:'Java 工程师',company:'虚构公司',city:'深圳',source:'fixture',capturedAt:'2026-11-01'}],details:[{jobId:'j',description:'要求 Java 和 Spring Boot 开发经验。',source:'fixture',capturedAt:'2026-11-01'}],initialDetailIds:['j']},{});
export function fakeModel(onCall:(operation:string)=>void=()=>{}):ModelAdapter{return {async request(r){
 onCall(r.operation);const input=demoInput();const resumeId=input.resume.evidence[0].id;const jobId=input.jobs.details[0].evidence[0].id;
 if(r.operation==='decide')return {content:'',toolCalls:[{id:'finish',name:'finish_research',args:{reason:'已取得正文'}}]};
 const content=r.operation==='profile'?{facts:[{text:'Java 开发',evidenceIds:[resumeId]}]}:r.operation==='analyze'?{recommendation:'recommended',requirements:[{requirementId:'r1',text:'Java',priority:'must',jobEvidenceIds:[jobId]}],matches:[{requirementId:'r1',resumeEvidenceIds:[resumeId],reason:'有项目证据'}],gaps:[],unknowns:[],rationale:'匹配'}:{text:r.operation==='revise'?'修改后的 Java 沟通草稿':'Java 沟通草稿',evidenceIds:[resumeId]};
 return {content:JSON.stringify(content),toolCalls:[]};
}};}
