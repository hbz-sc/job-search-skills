// Preview has zero contact allowance at every protocol layer. Historical send
// uncertainty gates new communication, but must not prevent inspecting filters.
export function searchBlockers(mode:'preview'|'run',blockers:string[]){
 return mode==='preview'?blockers.filter(code=>!['UNRESOLVED_CONTACT','LEGACY_UNRESOLVED_CONTACT'].includes(code)):blockers;
}
