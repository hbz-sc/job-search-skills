export const DEFAULT_LIMITS = Object.freeze({decisionTurns:3,toolAttempts:2,modelAttempts:12,profileAttempts:2,revisions:2,modelTimeoutMs:45000,toolTimeoutMs:15000,activeMs:180000});
export type Limits = {-readonly [K in keyof typeof DEFAULT_LIMITS]:number};
export type JobpilotConfig = {model:string;baseUrl:string;apiKey:string;limits:Limits};
export function loadJobpilotConfig(env:Record<string,string|undefined>):JobpilotConfig{
 const limits:Limits={...DEFAULT_LIMITS};
 for(const key of Object.keys(limits) as (keyof Limits)[]){
  const name='JOBPILOT_'+key.replace(/[A-Z]/g,c=>'_'+c).toUpperCase();
  if(env[name]!==undefined){const n=Number(env[name]);if(!Number.isSafeInteger(n)||n<1||n>DEFAULT_LIMITS[key])throw Error('INVALID_LIMIT: '+key);limits[key]=n;}
 }
 return {model:env.JOBPILOT_MODEL??'',baseUrl:env.JOBPILOT_BASE_URL??'',apiKey:env.JOBPILOT_API_KEY??'',limits};
}
