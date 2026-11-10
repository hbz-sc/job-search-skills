import {z} from 'zod';
import {ROLE_KEYWORDS,searchQuerySchema,type SearchQuery} from '../jobpilot/search-types.js';
const id=z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),digest=z.string().regex(/^[a-f0-9]{64}$/);
export const searchScopeSchema=z.object({mode:z.enum(['preview','run']),batchId:id,planHash:digest,allowedKeywords:z.array(z.enum(Object.values(ROLE_KEYWORDS) as [string,...string[]])).min(1).max(4),city:z.enum(['深圳','current']),experienceBands:z.tuple([z.literal('exp_1_3'),z.literal('exp_3_5')]),maxContacts:z.number().int().min(0).max(150),experienceMode:z.enum(['manual','auto']).optional(),expectedPhraseHash:digest.nullable()}).strict().refine(s=>new Set(s.allowedKeywords).size===s.allowedKeywords.length&&(s.mode==='preview'?s.maxContacts===0:s.expectedPhraseHash!==null));
export type SearchScope=z.infer<typeof searchScopeSchema>;
export function parseSearchScope(raw:unknown){return searchScopeSchema.parse(raw);}
const pageJob=z.object({key:z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/),title:z.string(),company:z.string(),url:z.string().optional(),unsupportedChat:z.boolean().optional()});
const viewSchema=z.object({observedKeyword:z.string(),observedCity:z.string(),observedExperience:z.enum(['exp_1_3','exp_3_5']),filterEvidence:z.object({keyword:z.string().min(1),city:z.string().min(1),experience:z.string().min(1),results:z.string().min(1)}).strict(),jobs:z.array(pageJob).max(200),exhausted:z.boolean()});
export type SearchView=z.infer<typeof viewSchema>;
export function parseSearchView(raw:unknown,expected:SearchQuery):SearchView{
 const q=searchQuerySchema.parse(expected);const v=viewSchema.parse(raw);
 if(v.observedKeyword!==q.keyword||(!v.observedCity.trim()||v.observedCity==='current'||q.city!=='current'&&v.observedCity!==q.city)||v.observedExperience!==q.experience)throw Error('FILTER_UNVERIFIED');return v;
}
