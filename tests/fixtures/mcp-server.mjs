import readline from 'node:readline';
let calls=[];
const send=(id,result)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\n');
for await(const line of readline.createInterface({input:process.stdin})) {
 const q=JSON.parse(line);
 if(q.method==='initialize')send(q.id,{protocolVersion:q.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}});
 if(q.method==='tools/list')send(q.id,{tools:['browser_snapshot','browser_tabs','browser_run_code_unsafe','browser_take_screenshot'].map(name=>({name,inputSchema:{type:'object',properties:name==='browser_run_code_unsafe'?{code:{type:'string'}}:{},additionalProperties:true}}))});
 if(q.method==='tools/call'){
  calls.push(q.params);const mode=q.params.arguments?.code;
  if(mode==='disconnect'){process.exit(0);}
  if(mode==='delay'){setTimeout(()=>send(q.id,{content:[{type:'text',text:'late'}]}),1000);continue;}
  if(mode==='error'){send(q.id,{isError:true,content:[{type:'text',text:'fixture error {"token":"SECRET"} MESSAGE_BODY'}]});continue;}
  send(q.id,{content:[{type:'text',text:JSON.stringify({schemaVersion:1,calls})}]});
 }
}
