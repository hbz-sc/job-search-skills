import hashlib,json,time,re
from pathlib import Path
from jsonschema import Draft202012Validator,FormatChecker
RAW=(Path(__file__).resolve().parents[3]/'contracts/boss-workflow-v2.schema.json').read_bytes()
SCHEMA_HASH=hashlib.sha256(RAW).hexdigest()
VALIDATOR=Draft202012Validator(json.loads(RAW),format_checker=FormatChecker())
SEARCH_RAW=(Path(__file__).resolve().parents[3]/'contracts/boss-search-v3.schema.json').read_bytes()
SEARCH_SCHEMA_HASH=hashlib.sha256(SEARCH_RAW).hexdigest()
SEARCH_VALIDATOR=Draft202012Validator(json.loads(SEARCH_RAW),format_checker=FormatChecker())
CURRENT_LIST_RAW=(Path(__file__).resolve().parents[3]/'contracts/boss-current-list-v4.schema.json').read_bytes()
CURRENT_LIST_SCHEMA_HASH=hashlib.sha256(CURRENT_LIST_RAW).hexdigest()
CURRENT_LIST_VALIDATOR=Draft202012Validator(json.loads(CURRENT_LIST_RAW),format_checker=FormatChecker())

class Runs:
 def __init__(self):self.active=None
 def check(self,c):
  x=c['context'];tool=c['tool'];r=self.active
  if c['version']==4:CURRENT_LIST_VALIDATOR.validate(c)
  if tool=='start_run':
   s=c['payload'];m=s['mode'];n=s['maxContacts']
   if c['version']==3:
    SEARCH_VALIDATOR.validate(c)
    if (m=='preview' and n!=0) or (m=='run' and not s['expectedPhraseHash']):raise ValueError('INVALID_SCOPE')
   if (m=='search_only' and n!=0) or (m=='greet_once' and n!=1) or (m=='batch' and n<1):raise ValueError('INVALID_SCOPE')
   if r:raise ValueError('RUN_BUSY')
   return
  if not r or r['runId']!=x['runId'] or r['leaseId']!=x['leaseId']:raise ValueError('RUN_STOPPED')
  if time.monotonic()>=r['expires']:raise ValueError('LEASE_EXPIRED')
  if r.get('version',2)!=c['version']:raise ValueError('VERSION_MISMATCH')
  if tool=='renew_run':return
  if c['version']==4:
   p=c['payload'];bound=r.get('expectedPhraseHash')
   if r['mode']=='preview' and tool not in {'inspect_current_list','advance_list','restore_list','open_job'}:raise ValueError('SCOPE_DENIED')
   if tool=='open_chat':
    if r['contacts']>=r['maxContacts']:raise ValueError('CONTACT_LIMIT')
    if not bound and r['contacts']>=1:raise ValueError('PHRASE_NOT_BOUND')
   if tool in {'choose_first_phrase','submit_filled_phrase'} and not bound:raise ValueError('PHRASE_NOT_BOUND')
   if tool in {'choose_first_phrase','submit_filled_phrase'} and r['maxContacts']==0:raise ValueError('CONTACT_LIMIT')
   if bound and 'expectedHash' in p and p['expectedHash']!=bound:raise ValueError('SCOPE_DENIED')
   if tool=='bind_phrase':
    proof=r.get('phraseObservation')
    if not proof or proof!={'requestId':p['observationRequestId'],'conversationKey':p['conversationKey'],'hash':p['expectedHash']}:raise ValueError('PHRASE_OBSERVATION_MISMATCH')
   return
  if r['mode'] in {'search_only','preview'} and tool not in ({'search_jobs','list_jobs','open_job','restore_search'}|({'read_saved_phrase'} if c['version']==3 else set())):raise ValueError('SCOPE_DENIED')
  if c['version']==3:
   p=c['payload']
   if 'city' in p and p['city']!=r['city']:raise ValueError('SCOPE_DENIED')
   if ('keyword' in p and p['keyword'] not in r['allowedKeywords']) or ('experience' in p and p['experience'] not in r['experienceBands']) or ('expectedHash' in p and p['expectedHash']!=r['expectedPhraseHash']):raise ValueError('SCOPE_DENIED')
  if tool=='open_chat' and r['contacts']>=r['maxContacts']:raise ValueError('CONTACT_LIMIT')
 def dispatched(self,c):
  if c['tool']=='open_chat':self.active['contacts']+=1
 def observed(self,c,result=None):
  if c['tool']=='start_run':self.active={**c['payload'],**{k:c['context'][k] for k in ('runId','leaseId')},'version':c['version'],'expires':time.monotonic()+30,'contacts':0}
  elif c['tool']=='renew_run':self.active['expires']=time.monotonic()+30
  elif c['version']==4 and self.active and self.active['runId']==c['context']['runId'] and self.active['leaseId']==c['context']['leaseId']:
   if c['tool']=='read_first_phrase':
    self.active.pop('phraseObservation',None)
    value=(result or {}).get('value',{})
    if (result or {}).get('phase')=='observed' and re.fullmatch('[a-f0-9]{64}',str(value.get('hash',''))):
     self.active['phraseObservation']={'requestId':c['context']['requestId'],'conversationKey':c['payload']['conversationKey'],'hash':value['hash']}
   elif c['tool']=='bind_phrase':self.active['expectedPhraseHash']=c['payload']['expectedHash']
 def stop(self,run):
  if self.active and self.active['runId']==run:self.active=None
