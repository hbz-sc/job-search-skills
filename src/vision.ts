export function visionStatus(env:Record<string,string|undefined>):'disabled'|'not_configured'|'reserved' {
 if(env.VISION_ENABLED!=='true')return 'disabled';
 return env.DASHSCOPE_API_KEY?.trim()?'reserved':'not_configured';
}
