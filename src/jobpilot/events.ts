export type JobpilotEvent={threadId?:string;node:string;status:string;durationMs?:number;toolName?:string;attempt?:number;usage?:{input_tokens:number;output_tokens:number;total_tokens:number};errorCode?:string};
export function emitEvent(e:JobpilotEvent,write:(s:string)=>void=console.error){
 const out:Record<string,unknown>={};
 if(/^[a-z_]{1,40}$/.test(e.node))out.node=e.node;if(/^[a-z_]{1,40}$/.test(e.status))out.status=e.status;
 if(e.threadId&&/^[0-9a-f-]{36}$/.test(e.threadId))out.threadId=e.threadId;
 for(const k of ['durationMs','attempt'] as const)if(Number.isFinite(e[k]))out[k]=e[k];
 if(e.toolName&&['get_job_detail','finish_research'].includes(e.toolName))out.toolName=e.toolName;
 if(e.errorCode&&['invalid_input','invalid_output','model_unavailable','tool_unavailable','budget_exceeded','request_timeout'].includes(e.errorCode))out.errorCode=e.errorCode;
 if(e.usage)out.usage=Object.fromEntries(['input_tokens','output_tokens','total_tokens'].filter(k=>Number.isFinite(e.usage![k as keyof typeof e.usage])).map(k=>[k,e.usage![k as keyof typeof e.usage]]));
 write(JSON.stringify(out));
}
