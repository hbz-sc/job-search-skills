import path from 'node:path';import {randomUUID} from 'node:crypto';import {z} from 'zod';import {Command,type BaseCheckpointSaver} from '@langchain/langgraph';
import {acquireRunLock} from '../run-lock.js';import {openCheckpointer} from './checkpointer.js';import {openJobpilotStore,type JobpilotStore,type TaskRow} from './store.js';import {loadJobpilotConfig,type JobpilotConfig} from './config.js';import {createModelAdapter,runStructured,errorCode,type ModelAdapter} from './model.js';import {freezeInputs,readSnapshot,prepareInputs} from './inputs.js';import {hash} from './evidence.js';import {profileSchema,reviewSchema} from './schemas.js';import {PROMPTS} from './prompts.js';import {LocalJobSource} from './tools/local-jobs.js';import {buildJobGraph,type JobGraph} from './graph.js';import {stateResult} from './nodes/save-result.js';import {validateReview} from './nodes/review.js';import type {JobState} from './state.js';import type {ValidatedInputs,Profile,ReviewRequest,JobResult,BatchStatus} from './types.js';
import type {JobpilotEvent} from './events.js';
export type ServiceDependencies={root:string;model?:ModelAdapter;config?:JobpilotConfig;store?:JobpilotStore;checkpointer?:BaseCheckpointSaver;onEvent?:(event:JobpilotEvent)=>void};
export async function createJobpilotService(deps:ServiceDependencies){
 const config=deps.config??loadJobpilotConfig({});const store=deps.store??openJobpilotStore(path.join(deps.root,'data/jobpilot/app.sqlite'),config.limits);
 const handle=deps.checkpointer?undefined:await openCheckpointer(path.join(deps.root,'data/jobpilot/checkpoints.sqlite'));
 return new JobpilotService({...deps,store,config,checkpointer:deps.checkpointer??handle!.saver},async()=>{if(!deps.store)store.close();await handle?.close();});
}
export class JobpilotService{
 readonly store:JobpilotStore;private config:JobpilotConfig;private model?:ModelAdapter;
 constructor(private deps:ServiceDependencies&{store:JobpilotStore;config:JobpilotConfig;checkpointer:BaseCheckpointSaver},private cleanup:()=>Promise<void>){this.store=deps.store;this.config=deps.config;this.model=deps.model;}
 private getModel():ModelAdapter{return this.model??={request:(req,signal)=>createModelAdapter(this.config).request(req,signal)};}
 private async lock<T>(id:string,fn:()=>Promise<T>){const release=await acquireRunLock(path.join(this.deps.root,'data/jobpilot/locks',id+'.sqlite'));try{return await fn();}finally{await release();}}
 private task(id:string){z.uuid().parse(id);const task=this.store.task(id);if(task.schemaVersion!==1)throw Error('incompatible_checkpoint');return task;}
 private async profile(batchId:string,input:ValidatedInputs):Promise<Profile>{return this.lock('profile-'+batchId,async()=>{
  const existing=this.store.getBatch(batchId).profile;if(existing)return existing;const scope='profile:'+batchId;this.store.recoverPending(scope);
  const p=await runStructured({operation:'profile',messages:[{role:'system',content:PROMPTS.profile},{role:'user',content:JSON.stringify(input.resume.evidence)}]},profileSchema,{model:this.getModel(),store:this.store,scopeId:scope,operationId:scope+':'+input.resume.hash,limits:this.config.limits},profile=>{const ids=new Set(input.resume.evidence.map(e=>e.id));if(profile.facts.some(f=>f.evidenceIds.some(id=>!ids.has(id))))throw Error('invalid_output');});
  this.store.saveProfile(batchId,p);return p;
 });}
 private async context(task:TaskRow,needProfile=false){
  const batch=this.store.getBatch(task.batchId);const input=await readSnapshot(batch.snapshot);
  const graph=buildJobGraph({model:this.getModel(),store:this.store,config:this.config,checkpointer:this.deps.checkpointer,source:new LocalJobSource(input.jobs),onEvent:this.deps.onEvent});
  const profile=needProfile?await this.profile(task.batchId,input):batch.profile??{facts:[]};
  const initial:JobState={schemaVersion:1,threadId:task.threadId,batchId:task.batchId,jobId:task.jobId,resume:input.resume,preferences:input.preferences,profile,jobSummary:input.jobs.summaries.find(j=>j.jobId===task.jobId)!,jobDetail:input.jobs.initialDetailIds.includes(task.jobId)?input.jobs.details.find(j=>j.jobId===task.jobId):undefined,inputHashes:batch.snapshot.hashes};
  return {graph,initial,options:{configurable:{thread_id:task.threadId},recursionLimit:50}};
 }
 private async view(graph:JobGraph,task:TaskRow,persist=true):Promise<JobResult>{
  const snapshot=await graph.getState({configurable:{thread_id:task.threadId}});const data=snapshot.values.data;
  if(!data){const r=this.store.latestResult(task.threadId);if(r)return r;return {threadId:task.threadId,batchId:task.batchId,jobId:task.jobId,draftVersion:0,taskStatus:task.status,provenance:{}};}
  if(data.schemaVersion!==1)throw Error('incompatible_checkpoint');
  const waiting=snapshot.tasks.some(t=>t.interrupts?.length);const result=stateResult(data,{config:this.config,store:this.store});
  if(waiting)result.taskStatus='waiting_review';else if(snapshot.next.length&&!data.error)result.taskStatus='running';
  if(persist){this.store.setStatus(task.threadId,result.taskStatus);this.store.saveResult(result);}return result;
 }
 async analyze(input:ValidatedInputs):Promise<BatchStatus>{
  // Revalidate public API input, not just CLI JSON.
  const checked=prepareInputs(input.resume.text,{...input.jobs,details:input.jobs.details.map(({hash:_,evidence:__,...d})=>d)},input.preferences);
  const snapshot=await freezeInputs(this.deps.root,checked),batchId=randomUUID();this.store.createBatch(batchId,snapshot);
  for(const job of checked.jobs.summaries)this.store.createTask({threadId:randomUUID(),batchId,jobId:job.jobId,status:'queued',schemaVersion:1});
  for(const task of this.store.tasks(batchId))await this.resume(task.threadId);
  return this.status(batchId);
 }
 private async project(batchId:string){z.uuid().parse(batchId);this.store.getBatch(batchId);const tasks=[],results:JobResult[]=[];for(const task of this.store.tasks(batchId)){
  // Status is read-only with respect to graph execution; derive current view from checkpoints.
  const {graph}=await this.context(task);const result=await this.view(graph,task,false);results.push(result);tasks.push({threadId:task.threadId,jobId:task.jobId,status:result.taskStatus,draftVersion:result.draftVersion,error:result.error});
 }return {batch:{batchId,tasks},results};}
 async status(batchId:string):Promise<BatchStatus>{return (await this.project(batchId)).batch;}
 async resume(threadId:string):Promise<JobResult>{const task=this.task(threadId);return this.lock(threadId,async()=>{
  try{this.store.recoverPending(threadId);const {graph,initial,options}=await this.context(task,true);const before=await graph.getState(options);
   if(before.values.data?.schemaVersion!==undefined&&before.values.data.schemaVersion!==1)throw Error('incompatible_checkpoint');
   if(!before.tasks.some(t=>t.interrupts?.length)&&(!before.values.data||before.next.length))await graph.invoke(before.values.data?null:{data:initial},options);
   return await this.view(graph,task);
  }catch(e){if(e instanceof Error&&e.message==='incompatible_checkpoint')throw e;const result:JobResult={threadId,batchId:task.batchId,jobId:task.jobId,draftVersion:0,taskStatus:'failed',error:errorCode(e),provenance:{}};this.store.setStatus(threadId,'failed');this.store.saveResult(result);return result;}
 });}
 async review(input:ReviewRequest):Promise<JobResult>{const request=reviewSchema.parse(input);const task=this.task(request.threadId);return this.lock(request.threadId,async()=>{
  const previous=this.store.getReview(request.reviewId);if(previous&&hash(previous.request)!==hash(request))throw Error('review_conflict');if(previous?.response)return previous.response;
  if(this.store.pendingReviews(task.threadId).some(r=>r.reviewId!==request.reviewId))throw Error('pending_review_conflict');
  this.store.recoverPending(task.threadId);const {graph,options}=await this.context(task);const snapshot=await graph.getState(options);const state=snapshot.values.data;
  if(!state)throw Error('task_not_started');if(state.schemaVersion!==1)throw Error('incompatible_checkpoint');
  const consumed=state.review?.reviewId===request.reviewId;
  if(!consumed){validateReview(request,{...state,revisionCount:this.store.getBudget(task.threadId).revisionCount},this.config.limits.revisions);if(!snapshot.tasks.some(t=>t.interrupts?.length))throw Error('not_waiting_review');}
  this.store.reserveReview(request);
  if(!consumed)await graph.invoke(new Command({resume:request}),options);
  else if(snapshot.next.length&&!snapshot.tasks.some(t=>t.interrupts?.length))await graph.invoke(null,options);
  const result=await this.view(graph,task);this.store.completeReview(request.reviewId,result);return result;
 });}
 async reportData(batchId:string){return this.project(batchId);}
 async close(){await this.cleanup();}
}
