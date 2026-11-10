import {test,expect} from 'vitest';import {emitEvent} from '../../src/jobpilot/events.js';
test('events serialize only known operational metadata',()=>{
 const lines:string[]=[];emitEvent({node:'analyze',status:'completed',durationMs:12,apiKey:'secret',content:'完整简历',error:Error('token=secret')} as never,s=>lines.push(s));
 expect(lines.join('')).not.toContain('secret');expect(lines.join('')).not.toContain('完整简历');expect(JSON.parse(lines[0]).usage).toBeUndefined();
});
