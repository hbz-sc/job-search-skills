import {readFile,mkdir,writeFile} from 'node:fs/promises';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {bundleSchema,preferencesSchema,resumeTextSchema} from './schemas.js';import {hash,redactInput,makeEvidence} from './evidence.js';import type {ValidatedInputs,InputSnapshot} from './types.js';
export function prepareInputs(resumeText:unknown,jobs:unknown,preferences:unknown):ValidatedInputs{
 const text=redactInput(resumeTextSchema.parse(resumeText));const bundle=bundleSchema.parse(jobs);const ids=bundle.summaries.map(j=>j.jobId);
 if(new Set(ids).size!==ids.length||new Set(bundle.details.map(j=>j.jobId)).size!==bundle.details.length||bundle.details.some(j=>!ids.includes(j.jobId))||bundle.initialDetailIds.some(id=>!bundle.details.some(j=>j.jobId===id)))throw Error('invalid_input: job IDs');
 return {resume:{text,hash:hash(text),evidence:makeEvidence(text,'resume')},jobs:{...bundle,details:bundle.details.map(j=>{const description=redactInput(j.description);return {...j,description,requirements:j.requirements?.map(redactInput),hash:hash(description),evidence:makeEvidence(description,'job')};})},preferences:preferencesSchema.parse(preferences),sourceMode:'local'};
}
export async function loadInputs(paths:{resume:string;jobs:string;preferences:string}){
 if(!/\.(txt|md)$/i.test(paths.resume))throw Error('invalid_input: resume extension');
 const decode=async(file:string)=>new TextDecoder('utf-8',{fatal:true}).decode(await readFile(file));
 const [resume,jobs,prefs]=await Promise.all([decode(paths.resume),decode(paths.jobs),decode(paths.preferences)]);
 return prepareInputs(resume,JSON.parse(jobs),JSON.parse(prefs));
}
export async function freezeInputs(root:string,input:ValidatedInputs):Promise<InputSnapshot>{
 const dir=path.join(root,'private/jobpilot/inputs');await mkdir(dir,{recursive:true});const file=path.join(dir,randomUUID()+'.json');await writeFile(file,JSON.stringify(input,null,2),{flag:'wx'});
 return {file,hashes:{resume:input.resume.hash,jobs:hash(input.jobs),preferences:hash(input.preferences)},schemaVersion:1};
}
export async function readSnapshot(snapshot:InputSnapshot):Promise<ValidatedInputs>{
 if(snapshot.schemaVersion!==1)throw Error('incompatible_checkpoint');const input=JSON.parse(await readFile(snapshot.file,'utf8')) as ValidatedInputs;
 if(hash(input.resume.text)!==snapshot.hashes.resume||hash(input.jobs)!==snapshot.hashes.jobs||hash(input.preferences)!==snapshot.hashes.preferences)throw Error('invalid_input: snapshot changed');return input;
}
