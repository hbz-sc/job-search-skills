import {test,expect} from 'vitest';import {z} from 'zod';import {openJobpilotStore} from '../../src/jobpilot/store.js';import {DEFAULT_LIMITS,loadJobpilotConfig} from '../../src/jobpilot/config.js';import {createModelAdapter,runStructured,type ModelAdapter} from '../../src/jobpilot/model.js';
const req={operation:'analyze' as const,messages:[{role:'user' as const,content:'虚构输入'}]};
test('invalid output repair and cache share one operation budget',async()=>{
 const store=openJobpilotStore(':memory:');let n=0;const model:ModelAdapter={async request(){return {content:++n===1?'bad':'{"value":1}',toolCalls:[]};}};
 const ctx={model,store,scopeId:'t',operationId:'a',limits:DEFAULT_LIMITS};
 expect(await runStructured(req,z.object({value:z.number()}),ctx)).toEqual({value:1});expect(n).toBe(2);
 await runStructured(req,z.object({value:z.number()}),ctx);expect(n).toBe(2);store.close();
});
test('network then malformed response cannot get a third request; authentication never retries',async()=>{
 const store=openJobpilotStore(':memory:');let n=0;
 const model:ModelAdapter={async request(){n++;if(n===1)throw Object.assign(Error('temporary'),{status:503});return {content:'bad',toolCalls:[]};}};
 await expect(runStructured(req,z.object({value:z.number()}),{model,store,scopeId:'t',operationId:'a',limits:DEFAULT_LIMITS})).rejects.toThrow();expect(n).toBe(2);
 n=0;model.request=async()=>{n++;throw Object.assign(Error('SECRET_KEY'),{status:401});};
 await expect(runStructured(req,z.object({value:z.number()}),{model,store,scopeId:'u',operationId:'b',limits:DEFAULT_LIMITS})).rejects.toThrow('model_unavailable');expect(n).toBe(1);store.close();
});
test('missing configuration is explicit',()=>expect(()=>createModelAdapter(loadJobpilotConfig({}))).toThrow('MODEL_CONFIG_REQUIRED'));
