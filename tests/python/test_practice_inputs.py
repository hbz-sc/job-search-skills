import json
import tempfile
import unittest
from pathlib import Path
from jobpilot.practice_inputs import read_practice_jobs
from jobpilot.week1 import filter_jobs

JOB = dict(jobId='one', title='Python开发', company='公司', city='深圳', salary='',
           url='https://example.test/jobs/1', description='要求Python开发经验',
           capturedAt='2026-11-04T10:00:00+08:00', description_kind='original_full', listing_status='unverified')


class InputTests(unittest.TestCase):
    def read(self, payload):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td, 'jobs.json')
            path.write_text(json.dumps(payload, ensure_ascii=False), encoding='utf-8-sig')
            return read_practice_jobs(path)

    def test_provenance_survives_filtering(self):
        rows = self.read({'jobs': [JOB, JOB]})
        filtered = filter_jobs(rows, '深圳')
        self.assertEqual(filtered['counts']['duplicates'], 1)
        self.assertEqual(filtered['jobs'][0]['issues'], [])
        for field in ('capturedAt', 'description_kind', 'listing_status', 'description'):
            self.assertEqual(filtered['jobs'][0][field], JOB[field])
        self.assertEqual(self.read({'jobs': [{**JOB, 'listing_status': 'closed'}]})[0]['listing_status'], 'closed')

    def test_missing_fields_are_item_issues(self):
        for field in ('title', 'company', 'city', 'url', 'capturedAt', 'description', 'description_kind'):
            with self.subTest(field=field):
                row = {k: v for k, v in JOB.items() if k != field}
                self.assertIn(field, str(self.read({'jobs': [row]})[0]['issues']))
        self.assertTrue(self.read({'jobs': [{**JOB, 'description_kind': 'summary'}]})[0]['issues'])
        row = {k: v for k, v in JOB.items() if k != 'listing_status'}
        self.assertEqual(self.read({'jobs': [row]})[0]['listing_status'], 'unverified')

    def test_structure_errors_stop_whole_input(self):
        for payload in [[], {}, {'jobs': {}}, {'jobs': [None]}]:
            with self.assertRaises(ValueError):
                self.read(payload)
        for field, value in [('description', 123), ('capturedAt', '2026-11-04T10:00:00'),
                             ('capturedAt', 'wrong'), ('description_kind', 'unknown'), ('listing_status', 'fake')]:
            with self.assertRaises(ValueError) as caught:
                self.read({'jobs': [{**JOB, field: value}]})
            self.assertIn('1', str(caught.exception))
            self.assertIn(field, str(caught.exception))
        with tempfile.TemporaryDirectory() as td:
            path = Path(td, 'bad.json')
            path.write_text('{SECRET_SENTINEL', encoding='utf8')
            with self.assertRaises(ValueError) as caught:
                read_practice_jobs(path)
            self.assertNotIn('SECRET_SENTINEL', str(caught.exception))

    def test_bad_source_url_cannot_be_analyzed(self):
        for url in ['file:///private.txt', 'https://', 'https://user:secret@example.test/job']:
            self.assertTrue(self.read({'jobs': [{**JOB, 'url': url}]})[0]['issues'])
