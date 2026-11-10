/** JobPilot is a standalone local CLI: never inherit another project's tracing. */
export function disableExternalTracing(){
 process.env.LANGSMITH_TRACING='false';process.env.LANGCHAIN_TRACING_V2='false';
 delete process.env.LANGCHAIN_TRACING;process.env.LANGCHAIN_VERBOSE='false';
}
