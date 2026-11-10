import {describe,it,expect} from 'vitest';
import {parseResult,parseCommand} from '../src/boss-extension/protocol.js';

const command={version:1,tool:'inspect_session',context:{runId:'r1',requestId:'q1',binding:{sessionId:'s1',tabId:3,frameId:0,documentId:'d1'},deadline:'2026-10-28T10:00:00.000Z'},payload:{}};
describe('extension protocol boundaries',()=>{
 it('accepts structured reads but rejects injected scripts and fields',()=>{
  expect(parseCommand(command).tool).toBe('inspect_session');
  expect(()=>parseCommand({...command,payload:{script:'alert(1)'}})).toThrow();
  expect(()=>parseCommand({...command,tool:'browser_run_code'})).toThrow();
  expect(()=>parseCommand({...command,context:{...command.context,binding:{...command.context.binding,frameId:1}}})).toThrow();
 });
 it('rejects ambiguous results and preserves explicit uncertain state',()=>{
  expect(()=>parseResult({requestId:'q',phase:'success'})).toThrow();
  expect(()=>parseResult({requestId:'q',phase:'observed',evidenceIds:[],error:{code:'oops',message:'bad'}})).toThrow();
  expect(parseResult({requestId:'q',phase:'uncertain',evidenceIds:['e1'],error:{code:'LOST',message:'Result unknown'}}).phase).toBe('uncertain');
 });
});
