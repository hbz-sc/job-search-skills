import {z} from 'zod';
const text=z.string().trim().min(1);const bounded=(max:number)=>text.refine(s=>Array.from(s).length<=max,'text too long');
export const evidenceSchema=z.object({id:text,source:z.enum(['resume','job']),text,sourceHash:text});
export const preferencesSchema=z.object({targetRoles:z.array(text).default([]),preferredCities:z.array(text).default([]),hardConstraints:z.object({cities:z.array(text).optional(),minMonthlySalaryCny:z.number().nonnegative().optional()}).default({})}).strict();
export const summarySchema=z.object({jobId:text,title:text,company:text,city:text.optional(),salary:text.optional(),url:z.url().optional(),source:text,capturedAt:text}).strict();
export const detailInputSchema=z.object({jobId:text,description:bounded(20000),requirements:z.array(text).optional(),source:text,capturedAt:text}).strict();
export const bundleSchema=z.object({schemaVersion:z.literal(1),summaries:z.array(summarySchema).min(1).max(10),details:z.array(detailInputSchema).max(10),initialDetailIds:z.array(text).default([])}).strict();
export const analysisSchema=z.object({
 recommendation:z.enum(['recommended','consider','not_recommended','insufficient_information']),
 requirements:z.array(z.object({requirementId:text,text,priority:z.enum(['must','preferred','unspecified']),jobEvidenceIds:z.array(text).min(1)})),
 matches:z.array(z.object({requirementId:text,resumeEvidenceIds:z.array(text).min(1),reason:text})),
 gaps:z.array(z.object({requirementId:text,reason:text})),unknowns:z.array(text),rationale:text
}).strict();
export const draftSchema=z.object({text:bounded(4000),evidenceIds:z.array(text).min(1)}).strict();
export const profileSchema=z.object({facts:z.array(z.object({text,evidenceIds:z.array(text).min(1)}))}).strict();
export const reviewSchema=z.object({reviewId:z.uuid(),threadId:z.uuid(),draftVersion:z.number().int().min(1),decision:z.enum(['approve','revise','reject']),feedback:bounded(2000).optional()}).strict().refine(r=>r.decision!=='revise'||!!r.feedback,'feedback required');
export const resumeTextSchema=bounded(20000);
