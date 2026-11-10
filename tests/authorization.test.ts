import {test,expect} from 'vitest';
import {assertAuthorized,type RunAuthorization} from '../src/authorization.js';
import {loadConfig} from '../src/config.js';
import {template} from '../src/domain.js';
const account={key:'one',displayName:'用户'},t=template('第一条');const c=loadConfig({keywords:['AI'],mode:'send',maxJobs:1},process.cwd());
const auth:RunAuthorization={accountKey:'one',city:'深圳',keywords:['AI'],templateHash:t.hash,filtersHash:'filters1',limit:{kind:'jobs',count:1},issuedAt:new Date().toISOString()};
test('only the explicitly reviewed account, query, filters, message and count are authorized',()=>{
 expect(()=>assertAuthorized(auth,account,c,t,'filters1')).not.toThrow();
 for(const bad of [undefined,{...auth,accountKey:'two'},{...auth,city:'广州'},{...auth,keywords:['Java']},{...auth,templateHash:'wrong'},{...auth,filtersHash:'wrong'},{...auth,limit:{kind:'jobs' as const,count:2}}])expect(()=>assertAuthorized(bad,account,c,t,'filters1')).toThrow();
 expect(()=>assertAuthorized({...auth,limit:{kind:'platform_quota'}},account,{...c,maxJobs:undefined},t,'filters1')).not.toThrow();
});
