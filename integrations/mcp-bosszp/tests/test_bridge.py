import asyncio
from datetime import datetime,timedelta,timezone
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from boss_bridge.tools import Bridge
from boss_bridge.journal import Journal

class BridgeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.sent=[]
        self.j=Journal(Path(self.tmp.name)/'j.sqlite')
        self.b=Bridge(self.j,self.sent.append,Path(self.tmp.name))
        self.binding={'sessionId':'s','tabId':3,'frameId':0,'documentId':'d'}
        self.b.receive({'kind':'bind','binding':self.binding})
    async def asyncTearDown(self):self.j.close();self.tmp.cleanup()
    def command(self,rid='q'):
        return {'version':1,'tool':'inspect_session','context':{'runId':'r','requestId':rid,'binding':self.binding,'deadline':(datetime.now(timezone.utc)+timedelta(seconds=1)).isoformat()},'payload':{}}
    async def test_dispatch_boundaries_duplicate_and_stop(self):
        cmd=self.command();pending=asyncio.create_task(self.b.dispatch(cmd));await asyncio.sleep(.02)
        self.assertEqual(self.sent[-1]['command']['context']['requestId'],'q')
        self.b.receive({'kind':'result','result':{'requestId':'q','phase':'observed','value':{'ok':True},'evidenceIds':[]}})
        self.assertEqual((await pending)['phase'],'observed')
        self.assertEqual((await self.b.dispatch(cmd))['phase'],'observed')
        self.assertEqual(len(self.sent),1)
        self.b.stop('r')
        self.assertEqual((await self.b.dispatch(self.command('q2')))['error']['code'],'RUN_STOPPED')
        self.assertEqual(len(self.sent),1)
    async def test_navigation_disconnect_and_timeout_identify_last_boundary(self):
        pending=asyncio.create_task(self.b.dispatch(self.command()));await asyncio.sleep(.02)
        self.b.receive({'kind':'event','requestId':'q','stage':'content_received','meta':{}})
        self.b.disconnect()
        self.assertEqual((await pending)['error']['code'],'NATIVE_DISCONNECTED')
        self.assertIn('content_received',[x['stage'] for x in self.j.events('r')])
        self.b.receive({'kind':'bind','binding':{**self.binding,'documentId':'new'}})
        self.assertEqual((await self.b.dispatch(self.command('q3')))['error']['code'],'BINDING_CHANGED')
    async def test_deadline_and_unimplemented_write_never_dispatched(self):
        cmd=self.command();cmd['context']['deadline']='2020-01-01T00:00:00Z'
        self.assertEqual((await self.b.dispatch(cmd))['error']['code'],'DEADLINE_EXPIRED')
        cmd=self.command('write');cmd['tool']='open_chat'
        with self.assertRaises(ValueError):await self.b.dispatch(cmd)
        self.assertEqual(self.sent,[])
    async def test_late_content_event_keeps_persistent_request_run_association(self):
        pending=asyncio.create_task(self.b.dispatch(self.command()));await asyncio.sleep(.02)
        self.b.receive({'kind':'result','result':{'requestId':'q','phase':'observed','value':{'ok':True},'evidenceIds':[]}})
        await pending
        self.b.receive({'kind':'event','requestId':'q','stage':'dom_read_complete','meta':{}})
        self.assertIn('dom_read_complete',[e['stage'] for e in self.j.events('r')])
        self.assertNotIn('dom_read_complete',[e['stage'] for e in self.j.events('session')])
        # Persistent lookup must still work after replacing the in-memory bridge.
        self.b=Bridge(self.j,self.sent.append,Path(self.tmp.name))
        self.b.receive({'kind':'event','requestId':'q','stage':'content_received','meta':{}})
        self.assertIn('content_received',[e['stage'] for e in self.j.events('r')])
    async def test_summary_separates_execution_boundary_terminal_error_and_stop(self):
        for rid,stage in [('first',None),('second','dom_read_complete')]:
            pending=asyncio.create_task(self.b.dispatch(self.command(rid)));await asyncio.sleep(.02)
            if stage:self.b.receive({'kind':'event','requestId':rid,'stage':stage,'meta':{}})
            self.b.receive({'kind':'result','result':{'requestId':rid,'phase':'uncertain','error':{'code':'CONTENT_RESPONSE_TIMEOUT','message':'Unknown'},'evidenceIds':[]}})
            await pending
        self.b.stop('r')
        summary=self.b.diagnostics('r')
        self.assertEqual(summary['lastBoundary'],'dom_read_complete')
        self.assertEqual(summary['requests'][0]['lastBoundary'],'native_dispatched')
        self.assertEqual(summary['requests'][1]['phase'],'uncertain')
        self.assertEqual(summary['requests'][1]['errorCode'],'CONTENT_RESPONSE_TIMEOUT')
        self.assertTrue(summary['stopped'])

    async def test_pointer_phases_are_retained_without_private_payload(self):
        self.j.accept('q','r',self.command())
        self.b.receive({'kind':'event','requestId':'q','stage':'experience_pointer','meta':{'phase':'move_control_ack','body':'PRIVATE'}})
        events=[e for e in self.j.events('r') if e['stage']=='experience_pointer']
        self.assertEqual(len(events),1)
        self.assertEqual(events[0]['phase'],'move_control_ack')
        self.assertNotIn('PRIVATE',str(events))
