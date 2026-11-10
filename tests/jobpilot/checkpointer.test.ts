import {test,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';
import {Annotation,StateGraph,START,END} from '@langchain/langgraph';
import {openCheckpointer} from '../../src/jobpilot/checkpointer.js';
test('disk checkpoint survives close and reopen',async()=>{
 const file=path.join(mkdtempSync(path.join(tmpdir(),'jobpilot-cp-')),'state.sqlite');
 const state=Annotation.Root({count:Annotation<number>});
 const make=(saver:Awaited<ReturnType<typeof openCheckpointer>>['saver'])=>new StateGraph(state).addNode('increment',()=>({count:1})).addEdge(START,'increment').addEdge('increment',END).compile({checkpointer:saver});
 const config={configurable:{thread_id:'checkpoint-test'}};
 const a=await openCheckpointer(file);await make(a.saver).invoke({count:0},config);await a.close();
 const b=await openCheckpointer(file);try{expect((await make(b.saver).getState(config)).values.count).toBe(1);}finally{await b.close();}
});
