import {test,expect} from 'vitest';
import {loadJobpilotConfig} from '../../src/jobpilot/config.js';
test('bounded configuration defaults and lower overrides',()=>{
 const c=loadJobpilotConfig({});expect(c.limits).toEqual({decisionTurns:3,toolAttempts:2,modelAttempts:12,profileAttempts:2,revisions:2,modelTimeoutMs:45000,toolTimeoutMs:15000,activeMs:180000});
 expect(loadJobpilotConfig({JOBPILOT_MODEL_ATTEMPTS:'4'}).limits.modelAttempts).toBe(4);
 expect(()=>loadJobpilotConfig({JOBPILOT_MODEL_ATTEMPTS:'13'})).toThrow();
});
