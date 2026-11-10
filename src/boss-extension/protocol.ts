export type Binding={sessionId:string;tabId:number;frameId:0;documentId:string};
export type ActionContext={runId:string;requestId:string;binding:Binding;deadline:string};
export type Command={version:1;tool:'inspect_session';context:ActionContext;payload:Record<string,never>};
export type Phase='issued'|'accepted'|'validated'|'executing'|'observed'|'rejected'|'failed'|'uncertain';
export type ActionResult<T=unknown>={requestId:string;phase:Phase;value?:T;error?:{code:string;message:string};evidenceIds:string[]};
export type SessionView={binding:Binding;url:string;pageKind:string;identityCapability:'unavailable'|'stable';account?:{key:string;displayName:string};accountProbe?:{headerCount:number;hashAvailable:boolean;nameHash:string|null;candidates:{attribute:string;valueHash:string}[]};searchBox:{count:number};jobs:{key:string;title:string;company:string}[];blockers:string[];adapterVersion:string;writeEnabled:false};
function object(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('OBJECT_REQUIRED');return v as Record<string,unknown>;}
function keys(o:Record<string,unknown>,allowed:string[],required=allowed){if(Object.keys(o).some(k=>!allowed.includes(k))||required.some(k=>!(k in o)))throw Error('INVALID_FIELDS');}
function string(v:unknown):asserts v is string{if(typeof v!=='string'||!v)throw Error('STRING_REQUIRED');}
export function parseBinding(raw:unknown):Binding{const b=object(raw);keys(b,['sessionId','tabId','frameId','documentId']);string(b.sessionId);string(b.documentId);if(!Number.isSafeInteger(b.tabId)||(b.tabId as number)<0||b.frameId!==0)throw Error('INVALID_TARGET');return b as Binding;}
export function parseCommand(raw:unknown):Command{
 const c=object(raw);keys(c,['version','tool','context','payload']);if(c.version!==1||c.tool!=='inspect_session')throw Error('TOOL_NOT_ENABLED');
 const ctx=object(c.context);keys(ctx,['runId','requestId','binding','deadline']);for(const k of ['runId','requestId'])if(typeof ctx[k]!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(ctx[k] as string))throw Error('INVALID_ID');
 string(ctx.deadline);if(!/^\d{4}-\d\d-\d\dT/.test(ctx.deadline)||!Number.isFinite(Date.parse(ctx.deadline)))throw Error('INVALID_DEADLINE');parseBinding(ctx.binding);keys(object(c.payload),[]);
 return c as Command;
}
export function parseResult<T=unknown>(raw:unknown):ActionResult<T>{
 const r=object(raw);keys(r,['requestId','phase','value','error','evidenceIds'],['requestId','phase','evidenceIds']);string(r.requestId);
 if(!['issued','accepted','validated','executing','observed','rejected','failed','uncertain'].includes(r.phase as string))throw Error('INVALID_PHASE');
 if(!Array.isArray(r.evidenceIds)||r.evidenceIds.some(v=>typeof v!=='string'))throw Error('INVALID_EVIDENCE');
 if(r.error){const e=object(r.error);keys(e,['code','message']);string(e.code);string(e.message);if(r.phase==='observed')throw Error('CONTRADICTORY_RESULT');}
 return r as ActionResult<T>;
}
