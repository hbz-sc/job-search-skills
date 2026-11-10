export type PageScope={mode:'search_only'|'greet_once'|'batch';maxContacts:number};
export type QuotaRetry={authorizedOn:string;pageChecked:boolean};
export const shanghaiDate=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function assertPageRunPolicy(scope:PageScope,profile:Record<string,unknown>,blockers:string[],sendAuthorized=false,retry?:QuotaRetry):void{
 if(!['search_only','greet_once','batch'].includes(scope.mode)||!Number.isSafeInteger(scope.maxContacts)||scope.maxContacts<0||scope.maxContacts>1000||scope.mode==='search_only'&&scope.maxContacts!==0||scope.mode==='greet_once'&&scope.maxContacts!==1||scope.mode==='batch'&&scope.maxContacts<1)throw Error('INVALID_SCOPE');
 if(scope.mode==='search_only')return;
 if(!sendAuthorized)throw Error('SEND_AUTHORIZATION_REQUIRED');
 if(blockers.length)throw Error(blockers.join(','));
 if(profile.greeting_quota_exhausted_date){
  const date=profile.greeting_quota_exhausted_date;
  if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!retry?.pageChecked||retry.authorizedOn!==shanghaiDate()||date>=retry.authorizedOn)throw Error('HISTORICAL_QUOTA_UNVERIFIED');
 }
}
