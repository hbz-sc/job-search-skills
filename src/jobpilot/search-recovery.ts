// Only transport/document failures can enter automatic recovery. A failed send
// observation is deliberately absent: losing a response never proves no send.
const recoverable=new Set(['BOSS_TAB_NOT_BOUND','HOST_NOT_CONNECTED','HOST_HANDSHAKE_FAILED','BINDING_CHANGED','DOCUMENT_CHANGED','NATIVE_DISCONNECTED','CONTENT_CHANNEL_FAILED','CONTENT_RESPONSE_TIMEOUT','PAGE_UNVERIFIED']);
export function recoveryCode(error:unknown){const message=error instanceof Error?error.message:String(error??'');return message.match(/^([A-Z_]+)(?=$|[:：])/)?.[1]??'CONNECTION_OR_EXECUTION_FAILED';}
export const canAutoRecover=(code:string)=>recoverable.has(code);
