import {it,expect} from 'vitest';
import {assertPageRunPolicy} from '../src/boss-extension/run-policy.js';
it('allows a fresh explicit retry of an older quota only with a current page check; never lifts current quota or unresolved contact',()=>{
 const scope={mode:'greet_once' as const,maxContacts:1};
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const profile={greeting_quota_exhausted_date:'2020-01-01'};
 const retry={authorizedOn:today,pageChecked:true};
 expect(()=>assertPageRunPolicy(scope,profile,[],true,retry)).not.toThrow();
 expect(()=>assertPageRunPolicy(scope,profile,[],false,retry)).toThrow('SEND_AUTHORIZATION_REQUIRED');
 expect(()=>assertPageRunPolicy(scope,profile,[],true,{...retry,pageChecked:false})).toThrow('HISTORICAL_QUOTA_UNVERIFIED');
 expect(()=>assertPageRunPolicy(scope,profile,[],true,{...retry,authorizedOn:'2020-01-02'})).toThrow('HISTORICAL_QUOTA_UNVERIFIED');
 expect(()=>assertPageRunPolicy(scope,{greeting_quota_exhausted_date:today},[],true,retry)).toThrow('HISTORICAL_QUOTA_UNVERIFIED');
 expect(()=>assertPageRunPolicy(scope,profile,['QUOTA_REACHED'],true,retry)).toThrow('QUOTA_REACHED');
 expect(()=>assertPageRunPolicy(scope,profile,['UNRESOLVED_CONTACT'],true,retry)).toThrow('UNRESOLVED_CONTACT');
});
it('manual default permits search but denies contact; authorization never clears historical quota',()=>{
 const profile={send_mode:'manual_only',greeting_quota_exhausted_date:'2026-10-26'};
 expect(()=>assertPageRunPolicy({mode:'search_only',maxContacts:0},profile,[],false)).not.toThrow();
 expect(()=>assertPageRunPolicy({mode:'greet_once',maxContacts:1},profile,[],false)).toThrow('SEND_AUTHORIZATION_REQUIRED');
 expect(()=>assertPageRunPolicy({mode:'greet_once',maxContacts:1},profile,[],true)).toThrow('HISTORICAL_QUOTA_UNVERIFIED');
 expect(()=>assertPageRunPolicy({mode:'greet_once',maxContacts:2},{},[],true)).toThrow();
 expect(()=>assertPageRunPolicy({mode:'batch',maxContacts:10},{},['UNRESOLVED_CONTACT'],true)).toThrow('UNRESOLVED_CONTACT');
});
