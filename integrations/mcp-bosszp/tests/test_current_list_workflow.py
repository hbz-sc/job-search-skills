import unittest
import asyncio
import tempfile
from pathlib import Path
from datetime import datetime, timedelta, timezone
from boss_bridge import workflow
from boss_bridge.tools import Bridge
from boss_bridge.journal import Journal


def command(tool, payload, rid='q'):
    return {'version': 4, 'tool': tool, 'payload': payload, 'context': {
        'runId': 'r', 'leaseId': 'l', 'requestId': rid,
        'binding': {'sessionId': 's', 'tabId': 1, 'frameId': 0, 'documentId': 'd'},
        'deadline': (datetime.now(timezone.utc)+timedelta(seconds=10)).isoformat()}}


class CurrentListTests(unittest.TestCase):
    def start(self, mode='run', maximum=150):
        r = workflow.Runs()
        c = command('start_run', {'mode': mode, 'batchId': 'batch', 'maxContacts': maximum})
        r.check(c); r.observed(c)
        return r

    def bind(self, r):
        read = command('read_first_phrase', {'conversationKey': 'c'}, 'read')
        r.observed(read, {'phase': 'observed', 'value': {'hash': 'a'*64}})
        bind = command('bind_phrase', {'conversationKey': 'c', 'expectedHash': 'a'*64, 'observationRequestId': 'read'})
        r.check(bind); r.observed(bind)

    def test_contract_strict_scope_and_tools(self):
        self.assertTrue(hasattr(workflow, 'CURRENT_LIST_VALIDATOR'))
        validator = workflow.CURRENT_LIST_VALIDATOR
        for n in (0, 1, 150):
            validator.validate(command('start_run', {'mode': 'run', 'batchId': 'b', 'maxContacts': n}))
        for patch in ({'maxContacts':151}, {'maxContacts':-1}, {'url':'https://evil.test'}, {'expectedPhraseHash':'a'*64}, {'mode':'preview','maxContacts':1}):
            with self.assertRaises(Exception):
                validator.validate(command('start_run', {'mode':'run','batchId':'b','maxContacts':1,**patch}))
        for tool in ('inspect_current_list','advance_list','restore_list','renew_run'):
            validator.validate(command(tool, {}))
            with self.assertRaises(Exception): validator.validate(command(tool, {'url':'https://evil.test'}))

    def test_bootstrap_allows_only_one_contact_and_no_send(self):
        r = self.start()
        for tool in ('choose_first_phrase','submit_filled_phrase'):
            with self.assertRaisesRegex(ValueError, 'PHRASE_NOT_BOUND'):
                r.check(command(tool, {'conversationKey':'c','expectedHash':'a'*64}))
        contact = command('open_chat', {'jobKey':'j'})
        r.check(contact); r.dispatched(contact)
        with self.assertRaisesRegex(ValueError, 'PHRASE_NOT_BOUND'): r.check(contact)

    def test_proof_and_budget_survive_bind_and_renew(self):
        r = self.start(); contact = command('open_chat', {'jobKey':'j'})
        r.check(contact); r.dispatched(contact)
        self.bind(r)
        r.observed(command('renew_run', {}))
        self.assertEqual(r.active['contacts'], 1)
        for _ in range(149): r.check(contact); r.dispatched(contact)
        with self.assertRaisesRegex(ValueError, 'CONTACT_LIMIT'): r.check(contact)

    def test_wrong_proof_rejected(self):
        r = self.start()
        read = command('read_first_phrase', {'conversationKey':'c'}, 'read')
        r.observed(read, {'phase':'observed','value':{'hash':'a'*64}})
        for patch in ({'observationRequestId':'other'}, {'conversationKey':'other'}, {'expectedHash':'b'*64}):
            with self.assertRaisesRegex(ValueError, 'PHRASE_OBSERVATION_MISMATCH'):
                r.check(command('bind_phrase', {'conversationKey':'c','expectedHash':'a'*64,'observationRequestId':'read',**patch}))

    def test_preview_and_zero_budget_readonly(self):
        for mode in ('preview','run'):
            r = self.start(mode, 0)
            r.check(command('inspect_current_list', {}))
            with self.assertRaises(ValueError): r.check(command('open_chat', {'jobKey':'j'}))

    def test_bound_hash_cannot_change(self):
        r = self.start(); self.bind(r)
        with self.assertRaisesRegex(ValueError, 'SCOPE_DENIED'):
            r.check(command('choose_first_phrase', {'conversationKey':'c','expectedHash':'b'*64}))

    def test_zero_remaining_cannot_send_even_after_read_and_bind(self):
        r = self.start('run', 0); self.bind(r)
        for tool in ('choose_first_phrase', 'submit_filled_phrase'):
            with self.assertRaisesRegex(ValueError, 'CONTACT_LIMIT'):
                r.check(command(tool, {'conversationKey':'c','expectedHash':'a'*64}))

    def test_failed_or_other_run_observation_cannot_authorize_binding(self):
        for failure in ('failed', 'other_run', 'other_lease'):
            r = self.start()
            read = command('read_first_phrase', {'conversationKey':'c'}, 'read')
            result = {'phase':'observed','value':{'hash':'a'*64}}
            if failure == 'failed': result['phase']='failed'
            if failure == 'other_run': read['context']['runId']='other'
            if failure == 'other_lease': read['context']['leaseId']='other'
            r.observed(read, result)
            with self.assertRaisesRegex(ValueError, 'PHRASE_OBSERVATION_MISMATCH'):
                r.check(command('bind_phrase', {'conversationKey':'c','expectedHash':'a'*64,'observationRequestId':'read'}))


class CurrentListBridgeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.journal = Journal(Path(self.tmp.name)/'journal.sqlite')
        self.sent = []
        self.bridge = Bridge(self.journal, self.sent.append, Path(self.tmp.name))
        self.binding = command('renew_run', {})['context']['binding']
        self.bridge.receive({'kind':'bind','binding':self.binding,'workflowVersion':1,'currentListVersion':1})

    async def asyncTearDown(self):
        self.journal.close(); self.tmp.cleanup()

    async def observed(self, c, value):
        pending = asyncio.create_task(self.bridge.dispatch(c))
        await asyncio.sleep(.01)
        self.assertEqual(self.sent[-1]['command'], c)
        self.bridge.receive({'kind':'result','result':{'requestId':c['context']['requestId'],'phase':'observed','value':value}})
        return await pending

    async def test_capability_required_before_native_dispatch(self):
        self.bridge.receive({'kind':'bind','binding':self.binding,'workflowVersion':1})
        result = await self.bridge.dispatch(command('start_run', {'mode':'run','batchId':'b','maxContacts':1}, 'start'))
        self.assertEqual(result['error']['code'], 'EXTENSION_UPDATE_REQUIRED')
        self.assertEqual(self.sent, [])

    async def test_observed_proof_binds_same_budget_and_replay_is_not_dispatched(self):
        await self.observed(command('start_run', {'mode':'run','batchId':'b','maxContacts':2}, 'start'), {})
        await self.observed(command('open_chat', {'jobKey':'j'}, 'contact'), {'conversationKey':'c'})
        read = command('read_first_phrase', {'conversationKey':'c'}, 'read')
        await self.observed(read, {'hash':'a'*64})
        bind = command('bind_phrase', {'conversationKey':'c','expectedHash':'a'*64,'observationRequestId':'read'}, 'bind')
        await self.observed(bind, {'hash':'a'*64})
        self.assertEqual(self.bridge.runs.active['contacts'], 1)
        count = len(self.sent)
        self.assertEqual((await self.bridge.dispatch(bind))['phase'], 'observed')
        self.assertEqual(len(self.sent), count)
        bad = command('choose_first_phrase', {'conversationKey':'c','expectedHash':'b'*64}, 'bad')
        self.assertEqual((await self.bridge.dispatch(bad))['error']['code'], 'SCOPE_DENIED')
        self.assertEqual(len(self.sent), count)

