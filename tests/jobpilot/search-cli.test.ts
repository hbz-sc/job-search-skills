import {test,expect} from 'vitest';import {searchMain} from '../../src/jobpilot/search-cli.js';
test('CLI run uses one total default cap; resume rejects scope changes and safe error output hides secrets',async()=>{
 const out:string[]=[],err:string[]=[];const service:any={async run(plan:string,template:string,n:number){return {plan,template,n};}};
 expect(await searchMain(['run','--plan','p','--template','t'],{service,stdout:s=>out.push(s),stderr:s=>err.push(s)})).toBe(0);expect(JSON.parse(out[0]).n).toBe(10);
 expect(await searchMain(['resume','--batch','b','--max-contacts','100'],{service,stderr:s=>err.push(s)})).toBe(2);
 service.run=async()=>{throw Error('SECRET_KEY_AND_PROVIDER_DETAILS');};expect(await searchMain(['run','--plan','p','--template','t'],{service,stderr:s=>err.push(s)})).toBe(1);expect(err.join('')).not.toContain('SECRET_KEY');
});
