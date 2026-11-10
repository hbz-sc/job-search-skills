import {it,expect} from 'vitest';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const {allowedUrl,validateSender,validateTarget}=await import(pathToFileURL(resolve('extensions/boss-page/binding.js')).href);
const b={sessionId:'s',tabId:4,frameId:0,documentId:'d'};
it('rejects lookalike domains and unrelated tabs or frames',()=>{
 expect(allowedUrl('https://www.zhipin.com/web/geek/jobs')).toBe(true);
 for(const url of ['https://www.zhipin.com.evil.test/web/geek/jobs','http://www.zhipin.com/web/geek/jobs','https://www.zhipin.com/job_detail/a.html','chrome://newtab'])expect(allowedUrl(url)).toBe(false);
 expect(validateSender({tab:{id:4},frameId:0,documentId:'d'},b)).toBe(true);
 for(const sender of [{tab:{id:5},frameId:0,documentId:'d'},{tab:{id:4},frameId:1,documentId:'d'},{tab:{id:4},frameId:0,documentId:'new'}])expect(validateSender(sender,b)).toBe(false);
 expect(()=>validateTarget({...b,documentId:'new'},b)).toThrow('BINDING_CHANGED');
});
