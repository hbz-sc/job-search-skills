import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {ReadBuffer,serializeMessage} from '@modelcontextprotocol/sdk/shared/stdio.js';
import {getDefaultEnvironment} from '@modelcontextprotocol/sdk/client/stdio.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import type {JSONRPCMessage} from '@modelcontextprotocol/sdk/types.js';

/** SDK transport contract with hidden Windows children and owned-process-only teardown. */
export class HiddenStdioTransport implements Transport {
 onclose?:()=>void; onerror?:(error:Error)=>void; onmessage?:(message:JSONRPCMessage)=>void;
 private child?:ChildProcessWithoutNullStreams;
 private buffer=new ReadBuffer();
 constructor(private command:string,private args:string[],private cwd:string,private onStderr?:(line:string)=>void){}
 async start():Promise<void>{
  if(this.child)throw new Error('MCP transport already started');
  const env=getDefaultEnvironment();if(this.onStderr)env.DEBUG='pw:protocol';
  const c=spawn(this.command,this.args,{cwd:this.cwd,env,stdio:'pipe',windowsHide:true,shell:false});this.child=c;
  if(this.onStderr){let buffer='';c.stderr.on('data',data=>{buffer+=data.toString();let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);try{this.onStderr!(line);}catch{}}if(buffer.length>1048576)buffer='';});}
  else c.stderr.resume(); // Never persist raw stderr; diagnostics extracts only protocol metadata.
  c.on('close',()=>this.onclose?.());c.on('error',e=>this.onerror?.(e));
  c.stdin.on('error',e=>this.onerror?.(e));
  c.stdout.on('data',d=>{try{this.buffer.append(d);for(let m;(m=this.buffer.readMessage())!==null;)this.onmessage?.(m);}catch(e){this.onerror?.(e instanceof Error?e:new Error('Invalid MCP response'));}});
  await new Promise<void>((resolve,reject)=>{c.once('spawn',resolve);c.once('error',reject);});
 }
 async send(m:JSONRPCMessage){const c=this.child;if(!c||c.exitCode!==null)throw new Error('MCP closed');await new Promise<void>((resolve,reject)=>c.stdin.write(serializeMessage(m),e=>e?reject(e):resolve()));}
 async close(){const c=this.child;if(!c)return;this.child=undefined;if(c.exitCode!==null)return;
  await new Promise<void>(resolve=>{const timer=setTimeout(()=>{c.kill();resolve();},500);c.once('close',()=>{clearTimeout(timer);resolve();});c.stdin.end();});
 }
}
