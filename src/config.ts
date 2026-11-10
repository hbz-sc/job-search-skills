import path from 'node:path';
import type { RunConfig } from './domain.js';
export function loadConfig(input:unknown,root:string):RunConfig {
 if(!input || typeof input!=='object' || Array.isArray(input)) throw new Error('配置必须是对象');
 const i=input as Record<string,unknown>;
 if(!Array.isArray(i.keywords) || !i.keywords.length || i.keywords.some(k=>typeof k!=='string'||!k.trim())) throw new Error('至少提供一个非空关键词');
 const mode=i.mode??'collect'; if(mode!=='collect'&&mode!=='send') throw new Error('mode 只能为 collect/send');
 const int=(name:string,fallback:number,min=1)=>{const n=i[name]??fallback;if(typeof n!=='number'||!Number.isSafeInteger(n)||n<min)throw new Error('无效参数：'+name);return n;};
 const dir=(name:string,fallback:string)=>{const v=i[name]??fallback;if(typeof v!=='string'||!v.trim())throw new Error('无效路径');return path.resolve(root,v);};
 const city=i.city??'深圳'; if(typeof city!=='string'||!city.trim())throw new Error('城市为空');
 const connection={browser:'chrome',...(i.connection??{kind:'extension'}) as object} as {kind:string;browser:'chrome'|'msedge';profileDirName?:string;preferredUrl?:string};
 if(!['chrome','msedge'].includes(connection.browser))throw new Error('浏览器必须为 chrome 或 msedge');
 if(connection.kind!=='extension'||(connection.profileDirName!==undefined&&!/^(Default|Profile \d+)$/.test(connection.profileDirName)))throw new Error('仅支持已核实的 Edge extension profile');
 return {mode,city,connection:{...connection,kind:'extension'},keywords:[...new Set(i.keywords.map(k=>(k as string).trim()))],maxJobs:i.maxJobs===undefined?undefined:int('maxJobs',1),browserDir:dir('browserDir','private/browser'),databasePath:dir('databasePath','data/boss.sqlite'),outputDir:dir('outputDir','output/boss'),actionTimeoutMs:int('actionTimeoutMs',15000),readRetries:int('readRetries',2,0),noProgressLimit:int('noProgressLimit',3),consecutiveErrorLimit:int('consecutiveErrorLimit',3),intervalMs:int('intervalMs',5000,0)};
}
