import {mkdirSync,writeFileSync,readFileSync,readdirSync,existsSync,lstatSync,realpathSync,unlinkSync,renameSync} from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import type {Evidence} from './domain.js';
export type DiagnosticContext={root:string;accountKey?:string;runId:string};
type Manifest={owner:'boss-job-search-v1';createdAt:number;files:string[]};
let lastCreated=0;
const digest=(s:string)=>createHash('sha256').update(s).digest('hex').slice(0,24);
const ownedFile=/^[a-f0-9-]{36}\.(json|png)$/;
export function redact(text:string){return text.replace(/(?:cookie|authorization)\s*[:=][^\r\n]*/gi,'[redacted]').replace(/((?:token|api[_-]?key|secret|password)=)[^&\s]+/gi,'$1[redacted]');}
function safe(root:string,target:string){
 const rel=path.relative(root,target);if(rel.startsWith('..')||path.isAbsolute(rel))throw new Error('诊断路径越界');
 let current=root;for(const part of ['',...rel.split(path.sep).filter(Boolean)]){if(part)current=path.join(current,part);if(existsSync(current)&&lstatSync(current).isSymbolicLink())throw new Error('拒绝诊断路径重解析点');}
 if(existsSync(target)){const r=path.relative(realpathSync(root),realpathSync(target));if(r.startsWith('..')||path.isAbsolute(r))throw new Error('诊断实际路径越界');}
}
function readManifest(root:string,dir:string):Manifest|undefined{
 const file=path.join(dir,'.boss-manifest.json');safe(root,file);if(!existsSync(file))return;
 const m=JSON.parse(readFileSync(file,'utf8')) as Manifest;
 if(m.owner!=='boss-job-search-v1'||!Number.isFinite(m.createdAt)||!Array.isArray(m.files)||m.files.some(f=>!ownedFile.test(f)))throw new Error('诊断文件清单无效');return m;
}
function retain(root:string){
 const runs:Array<{dir:string;m:Manifest}>=[];
 for(const a of readdirSync(root,{withFileTypes:true})){if(!a.isDirectory()||!/^[a-f0-9]{24}$/.test(a.name))continue;const ad=path.join(root,a.name);safe(root,ad);
  for(const r of readdirSync(ad,{withFileTypes:true})){if(!r.isDirectory()||!/^[a-f0-9]{24}$/.test(r.name))continue;const dir=path.join(ad,r.name);const m=readManifest(root,dir);if(m)runs.push({dir,m});}
 }
 for(const {dir,m} of runs.sort((a,b)=>b.m.createdAt-a.m.createdAt).slice(10)){
  for(const name of m.files){const file=path.join(dir,name);safe(root,file);if(existsSync(file))unlinkSync(file);}
  const manifest=path.join(dir,'.boss-manifest.json');safe(root,manifest);unlinkSync(manifest);
 }
}
export async function saveDiagnostic(ctx:DiagnosticContext,e:Evidence,screenshot?:Uint8Array):Promise<string>{
 const root=path.resolve(ctx.root);if(existsSync(root)&&lstatSync(root).isSymbolicLink())throw new Error('拒绝诊断根目录重解析点');mkdirSync(root,{recursive:true});
 const dir=path.join(root,digest(ctx.accountKey??'unbound'),digest(ctx.runId));safe(root,dir);mkdirSync(dir,{recursive:true});
 const m=readManifest(root,dir)??{owner:'boss-job-search-v1' as const,createdAt:lastCreated=Math.max(Date.now(),lastCreated+1),files:[]};
 const id=randomUUID();const file=path.join(dir,id+'.json');safe(root,file);
 const ev={...e,text:redact(e.text),url:redact(e.url),screenshot:undefined as string|undefined};
 if(screenshot&&m.files.filter(f=>f.endsWith('.png')).length<20){const name=id+'.png';const png=path.join(dir,name);safe(root,png);writeFileSync(png,screenshot);m.files.push(name);ev.screenshot=png;}
 writeFileSync(file,JSON.stringify(ev,null,2));m.files.push(path.basename(file));
 const manifest=path.join(dir,'.boss-manifest.json');const tmp=manifest+'.'+randomUUID();safe(root,manifest);writeFileSync(tmp,JSON.stringify(m));renameSync(tmp,manifest);retain(root);return file;
}
