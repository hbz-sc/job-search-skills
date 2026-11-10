export function allowedUrl(value){
 try{const u=new URL(value);return u.origin==='https://www.zhipin.com'&&/^\/web\/geek\/(jobs|chat)(?:\/|$)/.test(u.pathname);}catch{return false;}
}
export function validateSender(sender,binding){return Boolean(binding&&sender.tab?.id===binding.tabId&&sender.frameId===0&&sender.documentId===binding.documentId);}
export function validateTarget(target,binding){if(!binding||['sessionId','tabId','frameId','documentId'].some(k=>target?.[k]!==binding[k]))throw Error('BINDING_CHANGED');}
