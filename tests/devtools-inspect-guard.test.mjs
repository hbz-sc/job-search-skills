import test from 'node:test';
import assert from 'node:assert/strict';
import {createGuard,parsePages} from '../scripts/devtools-inspect-guard.mjs';
const result=text=>({content:[{type:'text',text}]});
const jobs='https://www.zhipin.com/web/geek/jobs';
const page=url=>result(`## Pages\n1: BOSS (${url}) [selected]`);
const snapshot=url=>result(`uid=1_0 RootWebArea "BOSS" url="${url}"\n  uid=1_4 link "职位"`);
const request={name:'click',args:{pageId:1,uid:'1_4'}};

test('reject page title containing BOSS URL when actual page is elsewhere',()=>{
 assert.equal(parsePages(page('https://example.com')).get(1).boss,false);
 assert.equal(parsePages(result(`1: https://www.zhipin.com/ (https://example.com)`)).get(1).boss,false);
});
test('stop before click if same page ID is now a new tab',async()=>{
 let current=jobs;const actions=[];
 const guard=createGuard(async(name,args)=>{if(name==='list_pages')return page(current);if(name==='take_snapshot')return snapshot(current);actions.push(name);return result('ok');});
 await guard({name:'take_snapshot',args:{pageId:1}});current='chrome://new-tab-page/';
 await assert.rejects(guard(request),/BOSS_PAGE_REQUIRED/);assert.deepEqual(actions,[]);
});
test('stop before click if BOSS route changed since snapshot',async()=>{
 let current=jobs;const actions=[];
 const guard=createGuard(async name=>{if(name==='list_pages')return page(current);if(name==='take_snapshot')return snapshot(current);actions.push(name);return result('ok');});
 await guard({name:'take_snapshot',args:{pageId:1}});current='https://www.zhipin.com/web/geek/resume';
 await assert.rejects(guard(request),/SNAPSHOT_STALE/);assert.deepEqual(actions,[]);
});
test('reject snapshot when navigation occurs during read',async()=>{
 const guard=createGuard(async name=>name==='list_pages'?page(jobs):snapshot('chrome://new-tab-page/'));
 await assert.rejects(guard({name:'take_snapshot',args:{pageId:1}}),/PAGE_CHANGED_DURING_READ/);
});
test('stable snapshot allows one click and invalidates old element references',async()=>{
 const actions=[];
 const guard=createGuard(async name=>{if(name==='list_pages')return page(jobs);if(name==='take_snapshot')return snapshot(jobs);actions.push(name);return result('ok');});
 await guard({name:'take_snapshot',args:{pageId:1}});
 await guard(request);await assert.rejects(guard(request),/SNAPSHOT_STALE/);
 assert.deepEqual(actions,['click']);
});
