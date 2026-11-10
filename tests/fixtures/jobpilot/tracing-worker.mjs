import {createModelAdapter} from '../../../dist/src/jobpilot/model.js';import {loadJobpilotConfig} from '../../../dist/src/jobpilot/config.js';import {createJobpilotService} from '../../../dist/src/jobpilot/service.js';import {demoInput,fakeModel} from '../../../dist/tests/fixtures/jobpilot/model.js';
const [root,url]=process.argv.slice(2);const config=loadJobpilotConfig({JOBPILOT_MODEL:'synthetic',JOBPILOT_BASE_URL:url+'/v1',JOBPILOT_API_KEY:'fake'});
const adapter=createModelAdapter(config);await adapter.request({operation:'analyze',messages:[{role:'user',content:'synthetic'}]},AbortSignal.timeout(5000));
const service=await createJobpilotService({root,model:fakeModel(),config});try{await service.analyze(demoInput());}finally{await service.close();}
await new Promise(r=>setTimeout(r,250));
