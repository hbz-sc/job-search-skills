import unittest
import json
from pathlib import Path
from datetime import datetime,timedelta,timezone
from boss_bridge.workflow import Runs,SEARCH_VALIDATOR

SCOPE={'mode':'run','batchId':'batch','planHash':'a'*64,'allowedKeywords':['Java开发工程师'],'city':'深圳','experienceBands':['exp_1_3','exp_3_5'],'maxContacts':1,'expectedPhraseHash':'b'*64}
def command(tool,payload,version=3):
 return {'version':version,'tool':tool,'payload':payload,'context':{'runId':'r','leaseId':'l','requestId':'q','binding':{'sessionId':'s','tabId':1,'frameId':0,'documentId':'d'},'deadline':(datetime.now(timezone.utc)+timedelta(seconds=10)).isoformat()}}
class SearchWorkflowTests(unittest.TestCase):
 def test_query_cannot_widen_city_scope(self):
  r=Runs();start=command('start_run',SCOPE);r.check(start);r.observed(start)
  with self.assertRaisesRegex(ValueError,'SCOPE_DENIED'):
   r.check(command('search_jobs',{'city':'current','keyword':'Java开发工程师','experience':'exp_1_3'}))
 def test_current_city_contract_and_preview_no_send(self):
  r=Runs();start=command('start_run',{**SCOPE,'city':'current','mode':'preview','maxContacts':0,'expectedPhraseHash':None})
  SEARCH_VALIDATOR.validate(start);r.check(start);r.observed(start)
  query=command('search_jobs',{'city':'current','keyword':'Java开发工程师','experience':'exp_1_3'})
  SEARCH_VALIDATOR.validate(query);r.check(query)
  with self.assertRaisesRegex(ValueError,'SCOPE_DENIED'):r.check(command('open_chat',{'jobKey':'j'}))
 def test_shared_contract_vectors(self):
  fixture=json.loads((Path(__file__).resolve().parents[3]/'tests/fixtures/boss-search-contract.json').read_text(encoding='utf-8'))
  for vector in fixture['vectors']:
   with self.subTest(vector['name']):
    cmd=command('start_run',{**fixture['scope'],**vector['patch']})
    if vector['valid']:SEARCH_VALIDATOR.validate(cmd)
    else:
     with self.assertRaises(Exception):SEARCH_VALIDATOR.validate(cmd)
 def test_scope_query_hash_and_remaining_budget(self):
  r=Runs();start=command('start_run',SCOPE);SEARCH_VALIDATOR.validate(start);r.check(start);r.observed(start)
  good=command('search_jobs',{'city':'深圳','keyword':'Java开发工程师','experience':'exp_1_3'});SEARCH_VALIDATOR.validate(good);r.check(good)
  for bad in [command('search_jobs',{**good['payload'],'keyword':'AI应用开发工程师'}),command('choose_first_phrase',{'conversationKey':'c','expectedHash':'c'*64})]:
   with self.assertRaisesRegex(ValueError,'SCOPE_DENIED'):r.check(bad)
  contact=command('open_chat',{'jobKey':'j'});r.check(contact);r.dispatched(contact)
  with self.assertRaisesRegex(ValueError,'CONTACT_LIMIT'):r.check(contact)
  with self.assertRaisesRegex(ValueError,'VERSION_MISMATCH'):r.check(command('renew_run',{},2))
 def test_preview_and_zero_remaining(self):
  for mode in ['preview','run']:
   r=Runs();s={**SCOPE,'mode':mode,'maxContacts':0,'expectedPhraseHash':None if mode=='preview' else 'b'*64};c=command('start_run',s);SEARCH_VALIDATOR.validate(c);r.check(c);r.observed(c)
   with self.assertRaises(ValueError):r.check(command('open_chat',{'jobKey':'j'}))
 def test_extra_fields_and_invalid_conditions(self):
  for patch in [{'city':'北京'},{'maxContacts':151},{'experienceBands':['exp_5_10']},{'allowedKeywords':['arbitrary']},{'script':'bad'}]:
   with self.assertRaises(Exception):SEARCH_VALIDATOR.validate(command('start_run',{**SCOPE,**patch}))
 def test_fixed_auto_scope_150_and_receipt_contract(self):
  r=Runs();c=command('start_run',{**SCOPE,'maxContacts':150,'experienceMode':'auto'});SEARCH_VALIDATOR.validate(c);r.check(c);r.observed(c)
  contact=command('open_chat',{'jobKey':'j'})
  for _ in range(150):r.check(contact);r.dispatched(contact)
  with self.assertRaisesRegex(ValueError,'CONTACT_LIMIT'):r.check(contact)
  for tool in ('submit_filled_phrase','inspect_send_result'):
   payload={'conversationKey':'j','expectedHash':'b'*64,'receipt':{'beforeCount':0,'beforeHash':'a'*64}}
   SEARCH_VALIDATOR.validate(command(tool,payload));r.check(command(tool,payload))
   with self.assertRaises(Exception):SEARCH_VALIDATOR.validate(command(tool,{**payload,'receipt':{'beforeCount':-1,'beforeHash':'a'*64}}))
