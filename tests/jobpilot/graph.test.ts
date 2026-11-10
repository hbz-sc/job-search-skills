import {test,expect} from 'vitest';import {MemorySaver} from '@langchain/langgraph';import {prepareInputs} from '../../src/jobpilot/inputs.js';import {LocalJobSource} from '../../src/jobpilot/tools/local-jobs.js';import {openJobpilotStore} from '../../src/jobpilot/store.js';import {loadJobpilotConfig} from '../../src/jobpilot/config.js';import {buildJobGraph,runResearchTool} from '../../src/jobpilot/graph.js';import type {ModelAdapter,ModelRequest} from '../../src/jobpilot/model.js';
export function fixture(initial=true){return prepareInputs('Java 开发经验',{schemaVersion:1,summaries:[{jobId:'j',title:'Java',company:'虚构',source:'fixture',capturedAt:'2026-11-01'}],details:[{jobId:'j',description:'要求 Java 开发经验',source:'fixture',capturedAt:'2026-11-01'}],initialDetailIds:initial?['j']:[]},{});}
test('complete versus missing detail produces zero versus one actual lookup',async()=>{
 for(const initial of [true,false]){
  const input=fixture(initial);const source=new LocalJobSource(input.jobs);let lookups=0;const get=source.getJobDetail.bind(source);source.getJobDetail=async id=>{lookups++;return get(id);};let decisions=0;
  const model:ModelAdapter={async request(r:ModelRequest){if(r.operation==='decide'){const name=!initial&&decisions++===0?'get_job_detail':'finish_research';return {content:'',toolCalls:[{id:'call'+decisions,name,args:name==='get_job_detail'?{jobId:'j'}:{reason:'ready'}}]};}return {content:JSON.stringify({recommendation:'not_recommended',requirements:[],matches:[],gaps:[],unknowns:[],rationale:'不匹配'}),toolCalls:[]};}};
  const store=openJobpilotStore(':memory:');const graph=buildJobGraph({model,store,source,checkpointer:new MemorySaver(),config:loadJobpilotConfig({})});
  const result=await graph.invoke({data:{schemaVersion:1,threadId:'t',batchId:'b',jobId:'j',resume:input.resume,preferences:input.preferences,profile:{facts:[]},jobSummary:input.jobs.summaries[0],jobDetail:initial?input.jobs.details[0]:undefined}}, {configurable:{thread_id:'t'}});
  expect(lookups).toBe(initial?0:1);expect(result.data.analysis?.recommendation).toBe('not_recommended');store.close();
 }
});
test('tool boundary rejects unknown tools and other jobs',async()=>{
 const source=new LocalJobSource(fixture().jobs);
 await expect(runResearchTool('execute_script',{code:'x'},'j',source)).rejects.toThrow();
 await expect(runResearchTool('get_job_detail',{jobId:'other'},'j',source)).rejects.toThrow();
});
