import copy
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from app.services import city_archive, city_workspaces, seed_summaries
from app.city_models import CityDocument


class SeedSummaryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.city_path = self.root / 'city.json'
        self.content = city_archive.archive_bytes(CityDocument(
            format='gugis-city', version='1.0', coordinate_system='ENU_METERS_WGS84',
            name='Checked empty seed', assets={}, instances=[], metadata={'source': 'checked source'}))
        self.city_path.write_bytes(self.content)
        with patch.object(seed_summaries, 'trusted_seed_summary', return_value=None):
            summary = city_workspaces._source_summary(self.city_path)
        self.report = {'schema': 'gugis-validated-seed-summaries-v1',
                       'runtime': seed_summaries.validation_runtime(),
                       'dependencies': seed_summaries.validation_dependencies(),
                       'records': [{'bytes': len(self.content), 'sha256': summary['revision'], 'summary': summary}]}
        self.receipt = self.root / 'receipt.json'
        self.receipt_patch = patch.object(seed_summaries, 'RECEIPT_PATH', self.receipt)
        self.receipt_patch.start()
        self.addCleanup(self.receipt_patch.stop)
        self.addCleanup(seed_summaries._trusted_records.cache_clear)
        self.addCleanup(city_workspaces._validated_summary.cache_clear)

    def install(self, report=None):
        content = json.dumps(report or self.report).encode()
        self.receipt.write_bytes(content)
        seed_summaries._trusted_records.cache_clear()
        city_workspaces._validated_summary.cache_clear()
        return patch.object(seed_summaries, 'RECEIPT_SHA256', hashlib.sha256(content).hexdigest())

    def test_exact_validated_bytes_skip_expansion_but_caller_cannot_mutate_cached_provenance(self):
        with self.install(), patch.object(city_archive, 'load_city', side_effect=AssertionError('Known bytes need no expansion')):
            result = city_workspaces._source_summary(self.city_path)
            self.assertEqual(result, self.report['records'][0]['summary'])
            result['metadata']['source'] = 'caller changed'
            city_workspaces._validated_summary.cache_clear()
            self.assertEqual(city_workspaces._source_summary(self.city_path)['metadata']['source'], 'checked source')
        self.assertEqual(self.city_path.read_bytes(), self.content)

    def test_changed_valid_or_corrupt_city_uses_full_validator_and_never_borrows_counts(self):
        with self.install(), patch.object(city_archive, 'load_city', wraps=city_archive.load_city) as validator:
            city_workspaces._source_summary(self.city_path)
            self.assertEqual(validator.call_count, 0)
            payload = json.loads(self.content)
            payload['name'] = 'Modified project'
            self.city_path.write_bytes(json.dumps(payload).encode())
            result = city_workspaces._source_summary(self.city_path)
            self.assertFalse(result['corrupt'])
            self.assertNotEqual(result['revision'], self.report['records'][0]['sha256'])
            self.assertEqual(validator.call_count, 1)
            payload['instances'] = [{'id': 'broken', 'asset': 'missing', 'name': 'Broken', 'longitude': 0, 'latitude': 50}]
            corrupt = json.dumps(payload).encode()
            self.city_path.write_bytes(corrupt)
            self.assertTrue(city_workspaces._source_summary(self.city_path)['corrupt'])
            self.assertEqual(validator.call_count, 2)
            self.assertEqual(self.city_path.read_bytes(), corrupt)

    def test_changed_receipt_dependency_runtime_or_schema_disables_shortcut(self):
        for field in ['schema', 'dependencies', 'runtime']:
            with self.subTest(field=field):
                changed = copy.deepcopy(self.report)
                changed[field] = 'changed' if field == 'schema' else {}
                with self.install(changed), patch.object(city_archive, 'load_city', wraps=city_archive.load_city) as validator:
                    self.assertFalse(city_workspaces._source_summary(self.city_path)['corrupt'])
                    self.assertEqual(validator.call_count, 1)
        with self.install():
            self.receipt.write_bytes(b'[]')
            self.assertIsNone(seed_summaries._trusted_records())
        with self.install(), patch.object(seed_summaries, 'validation_dependencies', return_value={}):
            self.assertIsNone(seed_summaries._trusted_records())
        with self.install():
            self.receipt.write_bytes(b'x' * (seed_summaries.MAX_RECEIPT_BYTES + 1))
            self.assertIsNone(seed_summaries._trusted_records())

    def test_public_receipt_binds_published_seeds_current_validation_sources_and_runtime(self):
        # Read the real release file outside the temporary receipt override.
        path = seed_summaries.ROOT / 'backend/data/cities/validated-seed-summaries.json'
        content = path.read_bytes()
        self.assertEqual(hashlib.sha256(content).hexdigest(), seed_summaries.RECEIPT_SHA256)
        report = json.loads(content)
        self.assertEqual(report['runtime'], seed_summaries.validation_runtime())
        self.assertEqual(report['dependencies'], seed_summaries.validation_dependencies())
        self.assertEqual({r['city_id'] for r in report['records']}, set(city_workspaces.CITY_DEFAULTS))
        self.assertEqual(sum(r['summary']['count'] for r in report['records']), 65251)
        for record in report['records']:
            source = seed_summaries.ROOT / record['path']
            self.assertEqual(source.stat().st_size, record['bytes'])
            self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), record['sha256'])
            self.assertEqual(record['summary']['revision'], record['sha256'])
            self.assertFalse(record['summary']['corrupt'])


if __name__ == '__main__':
    unittest.main()
