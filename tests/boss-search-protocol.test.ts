import {test,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';
import {parseSearchScope,parseSearchView} from '../src/boss-extension/search-protocol.js';
const {ActionExecutor,validateAction,validateSearchScope}=await import(pathToFileURL(resolve('extensions/boss-page/action-executor.js')).href);
export const scope={mode:'run',batchId:'batch',planHash:'a'.repeat(64),allowedKeywords:['Java开发工程师'],city:'深圳',experienceBands:['exp_1_3','exp_3_5'],maxContacts:1,expectedPhraseHash:'b'.repeat(64)};
const binding={sessionId:'s',tabId:1,frameId:0,documentId:'d'};
const cmd=(tool:string,payload:any,requestId='q')=>({version:3,tool,payload,context:{runId:'r',leaseId:'l',requestId,binding,deadline:new Date(Date.now()+10000).toISOString()}});
test('shared scope vectors agree in TypeScript and extension validators',()=>{
 const fixture=JSON.parse(readFileSync('tests/fixtures/boss-search-contract.json','utf8'));
 for(const v of fixture.vectors)for(const parse of [parseSearchScope,validateSearchScope]){const check=()=>parse({...fixture.scope,...v.patch});if(v.valid)expect(check,v.name).not.toThrow();else expect(check,v.name).toThrow();}
});
test('v3 scope is finite and preview cannot carry contact allowance',()=>{
 expect(parseSearchScope(scope).maxContacts).toBe(1);expect(validateSearchScope(scope)).toEqual(scope);
 for(const patch of [{city:'北京'},{allowedKeywords:['随意搜索']},{experienceBands:['exp_5_10']},{maxContacts:151},{mode:'preview'},{expectedPhraseHash:null},{script:'alert(1)'}]){
  expect(()=>parseSearchScope({...scope,...patch})).toThrow();expect(()=>validateSearchScope({...scope,...patch})).toThrow();
 }
});
test('v3 enforces keyword/experience/hash scope and remaining contact budget before dispatch',async()=>{
 const records=new Map();const ex=new ActionExecutor({get:async(k:string)=>records.get(k),put:async(k:string,v:any)=>records.set(k,v)});
 ex.start('r','l',scope,binding,3);let count=0;const perform=async()=>{count++;return {};};
 await expect(ex.execute(cmd('search_jobs',{city:'深圳',keyword:'AI应用开发工程师',experience:'exp_1_3'}),perform)).rejects.toThrow('SCOPE_DENIED');
 await expect(ex.execute(cmd('choose_first_phrase',{conversationKey:'c',expectedHash:'c'.repeat(64)}),perform)).rejects.toThrow('SCOPE_DENIED');
 expect(count).toBe(0);
 await ex.execute(cmd('search_jobs',{city:'深圳',keyword:'Java开发工程师',experience:'exp_3_5'},'search'),perform);
 await ex.execute(cmd('open_chat',{jobKey:'j'},'one'),perform);
 await expect(ex.execute(cmd('open_chat',{jobKey:'j2'},'two'),perform)).rejects.toThrow('CONTACT_LIMIT');expect(count).toBe(2);
 await expect(ex.execute({...cmd('open_chat',{jobKey:'j3'},'three'),version:2},perform)).rejects.toThrow('VERSION_MISMATCH');
});
test('preview denies communication and exhausted run still allows observation',async()=>{
 for(const mode of ['preview','run']){
 const ex=new ActionExecutor({get:async()=>undefined,put:async()=>{}});ex.start('r','l',{...scope,mode,maxContacts:0,expectedPhraseHash:mode==='preview'?null:scope.expectedPhraseHash},binding,3);
 await expect(ex.execute(cmd('open_chat',{jobKey:'j'}),async()=>({}))).rejects.toThrow(mode==='preview'?'SCOPE_DENIED':'CONTACT_LIMIT');
 if(mode==='run')expect((await ex.execute(cmd('inspect_chat',{conversationKey:'c'}),async()=>({}))).phase).toBe('observed');
 }
});
test('query results must prove all filters with evidence; strict query payload rejects extra arguments',()=>{
 const q={city:'深圳' as const,keyword:'Java开发工程师',experience:'exp_1_3' as const};
 const view={observedCity:'深圳',observedKeyword:q.keyword,observedExperience:q.experience,filterEvidence:{keyword:q.keyword,city:'深圳',experience:'1-3年',results:'visible-result-region'},jobs:[],exhausted:true};
 expect(parseSearchView(view,q).jobs).toEqual([]);
 expect(()=>parseSearchView({...view,observedExperience:'exp_3_5'},q)).toThrow('FILTER_UNVERIFIED');
 expect(()=>parseSearchView({...view,filterEvidence:{}},q)).toThrow();
 expect(()=>validateAction(cmd('search_jobs',{...q,script:'bad'}))).toThrow();
 expect(()=>validateAction(cmd('restore_search',{}))).toThrow();
});
