import {StateGraph,START,END} from '@langchain/langgraph';import {SearchState} from './search-state.js';import {searchNodes,type SearchGraphDependencies} from './search-nodes.js';import {disableExternalTracing} from './privacy.js';
export type {SearchGraphDependencies} from './search-nodes.js';
export function createSearchGraph(deps:SearchGraphDependencies){
 disableExternalTracing();const n=searchNodes(deps);
 const graph=new StateGraph(SearchState)
 .addNode('load_plan',n.load_plan).addNode('preflight',n.preflight).addNode('select_query',n.select_query).addNode('search_and_filter',n.search_and_filter).addNode('collect_candidates',n.collect_candidates).addNode('select_candidate',n.select_candidate).addNode('reserve_contact',n.reserve_contact).addNode('open_chat',n.open_chat).addNode('verify_phrase',n.verify_phrase).addNode('send_once',n.send_once).addNode('inspect_result',n.inspect_result).addNode('restore_search',n.restore_search).addNode('summarize',n.summarize)
 .addEdge(START,'load_plan')
 .addConditionalEdges('load_plan',({data})=>data.status==='running'?'preflight':'summarize')
 .addConditionalEdges('preflight',({data})=>data.status==='running'?'select_query':'summarize')
 .addConditionalEdges('select_query',({data})=>data.status==='running'?'search_and_filter':'summarize')
 .addConditionalEdges('search_and_filter',({data})=>data.status==='running'?'collect_candidates':'summarize')
 .addConditionalEdges('collect_candidates',({data})=>data.status==='running'?'select_candidate':'summarize')
 .addConditionalEdges('select_candidate',({data})=>data.status!=='running'?'summarize':data.currentJob?'reserve_contact':data.skipCurrent?'restore_search':data.advance?'search_and_filter':'select_query')
 .addConditionalEdges('reserve_contact',({data})=>data.status!=='running'?'summarize':data.skipCurrent?'restore_search':'open_chat')
 .addConditionalEdges('open_chat',({data})=>data.status!=='running'?'summarize':data.skipCurrent?'restore_search':'verify_phrase')
 .addConditionalEdges('verify_phrase',({data})=>data.status==='running'?'send_once':'summarize')
 .addConditionalEdges('send_once',({data})=>data.status==='running'?'inspect_result':'summarize')
 .addConditionalEdges('inspect_result',({data})=>data.status==='running'?'restore_search':'summarize')
 .addConditionalEdges('restore_search',({data})=>data.status==='running'?'collect_candidates':'summarize')
 .addEdge('summarize',END);
 return graph.compile({checkpointer:deps.checkpointer});
}
