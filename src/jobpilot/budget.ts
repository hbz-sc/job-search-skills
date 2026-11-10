import type {JobpilotStore} from './store.js';import type {Limits} from './config.js';
export async function withBudget<T>(store:JobpilotStore,limits:Limits,scope:string,id:string,kind:'model'|'tool',call:(signal:AbortSignal)=>Promise<T>):Promise<T>{
 const cached=store.getOperation(id);if(cached!==undefined)return cached as T;
 store.reserveAttempt(scope,kind,id);const start=performance.now();
 const remaining=limits.activeMs-store.getBudget(scope).activeMs;
 const ms=Math.min(remaining,kind==='model'?limits.modelTimeoutMs:limits.toolTimeoutMs);const controller=new AbortController();
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  const result=await Promise.race([call(controller.signal),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('request_timeout'));},Math.max(1,ms));})]);
  store.completeOperation(id,result,performance.now()-start);return result;
 }finally{if(timer)clearTimeout(timer);store.finishAttempt(id,performance.now()-start);}
}
