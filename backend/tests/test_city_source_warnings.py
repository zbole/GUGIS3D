"""Source-specific warnings bind to validated bytes, never just a city name."""
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import unittest

from fastapi.testclient import TestClient
from app.main import app
from app.routers import city
from app.services import city_workspaces

DATA = Path(__file__).resolve().parents[1] / 'data'


class CitySourceWarningsTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.city_dir = self.root / '.local' / 'city'
        for name, value in [('CITY_DIR', self.city_dir), ('SEED', DATA / 'bristol.gugis.json')]:
            helper = patch.object(city, name, value); helper.start(); self.addCleanup(helper.stop)
        city_workspaces._source_audit.cache_clear()
        city_workspaces._validated_summary.cache_clear()
        self.addCleanup(city_workspaces._source_audit.cache_clear)
        self.addCleanup(city_workspaces._validated_summary.cache_clear)

    def current_path(self, city_id):
        path = self.city_dir.parent / 'cities' / city_id / 'current.gugis.json'
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    def test_exact_validated_seed_revision_returns_audited_ids(self):
        for city_id, critical_id in [('london', 951721975), ('birmingham', 1436375109)]:
            with self.subTest(city_id=city_id):
                raw = (DATA / 'cities' / f'{city_id}.gugis.json').read_bytes()
                entry = city_workspaces.workspace_entry(city_id)
                self.assertEqual(entry['data_revision'], hashlib.sha256(raw).hexdigest())
                self.assertEqual(entry['status'], 'ready')
                self.assertEqual(len(entry['quality_warnings']), 2)
                self.assertIn(critical_id, entry['quality_warnings'][0]['osm_ids'])
                self.assertFalse(self.city_dir.parent.exists())
        warning = city_workspaces.workspace_entry('birmingham')['quality_warnings'][0]
        self.assertIn('The Octagon', warning['message'])
        self.assertIn('155', warning['message'])
        self.assertIn('9.6', warning['message'])

    def test_same_bytes_current_is_warned_but_edited_revision_is_not(self):
        raw = (DATA / 'cities' / 'london.gugis.json').read_bytes()
        path = self.current_path('london'); path.write_bytes(raw)
        self.assertEqual(len(city_workspaces.workspace_entry('london')['quality_warnings']), 2)
        payload = json.loads(raw); payload['name'] = 'User edited copy'
        edited = json.dumps(payload, ensure_ascii=False).encode(); path.write_bytes(edited)
        entry = city_workspaces.workspace_entry('london')
        self.assertEqual(entry['data_revision'], hashlib.sha256(edited).hexdigest())
        self.assertEqual(entry['quality_warnings'], [])
        self.assertEqual(path.read_bytes(), edited)

    def test_invalid_snapshot_never_inherits_a_seed_warning_or_revision(self):
        path = self.current_path('london'); path.write_bytes(b'{}')
        entry = city_workspaces.workspace_entry('london')
        self.assertEqual(entry['status'], 'invalid')
        self.assertIsNone(entry['data_revision'])
        self.assertEqual(entry['quality_warnings'], [])
        self.assertEqual(path.read_bytes(), b'{}')

    def test_warning_is_bound_to_both_revision_and_city(self):
        raw = (DATA / 'cities' / 'london.gugis.json').read_bytes()
        self.current_path('birmingham').write_bytes(raw)
        entry = city_workspaces.workspace_entry('birmingham')
        self.assertEqual(entry['data_revision'], hashlib.sha256(raw).hexdigest())
        self.assertEqual(entry['quality_warnings'], [])

    def test_warning_output_cannot_mutate_cached_audit(self):
        first = city_workspaces.workspace_entry('london')['quality_warnings']
        original_id = first[0]['osm_ids'][0]
        first[0]['osm_ids'].clear(); first[0]['message'] = 'Changed'
        second = city_workspaces.workspace_entry('london')['quality_warnings']
        self.assertIn(original_id, second[0]['osm_ids'])
        self.assertNotEqual(second[0]['message'], 'Changed')
        self.assertEqual(city_workspaces._source_audit.cache_info().misses, 1)

    def test_bad_static_audit_reports_unavailable_not_false_clean(self):
        audit = self.root / 'bad-audit.json'; audit.write_text('{"schema":"wrong"}')
        with patch.object(city_workspaces, '_SOURCE_AUDIT_PATH', audit):
            warnings = city_workspaces.quality_warnings('london', 'a' * 64)
        self.assertEqual(warnings[0]['code'], 'source-audit-unavailable')
        self.assertEqual(warnings[0]['osm_ids'], [])

    def test_source_audit_rejects_malformed_identifier_metadata(self):
        audit = self.root / 'bad-audit.json'
        payload = {'schema': 'gugis-city-source-audit-v1', 'revisions': {'a' * 64: {
            'city_id': 'london', 'warnings': [{'code': 'test', 'message': 'Test', 'osm_ids': [True]}]}}}
        audit.write_text(json.dumps(payload))
        with patch.object(city_workspaces, '_SOURCE_AUDIT_PATH', audit):
            self.assertIsNone(city_workspaces._source_audit())

    def test_catalog_endpoint_exposes_revision_bound_warning_fields(self):
        response = TestClient(app).get('/cities')
        self.assertEqual(response.status_code, 200, response.text)
        entries = {entry['id']: entry for entry in response.json()['cities']}
        self.assertEqual(len(entries['birmingham']['data_revision']), 64)
        self.assertIn(1436375109, entries['birmingham']['quality_warnings'][0]['osm_ids'])
        self.assertEqual(entries['bristol']['quality_warnings'], [])


if __name__ == '__main__':
    unittest.main()
