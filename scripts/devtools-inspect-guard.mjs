export const textOf=r=>(r.content??[]).filter(x=>x.type==='text').map(x=>x.text).join('\n');
export function isBossUrl(value){
 try{const u=new URL(value);return u.protocol==='https:'&&['www.zhipin.com','zhipin.com'].includes(u.hostname);}catch{return false;}
}
export function parsePages(result){
 if(result.isError)throw Error('PAGE_LIST_FAILED');
 const pages=new Map();
 for(const line of textOf(result).split('\n')){
  const head=line.match(/^(\d+): (.+)$/);if(!head)continue;
  const label=head[2],start=label.lastIndexOf(' ('),end=label.lastIndexOf(')');
  const value=start>=0&&end>start?label.slice(start+2,end):label.split(/\s/)[0];
  try{const u=new URL(value);pages.set(Number(head[1]),{url:u.href,boss:isBossUrl(u.href)});}catch{}
 }
 return pages;
}
export function createGuard(call,audit=()=>{}){
 const snapshots=new Map();
 const allowed=new Set(['list_pages','take_snapshot','evaluate_script','click','fill','press_key','wait_for']);
 const writes=new Set(['click','fill','press_key']);
 return async req=>{
  if(!allowed.has(req.name))throw Error('TOOL_NOT_ALLOWED');
  if(req.name==='list_pages')return call(req.name,req.args??{});
  const id=req.args?.pageId;
  const page=parsePages(await call('list_pages',{})).get(id);
  audit({stage:'target_check',pageId:id,url:page?.url,boss:page?.boss??false});
  if(!page?.boss){snapshots.delete(id);throw Error('BOSS_PAGE_REQUIRED');}
  if(writes.has(req.name)){
   const old=snapshots.get(id);
   if(!old||old.url!==page.url||(req.args.uid&&!old.uids.has(req.args.uid))){snapshots.delete(id);throw Error('SNAPSHOT_STALE');}
   snapshots.delete(id); // Never retry a write using the same snapshot, even after timeout.
  }
  const result=await call(req.name,req.args);
  if(req.name==='take_snapshot'||req.args?.includeSnapshot||req.name==='wait_for'){
   snapshots.delete(id);
   if(!result.isError){
    const text=textOf(result),root=text.match(/^uid=\S+ RootWebArea[^\n]* url="([^"]+)"/m);
    if(!root||root[1]!==page.url){audit({stage:'snapshot_target_changed',pageId:id,url:root?.[1]});throw Error('PAGE_CHANGED_DURING_READ');}
    snapshots.set(id,{url:root[1],uids:new Set([...text.matchAll(/\buid=(\S+)/g)].map(m=>m[1]))});
   }
  }
  return result;
 };
}
