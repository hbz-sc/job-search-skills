import {test,expect} from 'vitest';import {main} from '../../src/jobpilot/cli.js';import {randomUUID} from 'node:crypto';
test('help, missing review identifiers, and no-key demo are explicit',async()=>{
 const out:string[]=[],err:string[]=[];const deps={env:{},stdout:(s:string)=>out.push(s),stderr:(s:string)=>err.push(s),loadEnv:false};
 expect(await main(['--help'],deps)).toBe(0);expect(out.join('')).toContain('review');
 expect(await main(['review','--thread',randomUUID(),'--decision','approve'],deps)).toBe(2);
 expect(await main(['demo'],deps)).toBe(1);expect(err.join('')).toContain('MODEL_CONFIG_REQUIRED');
});
