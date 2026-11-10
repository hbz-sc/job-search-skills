import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline/promises';
import {loadConfig} from './config.js';
import {openStore,readStoreStatus} from './storage/store.js';
import {loadLegacySentJobs} from './storage/history.js';
import {connectMcp} from './mcp/client.js';
import {McpBossPages} from './browser/mcp-boss-pages.js';
import {loadBinding,saveBinding} from './browser/edge-binding.js';
import {acquireRunLock} from './run-lock.js';
import {run} from './runner.js';
import {visionStatus} from './vision.js';
import {Stop,evidence,template,type BossPages,type RunConfig,type Account} from './domain.js';
import {redact} from './diagnostics.js';
import type {RunAuthorization} from './authorization.js';

export function parseArgs(argv:string[]){
 const args=[...argv];let command=args[0]&&!args[0].startsWith('--')?args.shift()!:'collect';if(command==='login')command='connect';
 if(!['connect','doctor','collect','send','status'].includes(command))throw new Error('命令：connect / doctor / collect / send / status');
 const overrides:Record<string,unknown>={};const keywords:string[]=[];let resume=false,untilQuota=false;let configFile:string|undefined,profile:string|undefined,browser:string|undefined,account:string|undefined;
 while(args.length){const k=args.shift()!;if(k==='--resume'){resume=true;continue;}if(k==='--until-quota'){untilQuota=true;continue;}
  if(!['--keyword','--max-jobs','--city','--config','--profile','--browser','--account'].includes(k))throw new Error('未知参数：'+k);
  const v=args.shift();if(!v||v.startsWith('--'))throw new Error('缺少参数值：'+k);
  if(k==='--keyword')keywords.push(v);if(k==='--city')overrides.city=v;if(k==='--max-jobs')overrides.maxJobs=Number(v);if(k==='--config')configFile=v;if(k==='--profile')profile=v;if(k==='--account')account=v;if(k==='--browser')browser=v;
 }
 if((resume||untilQuota)&&command!=='send')throw new Error('--resume / --until-quota 只适用于 send');
 if(account&&command!=='status')throw new Error('--account 只适用于 status');
 let base:Record<string,unknown>={};if(configFile){const parsed=JSON.parse(readFileSync(configFile,'utf8').replace(/^\uFEFF/,''));if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('配置必须是对象');base=parsed;}
 const connection={...(base.connection as object??{}),kind:'extension',...(browser?{browser}:{}),...(profile?{profileDirName:profile}:{})};
 const input={...base,...overrides,connection,keywords:keywords.length?keywords:base.keywords??(['connect','doctor','status'].includes(command)?['__no_search__']:['AI应用开发工程师']),mode:command==='send'?'send':'collect'};
 const c=loadConfig(input,process.cwd());
 if(command==='send'&&((c.maxJobs===undefined&&!untilQuota)||(c.maxJobs!==undefined&&untilQuota)))throw new Error('send 必须指定 --max-jobs N 或 --until-quota，二选一');
 return {command,input,resume,untilQuota,account};
}
export type CliDependencies={root:string;openPages:(config:RunConfig,signal:AbortSignal)=>Promise<BossPages>;log:(s:string)=>void;ask:(prompt:string)=>Promise<string>};
export async function main(argv=process.argv.slice(2),deps:Partial<CliDependencies>={}):Promise<number>{
 const dir=path.dirname(fileURLToPath(import.meta.url));const root=deps.root??path.resolve(dir,dir.endsWith(path.join('dist','src'))?'../..':'..');
 const parsed=parseArgs(argv);const c=loadConfig(parsed.input,root);const log=deps.log??console.log;
 log('模型：'+visionStatus(process.env)+'（核心流程不调用模型）');
 if(parsed.command==='status'){
  log(existsSync(c.databasePath)?JSON.stringify(readStoreStatus(c.databasePath,parsed.account),null,2):'尚无运行记录。');return 0;
 }
 const unlock=await acquireRunLock(path.join(root,'private','boss-run-lock.sqlite'));const abort=new AbortController();
 const onStop=()=>abort.abort();process.once('SIGINT',onStop);process.once('SIGTERM',onStop);
 const ask=deps.ask??(async(prompt:string)=>{if(!process.stdin.isTTY)throw new Stop('authorization','需要交互确认，请在终端运行；不会自动发送');const r=createInterface({input:process.stdin,output:process.stdout});try{return await r.question(prompt,{signal:abort.signal});}finally{r.close();}});
 let pages:BossPages|undefined;let store:ReturnType<typeof openStore>|undefined;let account:Account|undefined;
 try{
  const profile=c.connection.profileDirName;if(!profile)throw new Error('请指定 --profile（当前 Edge 配置目录，例如 Default），不会自动连接其他配置');
  const openPages=deps.openPages??(async(config:RunConfig,signal:AbortSignal)=>{
   const browser=config.connection.browser??'chrome';const userData=browser==='chrome'?['Google','Chrome']:['Microsoft','Edge'];
   const extension=path.join(process.env.LOCALAPPDATA??'', ...userData,'User Data',profile,'Extensions','mmlmfjhmonkocbjadbfplnigmagldckm');
   if(!existsSync(extension))throw new Error('所选浏览器配置未检测到 Playwright Extension。请在对应 Chrome / Edge 中安装官方扩展。');
   log('正在请求当前浏览器的扩展连接；如弹出 Playwright 授权页，请选择已登录的 BOSS 标签。');
   const port=await connectMcp({root,browser,profileDirName:profile,timeoutMs:config.actionTimeoutMs},signal);
   return new McpBossPages(port,{connection:config.connection,binding:loadBinding(root,profile,browser),signal,timeoutMs:config.actionTimeoutMs,allowedOrigin:'https://www.zhipin.com'});
  });
  pages=await openPages(c,abort.signal);
  account=await pages.account();const state=await pages.state();store=openStore(c.databasePath);
  if(state.kind==='quota'&&account)store.latchQuota(account.key,'quota',state.evidence);
  if(state.kind!=='ready')throw new Stop(state.kind,'页面需要处理：'+state.kind,state.evidence);
  if(!account)throw new Stop('identity','页面已读取，但稳定账号标识尚未适配；没有发起沟通');
  const profileFile=path.join(root,'private','profile.json');
  if(existsSync(profileFile)){const local=JSON.parse(readFileSync(profileFile,'utf8').replace(/^\uFEFF/,''));if(typeof local.greeting_quota_exhausted_date==='string')store.importLegacyQuota(account.key,local.greeting_quota_exhausted_date);}
  log('当前账号：'+account.displayName+'；浏览器配置：'+profile);
  if(parsed.command==='connect'){
   saveBinding(root,{browser:c.connection.browser,profileDirName:profile,accountKey:account.key,displayName:account.displayName,identityEvidence:evidence('页面稳定标识核验；'+account.displayName)});
   if(store.getQuota(account.key)?.reason==='legacy_unverified'){
    const answer=await ask('历史资料记载 2026-10-26 招呼额度已用尽。属于当前账号输入 SAME，不属于输入 OTHER，其他输入保持待确认：');
    if(['SAME','OTHER'].includes(answer.trim()))store.confirmLegacyQuota(account.key,answer.trim()==='SAME',evidence('用户确认历史额度归属：'+answer.trim()));
   }
   log('已连接并核对账号；退出只断开 MCP，保留浏览器。');return 0;
  }
  if(parsed.command==='doctor'){
   if(c.keywords[0]!=='__no_search__'){const search=await pages.search(c.city,c.keywords[0]);log('实际筛选：'+search.filters);log(JSON.stringify((await pages.visibleJobs()).slice(0,5),null,2));}
   const t=await pages.readInitialTemplate();log('第一条常用语（只读）：\n'+t.text);log('只读诊断完成；未发送消息。');return 0;
  }
  let authorization:RunAuthorization|undefined;
  if(c.mode==='send'){
   const latch=store.getQuota(account.key);if(latch?.reason==='legacy_unverified')throw new Stop('identity','请先运行 connect 核对历史额度归属');
   if(latch&&!parsed.resume)throw new Stop('quota','历史额度停止仍有效；明确恢复时使用 --resume，不会按日期自动解除');
   const t=await pages.readInitialTemplate();const search=await pages.search(c.city,c.keywords[0]);
   log(JSON.stringify({city:c.city,keywords:c.keywords,filters:search.filters,maxJobs:c.maxJobs??'直到平台上限或结果耗尽',resume:parsed.resume},null,2));log('本轮第一条常用语：\n'+t.text);
   if((await ask('确认仅按上述范围发送常用语，输入 SEND；其他输入退出：')).trim()!=='SEND'){log('未授权发送，已退出。');return 2;}
   authorization={accountKey:account.key,city:c.city,keywords:[...c.keywords],templateHash:t.hash,filtersHash:template(search.filters||'（无额外筛选）').hash,limit:c.maxJobs?{kind:'jobs',count:c.maxJobs}:{kind:'platform_quota'},issuedAt:new Date().toISOString()};
  }
  const summary=await run({config:c,pages,store,signal:abort.signal,resume:parsed.resume,authorization,legacySent:loadLegacySentJobs([path.join(root,'data/jobs.csv'),path.join(root,'data/conversations.csv')]),log});
  log(JSON.stringify({...summary,pending:store.pendingCount(account.key)},null,2));return ['exhausted','maximum','user'].includes(summary.stopReason)?0:2;
 }catch(e){if(e instanceof Stop&&e.reason==='quota'&&account&&store)store.latchQuota(account.key,'quota',e.evidence??evidence(e.message));log('停止：'+redact(e instanceof Error?e.message:'未知错误'));return 2;}
 finally{process.removeListener('SIGINT',onStop);process.removeListener('SIGTERM',onStop);await pages?.close().catch(()=>{});store?.close();await unlock();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().then(code=>{process.exitCode=code;}).catch(e=>{console.error('启动失败：'+redact(e instanceof Error?e.message:'未知错误'));process.exitCode=1;});
