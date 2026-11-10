import hmac
from fastmcp import FastMCP
from starlette.responses import JSONResponse
from .workflow import SCHEMA_HASH,SEARCH_SCHEMA_HASH,CURRENT_LIST_SCHEMA_HASH

def create_app(session,bridge):
    mcp=FastMCP('boss-page-bridge')
    @mcp.tool
    async def inspect_session(command:dict)->dict:
        """Read the bound BOSS page only. No navigation, login or sending."""
        if bridge is None:raise ValueError('EXTENSION_NOT_CONNECTED')
        if command.get('version')!=1:raise ValueError('READ_ONLY_TOOL')
        return await bridge.dispatch(command)
    @mcp.tool
    async def execute_action(command:dict)->dict:
        """Execute one schema-validated, leased BOSS business action (v2/v3/v4)."""
        if bridge is None or command.get('version') not in {2,3,4}:raise ValueError('INVALID_WORKFLOW')
        return await bridge.dispatch(command)
    @mcp.tool
    async def get_action_result(requestId:str)->dict:
        """Query a previous request; never execute it again."""
        return bridge.journal.result(requestId)
    @mcp.tool
    async def get_diagnostics(runId:str)->dict:
        """Return redacted component-boundary events."""
        return bridge.diagnostics(runId)
    @mcp.tool
    async def stop_run(runId:str)->dict:
        """Stop this read-only run; keep the browser and tabs open."""
        return bridge.stop(runId)
    app=mcp.http_app(path='/mcp',stateless_http=True,json_response=True)
    async def health(request):
        return JSONResponse({'protocolVersion':1,'sessionId':session.id,'binding':bridge.binding if bridge else None,'writeEnabled':False,'workflowVersion':bridge.workflow_version if bridge else None,'schemaHash':SCHEMA_HASH,'searchVersion':bridge.search_version if bridge else None,'searchSchemaHash':SEARCH_SCHEMA_HASH,'currentListVersion':bridge.current_list_version if bridge else None,'currentListSchemaHash':CURRENT_LIST_SCHEMA_HASH})
    app.add_route('/health',health,methods=['GET'])
    class Auth:
        def __init__(self,inner):self.inner=inner
        async def __call__(self,scope,receive,send):
            if scope['type']=='http':
                pairs=scope.get('headers',[])
                headers={k.decode().lower():v.decode() for k,v in pairs}
                host=f'127.0.0.1:{session.port}'
                duplicates=any(sum(k.decode().lower()==name for k,v in pairs)>1 for name in ['host','origin','authorization','x-boss-session'])
                ok=(not duplicates and headers.get('host')==host and headers.get('origin',f'http://{host}')==f'http://{host}' and hmac.compare_digest(headers.get('authorization',''),'Bearer '+session.token) and hmac.compare_digest(headers.get('x-boss-session',''),session.id))
                if not ok:
                    await JSONResponse({'error':'SESSION_AUTH_REJECTED'},status_code=403)(scope,receive,send);return
            await self.inner(scope,receive,send)
    return Auth(app)
