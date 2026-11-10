import {test,expect} from 'vitest';import {BossExtensionClient} from '../src/boss-extension/client.js';
const binding={sessionId:'s',tabId:1,frameId:0,documentId:'d'};
const scope={mode:'preview',batchId:'b',planHash:'a'.repeat(64),allowedKeywords:['Java开发工程师'],city:'深圳',experienceBands:['exp_1_3','exp_3_5'],maxContacts:0,expectedPhraseHash:null};
test('v3 records the exact envelope before SDK dispatch and retains its request id',async()=>{
 const commands:any[]=[];let saved:any;
 const sdk={async callTool(r:any){const c=r.arguments.command;if(c){if(c.tool==='search_jobs')expect(saved).toEqual(c);commands.push(c);return {structuredContent:{requestId:c.context.requestId,phase:'observed',value:{binding},evidenceIds:[]}};}return {structuredContent:{}};},async close(){}};
 const client=new (BossExtensionClient as any)(sdk,binding,true,true);
 try{await client.startSearchWorkflow(scope);await client.searchAction('search_jobs',{city:'深圳',keyword:'Java开发工程师',experience:'exp_1_3'},'persisted-id',(c:any)=>{saved=structuredClone(c);});
 expect(commands.every(c=>c.version===3)).toBe(true);expect(commands.at(-1).context.requestId).toBe('persisted-id');
 }finally{await client.close();}
});
test('v3 requires negotiated capability and never dispatches when persistence fails',async()=>{
 let called=0;const sdk={async callTool(r:any){called++;const c=r.arguments.command;return {structuredContent:c?{requestId:c.context.requestId,phase:'observed',value:{binding},evidenceIds:[]}:{}};},async close(){}};
 const old=new (BossExtensionClient as any)(sdk,binding,true,false);await expect(old.startSearchWorkflow(scope)).rejects.toThrow('EXTENSION_UPDATE_REQUIRED');expect(called).toBe(0);await old.close();
 const client=new (BossExtensionClient as any)(sdk,binding,true,true);try{await client.startSearchWorkflow(scope);const before=called;await expect(client.searchAction('search_jobs',{},'request',()=>{throw Error('DISK_FAILED');})).rejects.toThrow('DISK_FAILED');expect(called).toBe(before+1);}finally{await client.close();}
});
