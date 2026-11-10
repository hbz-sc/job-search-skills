import {test,expect} from 'vitest';
import path from 'node:path';
import {connectTransport} from '../src/mcp/client.js';
import {HiddenStdioTransport} from '../src/mcp/stdio.js';
import {decodeToolResult} from '../src/mcp/result.js';
import {McpBossPages} from '../src/browser/mcp-boss-pages.js';
import {productionContract} from '../src/browser/mcp-selectors.js';
import {mcpSite} from './fixtures/mcp-site.js';
test('installed MCP server executes fixed adapter scripts and returns decodable results on localhost only',async()=>{
 const site=await mcpSite();const signal=new AbortController().signal;
 // This isolated headless browser belongs solely to this localhost test, never to live BOSS.
 const port=await connectTransport(new HiddenStdioTransport(process.execPath,[path.resolve('node_modules/@playwright/mcp/cli.js'),'--browser','msedge','--headless','--isolated','--no-webmcp'],process.cwd()),10000,signal);
 try{
  const initial=await port.call('browser_run_code_unsafe',{code:`async page => { await page.goto(${JSON.stringify(site.url+'/web/geek/jobs')}); return {schemaVersion:1,value:page.url()}; }`},signal);
  expect(decodeToolResult(initial).value).toBe(site.url+'/web/geek/jobs');
  const pages=new McpBossPages(port,{connection:{kind:'extension',profileDirName:'Default'},signal,timeoutMs:2000,allowedOrigin:site.url,contract:{...productionContract,version:'fixture',verified:true,account:'.user-name',accountAttribute:'data-user-id',empty:'.empty'}});
  expect((await pages.account())?.key).toBe('account-1');await pages.search('深圳','AI');expect((await pages.visibleJobs()).map(j=>j.key)).toEqual(['one']);
 }finally{await port.close();await site.close();}
},20000);
