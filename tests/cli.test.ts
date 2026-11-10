import {test,expect} from 'vitest';
import {parseArgs,main} from '../src/cli.js';
import {mkdtempSync,existsSync} from 'node:fs';import path from 'node:path';import {tmpdir} from 'node:os';
import {Stop,evidence,template,type BossPages} from '../src/domain.js';
import {openStore} from '../src/storage/store.js';
test('Chrome and Edge are explicit isolated extension targets',()=>{
 expect(parseArgs(['connect','--browser','chrome','--profile','Default']).input).toMatchObject({connection:{browser:'chrome'}});
 expect(()=>parseArgs(['connect','--browser','firefox'])).toThrow();
});
test('defaults to collect; send must be explicit',()=>{
 expect(parseArgs(['--keyword','AI']).command).toBe('collect');
 expect(parseArgs(['send','--keyword','AI','--max-jobs','1']).input).toMatchObject({mode:'send',maxJobs:1,keywords:['AI']});
 expect(parseArgs([]).input.keywords).toEqual(['AI应用开发工程师']);
 expect(parseArgs(['send','--max-jobs','1']).input.keywords).toEqual(['AI应用开发工程师']);
 expect(()=>parseArgs(['send'])).toThrow('--max-jobs');
 expect(()=>parseArgs(['send','--keyword','AI','--max-jobs','0'])).toThrow();
});
test('login and status do not require search; unknown arguments fail',()=>{
 expect(parseArgs(['login']).command).toBe('connect');expect(parseArgs(['status']).command).toBe('status');
 expect(()=>parseArgs(['--auto'])).toThrow();
 expect(()=>parseArgs(['collect','--keyword','AI','--resume'])).toThrow();
});
test('send requires an explicit bounded or quota scope and only extension profiles are accepted',()=>{
 expect(()=>parseArgs(['send','--keyword','AI'])).toThrow();
 expect(parseArgs(['send','--keyword','AI','--until-quota','--profile','Default']).input).toMatchObject({connection:{kind:'extension',profileDirName:'Default'}});
 expect(()=>parseArgs(['send','--keyword','AI','--until-quota','--max-jobs','2'])).toThrow();
 expect(()=>parseArgs(['doctor','--profile','../bad'])).toThrow();
});
test('connect/login uses injected extension connection and disconnects without launching a browser',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'boss-cli-'));let connections=0,closed=0;
 const p={state:async()=>({kind:'ready',evidence:evidence('正常')}),account:async()=>({key:'a',displayName:'用户'}),close:async()=>{closed++;}} as BossPages;
 const result=await main(['login','--profile','Default'],{root,openPages:async c=>{expect(c.connection.kind).toBe('extension');connections++;return p;},log:()=>{},ask:async()=>''});
 expect(result).toBe(0);expect(connections).toBe(1);expect(closed).toBe(1);expect(existsSync(path.join(root,'private','browser'))).toBe(false);
});
test('status never connects and rejecting preview sends zero greetings',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'boss-cli-'));let opens=0,closes=0,connections=0;
 const p={state:async()=>({kind:'ready',evidence:evidence('正常')}),account:async()=>({key:'a',displayName:'用户'}),readInitialTemplate:async()=>template('第一条'),search:async()=>({filters:'深圳'}),restoreSearch:async()=>{},openChat:async()=>{opens++;throw new Error('must not call');},close:async()=>{closes++;}} as unknown as BossPages;
 const deps={root,openPages:async()=>{connections++;return p;},log:()=>{},ask:async()=> 'NO'};
 expect(await main(['status'],deps)).toBe(0);expect(connections).toBe(0);
 expect(await main(['send','--keyword','AI','--max-jobs','1','--profile','Default'],deps)).toBe(2);expect(opens).toBe(0);expect(closes).toBe(1);
});
test('quota during preview persists before runner starts and blocks the next normal send',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'boss-cli-quota-'));let prompts=0;
 const p={state:async()=>({kind:'ready',evidence:evidence('正常')}),account:async()=>({key:'a',displayName:'用户'}),readInitialTemplate:async()=>{throw new Stop('quota','今日沟通达到上限',evidence('今日沟通达到上限'));},close:async()=>{}} as unknown as BossPages;
 const args=['send','--profile','Default','--keyword','AI','--max-jobs','1'];const deps={root,openPages:async()=>p,log:()=>{},ask:async()=>{prompts++;return 'SEND';}};
 expect(await main(args,deps)).toBe(2);const s=openStore(path.join(root,'data/boss.sqlite'));expect(s.getQuota('a')?.reason).toBe('quota');s.close();
 p.readInitialTemplate=async()=>template('第一条');expect(await main(args,deps)).toBe(2);expect(prompts).toBe(0);
});
