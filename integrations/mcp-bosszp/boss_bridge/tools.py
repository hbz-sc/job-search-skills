import asyncio
from datetime import datetime,timezone
import json
from pathlib import Path
import re
from jsonschema import Draft202012Validator,FormatChecker
from .journal import Journal
from .workflow import Runs,VALIDATOR as WORKFLOW_VALIDATOR,SEARCH_VALIDATOR,CURRENT_LIST_VALIDATOR

SCHEMA=json.loads((Path(__file__).resolve().parents[3]/'contracts/boss-extension-v1.schema.json').read_text(encoding='utf-8'))
VALIDATOR=Draft202012Validator(SCHEMA,format_checker=FormatChecker())

class Bridge:
    def __init__(self,journal:Journal,send,root:Path):
        self.journal=journal;self.send=send;self.root=root
        self.binding=None;self.pending={};self.stopped=set();self.lock=asyncio.Lock();self.connected=True
        self.runs=Runs();self.workflow_version=None;self.search_version=None
        self.current_list_version=None
    def receive(self,message):
        kind=message.get('kind')
        if kind=='bind':
            binding=message.get('binding')
            Draft202012Validator(SCHEMA['properties']['context']['properties']['binding']).validate(binding)
            self.binding=binding;self.connected=True
            self.workflow_version=message.get('workflowVersion')
            self.search_version=message.get('searchVersion')
            self.current_list_version=message.get('currentListVersion')
            self.journal.event('session',None,'extension_bound',binding)
        elif kind=='event':
            rid=message.get('requestId'); run=self.journal.run_for_request(rid)
            stages={'extension_received','content_received','validated','dom_read_complete','dom_action_complete','experience_pointer','expected_navigation','document_changed','tab_removed','history_changed','content_started','content_exited','content_error','extension_stopped'}
            stage=message.get('stage')
            if stage in stages:
                self.journal.event(run or 'session',rid,stage,message.get('meta',{}))
                if stage in {'document_changed','tab_removed'}:self.binding=None
        elif kind=='result':
            result=message.get('result',{}); item=self.pending.get(result.get('requestId'))
            if item and not item[1].done():
                if result.get('phase') not in {'observed','rejected','failed','uncertain'}:raise ValueError('INVALID_RESULT')
                item[1].set_result(result)
    async def dispatch(self,command):
        workflow=command.get('version') in {2,3,4}
        try:(CURRENT_LIST_VALIDATOR if command.get('version')==4 else SEARCH_VALIDATOR if command.get('version')==3 else WORKFLOW_VALIDATOR if workflow else VALIDATOR).validate(command)
        except Exception:raise ValueError('INVALID_COMMAND') from None
        ctx=command['context'];rid=ctx['requestId'];run=ctx['runId']
        async with self.lock:
            if not self.journal.accept(rid,run,command):return self.journal.result(rid)
            self.journal.event(run,rid,'mcp_received',{'tool':command['tool']})
            def reject(code):
                r={'requestId':rid,'phase':'rejected','error':{'code':code,'message':code},'evidenceIds':[]}
                self.journal.finish(rid,r);self.journal.event(run,rid,'rejected',{'code':code});return r
            if run in self.stopped:return reject('RUN_STOPPED')
            if not self.connected:return reject('NATIVE_DISCONNECTED')
            if ctx['binding']!=self.binding:return reject('BINDING_CHANGED')
            if workflow:
                if self.workflow_version!=1:return reject('EXTENSION_UPDATE_REQUIRED')
                if command.get('version')==3 and self.search_version!=1:return reject('EXTENSION_UPDATE_REQUIRED')
                if command.get('version')==4 and self.current_list_version!=1:return reject('EXTENSION_UPDATE_REQUIRED')
                try:self.runs.check(command)
                except ValueError as e:return reject(str(e))
            seconds=(datetime.fromisoformat(ctx['deadline'].replace('Z','+00:00'))-datetime.now(timezone.utc)).total_seconds()
            if seconds<=0:return reject('DEADLINE_EXPIRED')
            future=asyncio.get_running_loop().create_future();self.pending[rid]=(run,future)
            try:
                self.journal.finish(rid,{'requestId':rid,'phase':'executing','evidenceIds':[]})
                self.journal.event(run,rid,'native_dispatched',ctx['binding'])
                if workflow:self.runs.dispatched(command)
                self.send({'kind':'command','command':command})
                result=await asyncio.wait_for(future,min(seconds,20 if workflow else 10))
            except TimeoutError:result=self.journal.unknown(rid,'CONTENT_RESPONSE_TIMEOUT')
            except Exception:result=self.journal.unknown(rid,'NATIVE_DISCONNECTED')
            finally:self.pending.pop(rid,None)
            result['evidenceIds']=[e['id'] for e in self.journal.events(run) if e['requestId']==rid]
            self.journal.finish(rid,result);self.journal.event(run,rid,'result_persisted',{'phase':result['phase']})
            if workflow:
                if result['phase']=='observed' and run not in self.stopped:self.runs.observed(command,result)
                else:self.stop(run)
            return result
    def disconnect(self):
        self.connected=False;self.binding=None
        for _,future in self.pending.values():
            if not future.done():future.set_exception(ConnectionError('NATIVE_DISCONNECTED'))
    def stop(self,run):
        if not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}',run):raise ValueError('INVALID_RUN')
        self.stopped.add(run)
        self.runs.stop(run)
        if self.workflow_version==1:
            try:self.send({'kind':'stop','runId':run})
            except Exception:pass
        self.journal.event(run,None,'run_stopped',{})
        return {'runId':run,'stopped':True,'writeEnabled':False}
    def diagnostics(self,run):
        if not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}',run):raise ValueError('INVALID_RUN')
        events=self.journal.events(run)
        lifecycle=self.journal.events('session')
        boundaries=['mcp_received','native_dispatched','extension_received','validated','content_received','dom_read_complete','dom_action_complete']
        requests=[]
        for result in self.journal.results_for_run(run):
            stages={e['stage'] for e in events if e['requestId']==result['requestId']}
            reached=[stage for stage in boundaries if stage in stages]
            requests.append({'requestId':result['requestId'],'lastBoundary':reached[-1] if reached else 'not_received','phase':result['phase'],'errorCode':result.get('error',{}).get('code')})
        summary={'runId':run,'lastBoundary':requests[-1]['lastBoundary'] if requests else 'not_received','requests':requests,'stopped':any(e['stage']=='run_stopped' for e in events),'events':events,'lifecycle':lifecycle,'writeEnabled':False,'attribution':'Lifecycle changes without a correlated command have unknown cause.'}
        directory=self.root/'diagnostics'/run;directory.mkdir(parents=True,exist_ok=True)
        (directory/'events.jsonl').write_text('\n'.join(json.dumps(e,ensure_ascii=False) for e in events+lifecycle),encoding='utf-8')
        (directory/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
        return summary
