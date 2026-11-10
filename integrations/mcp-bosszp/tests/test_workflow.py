import asyncio
from datetime import datetime,timedelta,timezone
from pathlib import Path
import sys,tempfile,unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from boss_bridge.tools import Bridge
from boss_bridge.journal import Journal

class WorkflowTests(unittest.IsolatedAsyncioTestCase):
 async def asyncSetUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.j=Journal(Path(self.tmp.name)/'j.sqlite');self.sent=[]
  self.b=Bridge(self.j,self.sent.append,Path(self.tmp.name));self.binding={'sessionId':'s','tabId':1,'frameId':0,'documentId':'d'}
  self.b.receive({'kind':'bind','binding':self.binding,'workflowVersion':1})
 async def asyncTearDown(self):self.j.close();self.tmp.cleanup()
 def command(self,tool,payload,rid='q'):
  return {'version':2,'tool':tool,'payload':payload,'context':{'runId':'r','requestId':rid,'binding':self.binding,'deadline':(datetime.now(timezone.utc)+timedelta(seconds=10)).isoformat(),'leaseId':'lease'}}
 async def finish(self,pending,value):
  await asyncio.sleep(.02);rid=self.sent[-1]['command']['context']['requestId']
  self.b.receive({'kind':'result','result':{'requestId':rid,'phase':'observed','value':value,'evidenceIds':[]}})
  return await pending
 async def test_requires_live_lease_rejects_contact_in_search_scope_and_stops_extension(self):
  c=self.command('list_jobs',{'advance':True})
  self.assertEqual((await self.b.dispatch(c))['phase'],'rejected');self.assertEqual(len(self.sent),0)
  start=self.command('start_run',{'mode':'search_only','maxContacts':0},'start')
  await self.finish(asyncio.create_task(self.b.dispatch(start)),{'leaseId':'lease'})
  contact=self.command('open_chat',{'jobKey':'job'},'contact')
  self.assertEqual((await self.b.dispatch(contact))['error']['code'],'SCOPE_DENIED')
  read=self.command('list_jobs',{'advance':True},'read')
  self.assertEqual((await self.finish(asyncio.create_task(self.b.dispatch(read)),{'jobs':[]}))['phase'],'observed')
  self.b.stop('r');self.assertEqual(self.sent[-1]['kind'],'stop')
 async def test_bad_payload_never_reaches_native_and_unknown_stops_remaining_actions(self):
  c=self.command('search_jobs',{'city':'深圳','keyword':'AI应用开发工程师','url':'https://evil.test'})
  with self.assertRaises(ValueError):await self.b.dispatch(c)
  await self.finish(asyncio.create_task(self.b.dispatch(self.command('start_run',{'mode':'greet_once','maxContacts':1},'start'))),{})
  pending=asyncio.create_task(self.b.dispatch(self.command('open_chat',{'jobKey':'job'},'contact')));await asyncio.sleep(.02)
  self.b.receive({'kind':'result','result':self.j.unknown('contact')});self.assertEqual((await pending)['phase'],'uncertain')
  self.assertEqual((await self.b.dispatch(self.command('open_chat',{'jobKey':'job2'},'next')))['error']['code'],'RUN_STOPPED')
 async def test_stop_while_start_is_pending_does_not_resurrect_lease(self):
  pending=asyncio.create_task(self.b.dispatch(self.command('start_run',{'mode':'search_only','maxContacts':0},'start')));await asyncio.sleep(.02)
  self.b.stop('r');self.b.receive({'kind':'result','result':{'requestId':'start','phase':'observed','value':{},'evidenceIds':[]}})
  await pending;self.assertIsNone(self.b.runs.active)
