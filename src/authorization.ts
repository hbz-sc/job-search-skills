import {Stop,type Account,type RunConfig,type Template} from './domain.js';
export type RunAuthorization={accountKey:string;city:string;keywords:string[];templateHash:string;filtersHash:string;limit:{kind:'jobs';count:number}|{kind:'platform_quota'};issuedAt:string};
export function assertAuthorized(auth:RunAuthorization|undefined,a:Account,c:RunConfig,t:Template,filtersHash:string):void{
 if(!auth||auth.accountKey!==a.key||auth.city!==c.city||auth.templateHash!==t.hash||auth.filtersHash!==filtersHash||JSON.stringify(auth.keywords)!==JSON.stringify(c.keywords)||!Number.isFinite(Date.parse(auth.issuedAt)))throw new Stop('authorization','账号、范围、筛选或常用语未经本轮确认');
 if(auth.limit.kind==='jobs'){
  if(!Number.isSafeInteger(auth.limit.count)||auth.limit.count<=0||auth.limit.count!==c.maxJobs)throw new Stop('authorization','本轮数量与确认范围不一致');
 }else if(auth.limit.kind!=='platform_quota'||c.maxJobs!==undefined)throw new Stop('authorization','停止范围与确认范围不一致');
}
