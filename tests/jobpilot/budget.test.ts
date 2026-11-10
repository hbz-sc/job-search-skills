import {test,expect} from 'vitest';import {openJobpilotStore} from '../../src/jobpilot/store.js';import {withBudget} from '../../src/jobpilot/budget.js';import {DEFAULT_LIMITS} from '../../src/jobpilot/config.js';
test('shared retry budget, tool cap, and cached response avoid calls',async()=>{
 const s=openJobpilotStore(':memory:',DEFAULT_LIMITS);let calls=0;
 const run=(op:string)=>withBudget(s,DEFAULT_LIMITS,'t',op,'model',async()=>{calls++;return 'ok';});
 expect(await run('a')).toBe('ok');expect(await run('a')).toBe('ok');expect(calls).toBe(1);
 s.reserveAttempt('t','tool','tool');s.finishAttempt('tool',0);s.reserveAttempt('t','tool','tool');s.finishAttempt('tool',0);expect(()=>s.reserveAttempt('t','tool','tool3')).toThrow('budget_exceeded');
 expect(s.getBudget('t').activeMs).toBeLessThan(1000);s.close();
});
test('abandoned request charged conservatively and time budget prevents work',()=>{
 const s=openJobpilotStore(':memory:',DEFAULT_LIMITS);s.reserveAttempt('t','model','abandoned');s.recoverPending('t');expect(s.getBudget('t').activeMs).toBe(45000);
 s.chargeActive('t',135000);expect(()=>s.reserveAttempt('t','model','new')).toThrow('budget_exceeded');s.close();
});
