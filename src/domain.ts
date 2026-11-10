import { createHash } from 'node:crypto';
import type {EdgeConnection} from './browser/edge-binding.js';
export type Mode = 'collect' | 'send';
export type Phase = 'discovered' | 'skipped' | 'opening' | 'chat_open' | 'sending' | 'unconfirmed' | 'confirmed' | 'failed';
export type StopReason = 'quota' | 'login' | 'verification' | 'identity' | 'template' | 'layout' | 'errors' | 'exhausted' | 'maximum' | 'user' | 'authorization';
export type RunConfig = { mode:Mode; city:string; keywords:string[]; maxJobs?:number; connection:EdgeConnection; browserDir:string; databasePath:string; outputDir:string; actionTimeoutMs:number; readRetries:number; noProgressLimit:number; consecutiveErrorLimit:number; intervalMs:number };
export type Job = {key:string;url:string;company:string;title:string;recruiterId?:string;salary?:string;district?:string;city?:string;experience?:string;education?:string;description?:string;collectedAt:string};
export type Account = {key:string;displayName:string};
export type Template = {text:string;hash:string};
export type Evidence = {text:string;url:string;observedAt:string;screenshot?:string};
export type Conversation = {key:string;jobKey:string;recruiterId?:string;company:string;title:string;url:string};
export type SendResult = {status:'confirmed'|'unconfirmed'|'skipped';evidence:Evidence};
export type Attempt = {id:string;runId:string;accountKey:string;jobKey:string;conversationKey?:string;conversationUrl?:string;templateHash:string;phase:Phase;evidence?:Evidence};
export type PageState = {kind:'ready'|'login'|'verification'|'quota'|'layout';evidence:Evidence};
export type ChatInspection = {identityMatches:boolean;existingConversation:boolean;templateStatus:'absent'|'pending'|'failed'|'confirmed';platformGreeting?:boolean;evidence:Evidence};
export type SearchScope={city:string;keyword:string;filtersHash:string};
export interface BossPages {
 state():Promise<PageState>; account():Promise<Account|undefined>;
 search(city:string,keyword:string):Promise<{filters:string}>; visibleJobs():Promise<Job[]>;
 assertSearchScope(scope:SearchScope):Promise<void>;
 advanceList():Promise<boolean>; restoreSearch():Promise<void>; readInitialTemplate():Promise<Template>;
 openChat(job:Job):Promise<Conversation>; inspectChat(c:Conversation,t:Template):Promise<ChatInspection>;
 chooseTemplate(t:Template):Promise<'filled'|'submitted'|'unknown'>; submitFilledTemplate(t:Template):Promise<void>;
 verifyTemplate(t:Template):Promise<SendResult>; reopenAttempt(a:Attempt):Promise<Conversation|undefined>;
 captureDiagnostic(reason:string):Promise<Evidence>; close():Promise<void>;
}
export class Stop extends Error { constructor(public reason:StopReason, message:string, public evidence?:Evidence){super(message);} }
export const evidence = (text:string,url='local:') : Evidence => ({text,url,observedAt:new Date().toISOString()});
export const normalize = (text:string) => text.replace(/\r\n?/g,'\n').trim();
export function template(text:string):Template {const n=normalize(text); if(!n) throw new Stop('template','常用语为空'); return {text:n,hash:createHash('sha256').update(n).digest('hex')};}
export async function guard(pages:BossPages, account:Account, signal:AbortSignal){
 if(signal.aborted) throw new Stop('user','用户停止');
 const s=await pages.state(); if(s.kind!=='ready') throw new Stop(s.kind,'页面需要停止：'+s.kind,s.evidence);
 const a=await pages.account(); if(!a || a.key!==account.key) throw new Stop('identity','无法核对账号或账号已改变');
 if(signal.aborted) throw new Stop('user','用户停止');
}
