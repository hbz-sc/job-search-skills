import {openPageWorkflowStore} from '../../../dist/src/boss-extension/store.js';
const [file,batchId]=process.argv.slice(2),page=openPageWorkflowStore(file);
try{let code='';try{page.search.reserveContact(batchId,{key:'eleventh',title:'Java',company:'Fixture',url:'https://www.zhipin.com/job_detail/eleventh.html'},'worker-eleventh');}catch(e){code=e.message;}console.log(JSON.stringify({used:page.search.getBatch(batchId).usedContacts,code}));}finally{page.close();}
