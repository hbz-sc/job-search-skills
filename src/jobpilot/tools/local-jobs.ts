import type {JobBundle,JobSummary,DetailObservation} from '../types.js';
export class LocalJobSource{
 constructor(private readonly jobs:JobBundle){}
 async listJobs():Promise<JobSummary[]>{return structuredClone(this.jobs.summaries);}
 async getJobDetail(jobId:string):Promise<DetailObservation>{const detail=this.jobs.details.find(j=>j.jobId===jobId);return detail?{status:'ok',detail:structuredClone(detail)}:{status:'not_found',message:'岗位正文未提供'};}
}
