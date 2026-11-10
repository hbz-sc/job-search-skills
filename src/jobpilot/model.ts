import {ChatOpenAI} from '@langchain/openai';import type {BaseMessageLike} from '@langchain/core/messages';import {z,type ZodType} from 'zod';
import type {JobpilotConfig,Limits} from './config.js';import type {JobpilotStore} from './store.js';import {withBudget} from './budget.js';
import {disableExternalTracing} from './privacy.js';
export type ToolSpec={name:string;description:string;parameters:Record<string,unknown>};
export type ModelRequest={operation:'profile'|'decide'|'analyze'|'draft'|'revise'|'search_plan';messages:BaseMessageLike[];tools?:ToolSpec[];outputSchema?:Record<string,unknown>};
export type ModelResponse={content:string;toolCalls:{id:string;name:string;args:unknown}[];usage?:{input_tokens:number;output_tokens:number;total_tokens:number}};
export interface ModelAdapter{request(request:ModelRequest,signal:AbortSignal):Promise<ModelResponse>}
export type OperationContext={model:ModelAdapter;store:JobpilotStore;scopeId:string;operationId:string;limits:Limits};
export function createModelAdapter(config:JobpilotConfig):ModelAdapter{
 disableExternalTracing();
 if(!config.model||!config.apiKey||!config.baseUrl)throw Error('MODEL_CONFIG_REQUIRED');
 const url=new URL(config.baseUrl);if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw Error('INVALID_MODEL_URL');
 const llm=new ChatOpenAI({model:config.model,apiKey:config.apiKey,configuration:{baseURL:config.baseUrl},maxRetries:0,temperature:0,callbacks:[],modelKwargs:{enable_thinking:false}});
 return {async request(req,signal){
  const messages:BaseMessageLike[]=req.outputSchema?[{role:'system',content:'Return only JSON matching this schema: '+JSON.stringify(req.outputSchema)},...req.messages]:req.messages;
  const result=await llm.invoke(messages,{signal,callbacks:[],...(req.tools?{tools:req.tools.map(t=>({type:'function' as const,function:t})),tool_choice:'required' as const}:{}),...(req.outputSchema?{response_format:{type:'json_object' as const}}:{})});
  return {content:typeof result.content==='string'?result.content:JSON.stringify(result.content),toolCalls:(result.tool_calls??[]).map(t=>({id:t.id??'',name:t.name,args:t.args})),usage:result.usage_metadata};
 }};
}
export function errorCode(e:unknown){const m=e instanceof Error?e.message:'';return ['budget_exceeded','invalid_output','request_timeout'].find(c=>m.startsWith(c))??'model_unavailable';}
function retryable(e:unknown){const status=(e as {status?:number})?.status;return status===undefined||status===408||status===429||(status>=500&&status<600);}
export async function runStructured<T>(request:ModelRequest,schema:ZodType<T>,ctx:OperationContext,validate?:(value:T)=>void):Promise<T>{
 let req={...request,outputSchema:z.toJSONSchema(schema) as Record<string,unknown>};
 for(;;){try{return await withBudget(ctx.store,ctx.limits,ctx.scopeId,ctx.operationId,'model',async signal=>{
   const r=await ctx.model.request(req,signal);let parsed:T;try{parsed=schema.parse(JSON.parse(r.content));validate?.(parsed);}catch{throw Error('invalid_output');}return parsed;
  });}catch(e){if(!retryable(e)||ctx.store.operationAttempts(ctx.operationId)>=2||errorCode(e)==='budget_exceeded')throw Error(errorCode(e));
   req={...req,messages:[...request.messages,{role:'user',content:'上次响应未通过校验。请严格按 JSON schema 和来源证据返回，不添加字段。'}]};
  }}
}
export async function runDecision(request:ModelRequest,ctx:OperationContext):Promise<ModelResponse>{
 for(;;){try{return await withBudget(ctx.store,ctx.limits,ctx.scopeId,ctx.operationId,'model',signal=>ctx.model.request(request,signal));}catch(e){if(!retryable(e)||ctx.store.operationAttempts(ctx.operationId)>=2||errorCode(e)==='budget_exceeded')throw Error(errorCode(e));}}
}
