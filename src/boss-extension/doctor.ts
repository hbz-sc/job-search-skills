// Read-only diagnostic entry; workflow commands live in cli.ts.
import {BossExtensionClient} from './client.js';
import {mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';

const [command='doctor',...args]=process.argv.slice(2);
const options=new Map<string,string>();
for(let n=0;n<args.length;n+=2){if(!['--samples','--duration-ms'].includes(args[n])||args[n+1]===undefined)throw Error('仅支持 --samples 和 --duration-ms');options.set(args[n],args[n+1]);}
if(command!=='doctor')throw Error('当前版本仅开放 extension doctor；发送功能尚未通过真实页面验收');
const samples=Number(options.get('--samples')??10),duration=Number(options.get('--duration-ms')??60000);
if(!Number.isSafeInteger(samples)||samples<2||samples>100||!Number.isSafeInteger(duration)||duration<0||duration>600000)throw Error('INVALID_SAMPLE_RANGE');
const runId=randomUUID();const root=path.resolve('private/boss-extension');const output=path.join(root,'diagnostics',runId);
const abort=new AbortController();process.once('SIGINT',()=>abort.abort());process.once('SIGTERM',()=>abort.abort());
let client:BossExtensionClient|undefined;let failure:string|undefined;let baseline:string|undefined;let passed=0;const started=Date.now();
try{
 client=await BossExtensionClient.connect(path.join(root,'discovery.json'));
 console.log('已连接当前 BOSS 标签；只读检查开始。runId='+runId);
 for(let i=0;i<samples;i++){
  abort.signal.throwIfAborted();
  const result=await client.inspect(runId);
  if(result.phase!=='observed'||!result.value)throw Error(result.error?.code||'READ_UNCONFIRMED');
  const v=result.value;const fingerprint=JSON.stringify([v.binding,v.url,v.pageKind,v.searchBox.count]);
  await mkdir(output,{recursive:true});
  await writeFile(path.join(output,`sample-${i+1}.json`),JSON.stringify(v,null,2)+'\n');
  if(v.pageKind!=='jobs'||v.searchBox.count!==1||v.blockers.length)throw Error('PAGE_NOT_READY: '+[v.pageKind,`searchBoxes=${v.searchBox.count}`,...v.blockers].join(','));
  if(baseline&&baseline!==fingerprint)throw Error('PAGE_CHANGED_DURING_READ');baseline=fingerprint;
  passed++;
  console.log(`只读 ${passed}/${samples}：搜索框 ${v.searchBox.count}，可见稳定职位 ${v.jobs.length}，使用当前浏览器已连接页面（无需账号识别）`);
  if(i<samples-1)await delay(Math.ceil(duration/(samples-1)),undefined,{signal:abort.signal});
 }
}catch(e){failure=abort.signal.aborted?'USER_STOPPED':e instanceof Error?e.message:'UNKNOWN_FAILURE';console.error('停止：'+failure);process.exitCode=1;}
finally{
 await mkdir(output,{recursive:true});
 if(client){try{await client.diagnostics(runId);}catch{failure??='DIAGNOSTICS_HOST_UNAVAILABLE';}}
 const readStable=passed===samples&&!failure;
 const report={runId,passed,samples,elapsedMs:Date.now()-started,readStable,accountMode:'current_connected_page',identityRequired:false,writeEnabled:false,failure,remainingGate:readStable?'下一阶段：实现并验证搜索与返回；发送功能尚未开放':'先解决页面连接或读取错误'};
 await writeFile(path.join(output,'doctor.json'),JSON.stringify(report,null,2)+'\n');
 await client?.close().catch(()=>{});
 console.log('诊断报告：'+path.join(output,'doctor.json'));
}
