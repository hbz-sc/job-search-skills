import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {Evidence} from '../domain.js';
export type EdgeConnection={kind:'extension';browser?:'chrome'|'msedge';profileDirName?:string;preferredUrl?:string};
export type EdgeBinding={browser?:'chrome'|'msedge';profileDirName:string;accountKey:string;displayName:string;identityEvidence:Evidence};
function filename(root:string,profile:string,browser:string){return path.join(root,'private','browser-bindings',createHash('sha256').update(browser+':'+profile).digest('hex')+'.json');}
export function loadBinding(root:string,profile:string,browser:'chrome'|'msedge'='chrome'):EdgeBinding|undefined{
 const file=filename(root,profile,browser);if(!existsSync(file))return;
 const b=JSON.parse(readFileSync(file,'utf8')) as EdgeBinding;
 if(b.browser!==browser||b.profileDirName!==profile||!b.accountKey||!b.identityEvidence?.observedAt)throw new Error('浏览器账号绑定无效');return b;
}
export function saveBinding(root:string,b:EdgeBinding){
 if(!b.accountKey||!b.profileDirName||!b.identityEvidence?.observedAt)throw new Error('缺少账号证据');
 const browser=b.browser??'chrome';const file=filename(root,b.profileDirName,browser);mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.'+randomUUID();writeFileSync(tmp,JSON.stringify({...b,browser},null,2));renameSync(tmp,file);
}
