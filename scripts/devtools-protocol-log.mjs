// Diagnostic sink only: never sends protocol commands or changes browser behavior.
import {appendFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
const directory=path.resolve('private/devtools-spike');
mkdirSync(directory,{recursive:true});
const output=path.join(directory,`protocol-${process.pid}.jsonl`);
const hash=x=>x?createHash('sha256').update(String(x)).digest('hex').slice(0,12):undefined;
const url=x=>{try{const u=new URL(x);return ['www.zhipin.com','zhipin.com'].includes(u.hostname)?u.origin+u.pathname:u.protocol==='about:'?u.href:'[other-origin]';}catch{return '[unknown]';}};
export function protocolLogger(namespace){
 if(!namespace.includes('protocol:'))return ()=>{};
 const direction=namespace.includes('SEND')?'SEND':'RECV';
 return raw=>{
  try{
   const m=JSON.parse(raw),p=m.params??{},t=p.targetInfo??{},f=p.frame??{};
   const r={at:new Date().toISOString(),direction,id:m.id,method:m.method,session:hash(m.sessionId)};
   if(m.id===undefined&&!/^(Target\.|Page\.(frame|windowOpen)|Inspector\.|Runtime\.(executionContextDestroyed|executionContextsCleared|exceptionThrown))/.test(m.method??''))return;
   r.target=hash(p.targetId??t.targetId);r.frame=hash(p.frameId??f.id);r.parent=hash(f.parentId);
   if(p.url??t.url??f.url)r.url=url(p.url??t.url??f.url);
   if(t.type)r.targetType=t.type;
   if(p.reason)r.reason=p.reason;
   if(p.status)r.status=p.status;
   if(p.errorCode!==undefined)r.errorCode=p.errorCode;
   if(m.error)r.protocolError=m.error.code;
   if(p.exceptionDetails)r.exceptionClass=p.exceptionDetails.exception?.className;
   if(m.method==='Network.requestWillBeSent'&&p.type==='Document')r.initiator=p.initiator?.type;
   appendFileSync(output,JSON.stringify(r)+'\n');
  }catch{}
 };
}
