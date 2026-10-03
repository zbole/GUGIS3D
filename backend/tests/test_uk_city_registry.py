import copy
import hashlib
import json
import os
from collections import Counter
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app
from app.routers import city, coverage
from app.services import city_workspaces, uk_city_registry
from app.services.city_archive import archive_bytes
from app.services.city_sample_import import build_osm_sample


class UKCityRegistryTests(unittest.TestCase):
    def test_exact_membership_country_counts_and_unique_country_qualified_ids(self):
        registry = uk_city_registry.read_registry()
        records = registry['cities']
        self.assertEqual(len(records), 76)
        self.assertEqual(len({r['id'] for r in records}), 76)
        self.assertEqual(Counter(r['country'] for r in records),
                         {'England': 55, 'Northern Ireland': 6, 'Scotland': 8, 'Wales': 7})
        for record in records:
            self.assertTrue(record['id'].startswith(f"uk-{record['country_code'].lower()}-"))
            self.assertEqual(record['source_name'], record['display_name'])
        bangors = [r['id'] for r in records if r['source_name'] == 'Bangor']
        self.assertEqual(set(bangors), {'uk-nir-bangor', 'uk-wls-bangor'})
        names = {record['source_name'] for record in records}
        self.assertFalse(names & {'Douglas', 'Hamilton', 'City of Gibraltar', 'Stanley', 'Jamestown'})

    def test_source_names_are_preserved_and_aliases_separate(self):
        london = uk_city_registry.get_city('uk-eng-london')
        self.assertEqual(london['source_name'], 'London')
        self.assertIn('City of London', london['aliases'])
        self.assertEqual(uk_city_registry.get_city('uk-eng-westminster')['source_name'], 'Westminster')
        derry = uk_city_registry.get_city('uk-nir-londonderry')
        self.assertEqual(derry['source_name'], 'Londonderry')
        self.assertIn('Derry', derry['aliases'])
        for city_id, name in [('uk-eng-brighton-and-hove', 'Brighton & Hove'),
                              ('uk-eng-kingston-upon-hull', 'Kingston-upon-Hull'),
                              ('uk-eng-newcastle-upon-tyne', 'Newcastle-upon-Tyne'),
                              ('uk-eng-stoke-on-trent', 'Stoke on Trent')]:
            self.assertEqual(uk_city_registry.get_city(city_id)['source_name'], name)
        self.assertEqual(london['source_annotation']['marker'], '*')
        self.assertIn('Lord Mayoralty', london['source_annotation']['meaning'])
        self.assertIsNone(uk_city_registry.get_city('uk-eng-bath')['source_annotation'])

    def test_source_dates_licence_and_conferral_caveat_are_explicit(self):
        source = uk_city_registry.read_registry()['source']
        self.assertEqual(source['url'], 'https://www.gov.uk/government/publications/list-of-cities/list-of-cities-html')
        self.assertEqual(source['published_at'], '2022-08-29')
        self.assertEqual(source['verified_at'], '2026-10-03')
        self.assertEqual(source['license'], 'Open Government Licence v3.0')
        self.assertIn('Crown copyright 2022', source['attribution'])
        self.assertIn('formal conferral', source['conferral_caveat'])
        self.assertIn('excludes Crown Dependencies and Overseas Territories', source['scope'])

    def test_helper_rejects_noncanonical_names_unknown_ids_and_traversal(self):
        for city_id in ('bristol', 'Bangor', 'Derry', 'uk-nir-derry', '..', '../uk-eng-bristol', 'uk-eng-oxford/../london', None):
            with self.subTest(city_id=city_id), self.assertRaises(ValueError):
                uk_city_registry.get_city(city_id)

    def test_helper_returns_independent_data(self):
        first = uk_city_registry.read_registry()
        first['cities'][0]['source_name'] = 'Changed'
        first['source']['url'] = 'changed'
        first['cities'][0]['aliases'].append('Changed')
        self.assertEqual(uk_city_registry.get_city('uk-eng-bath')['source_name'], 'Bath')
        self.assertEqual(uk_city_registry.get_city('uk-eng-bath')['aliases'], [])
        self.assertNotEqual(uk_city_registry.read_registry()['source']['url'], 'changed')

    def test_invalid_registry_membership_is_rejected(self):
        original = uk_city_registry.read_registry()
        variants = []
        missing = copy.deepcopy(original); missing['cities'].pop(); variants.append(missing)
        duplicate = copy.deepcopy(original); duplicate['cities'][-1] = duplicate['cities'][0]; variants.append(duplicate)
        country = copy.deepcopy(original); country['country_counts']['England'] = 54; variants.append(country)
        geometry = copy.deepcopy(original); geometry['cities'][0]['bbox'] = [0, 0, 1, 1]; variants.append(geometry)
        with TemporaryDirectory() as directory:
            path = Path(directory) / 'registry.json'
            with patch.object(uk_city_registry, 'REGISTRY_PATH', path):
                for payload in variants:
                    path.write_text(json.dumps(payload))
                    with self.assertRaises(ValueError):
                        uk_city_registry.read_registry()


class UKReadinessAPITests(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.seed = self.root / 'data' / 'bristol.gugis.json'
        self.seed.parent.mkdir()
        (self.seed.parent / 'cities').mkdir()
        shape = {'type': 'way', 'id': 1, 'tags': {'building': 'yes', 'height': '12'},
                 'geometry': [{'lon': x, 'lat': y} for x, y in
                              [(-2.6, 51.45), (-2.599, 51.45), (-2.599, 51.451), (-2.6, 51.451), (-2.6, 51.45)]]}
        for workspace_id in ('bristol', 'london', 'birmingham'):
            document, _ = build_osm_sample({'elements': [shape]},
                                          {'city_id': 'london', 'bbox': [-3, 51, -2, 52],
                                           'coverage_label': 'Synthetic test sample',
                                           'source_url': 'https://example.test/no-download'}, 'london')
            path = self.seed if workspace_id == 'bristol' else self.seed.parent / 'cities' / f'{workspace_id}.gugis.json'
            path.write_bytes(archive_bytes(document))
        self.boundaries = self.root / '.local' / 'coverage' / 'boundaries'
        for module, key, value in [(city, 'CITY_DIR', self.root / '.local' / 'city'), (city, 'SEED', self.seed),
                                   (coverage, 'BOUNDARY_RECEIPTS_ROOT', self.boundaries)]:
            helper = patch.object(module, key, value)
            helper.start()
            self.addCleanup(helper.stop)
        self.client = TestClient(app)

    def response(self):
        response = self.client.get('/coverage/uk-cities')
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    @staticmethod
    def records(payload):
        return {record['id']: record for record in payload['cities']}

    def snapshots(self):
        return {str(path.relative_to(self.root)): hashlib.sha256(path.read_bytes()).hexdigest()
                for path in self.root.rglob('*') if path.is_file()}

    def test_readiness_is_separate_from_exact_three_city_readonly_catalogue(self):
        before = self.snapshots()
        payload = self.response()
        self.assertEqual(payload['schema'], 'gugis-uk-readiness-v1')
        self.assertEqual(payload['summary'], {'registered_cities': 76, 'sample_workspaces': 3,
                                             'available_sample_workspaces': 3, 'coverage_assessment': 'not-assessed'})
        self.assertEqual(len(payload['samples']), 3)
        catalogue = self.client.get('/cities').json()['cities']
        self.assertEqual({entry['id'] for entry in catalogue}, {'bristol', 'london', 'birmingham'})
        self.assertEqual(len(catalogue), 3)
        self.assertEqual(self.snapshots(), before)
        self.assertFalse((self.root / '.local').exists())
        self.assertEqual(self.client.get('/cities/uk-eng-bath/city/current').status_code, 404)

    def test_sample_associations_never_establish_boundary_membership(self):
        payload = self.response(); rows = self.records(payload)
        self.assertEqual(rows['uk-eng-london']['sample']['state'], 'none')
        self.assertEqual(rows['uk-eng-london']['sample']['workspace_ids'], [])
        self.assertEqual(rows['uk-eng-westminster']['sample']['workspace_ids'], ['london'])
        self.assertEqual(rows['uk-eng-bristol']['sample']['workspace_ids'], ['bristol'])
        self.assertEqual(rows['uk-eng-birmingham']['sample']['workspace_ids'], ['birmingham'])
        samples = {sample['workspace_id']: sample for sample in payload['samples']}
        self.assertIn('Whitehall', samples['london']['display_name'])
        self.assertIn('does not establish City of London coverage', samples['london']['association_note'])
        self.assertTrue(all(sample['boundary_membership_verified'] is False for sample in payload['samples']))
        self.assertEqual(sum(record['sample']['state'] == 'none' for record in rows.values()), 73)
        for record in rows.values():
            self.assertIs(record['sample']['boundary_membership_verified'], False)
            self.assertEqual(record['boundary'], {'state': 'not-recorded', 'receipt': None})
            self.assertEqual(record['import'], {'state': 'not-imported', 'scope': 'full-boundary'})
            self.assertEqual(record['coverage'], {'state': 'not-assessed'})
        self.assertNotIn('percent', json.dumps(payload).lower())
        self.assertNotIn('"complete"', json.dumps(payload).lower())
        self.assertNotIn('bbox', json.dumps(payload).lower())

    def test_uses_cached_workspace_summary_only_without_initializing_any_city(self):
        with patch.object(city_workspaces, 'workspace_entry', wraps=city_workspaces.workspace_entry) as entries, \
             patch.object(city, 'read_current', side_effect=AssertionError('Must not initialize')):
            self.response(); self.response()
        self.assertEqual([call.args[0] for call in entries.call_args_list],
                         ['bristol', 'london', 'birmingham'] * 2)
        self.assertFalse((self.root / '.local').exists())

    def test_missing_and_corrupt_sample_files_are_isolated(self):
        self.seed.unlink()
        (self.seed.parent / 'cities' / 'london.gugis.json').write_bytes(b'broken archive')
        before = self.snapshots()
        payload = self.response(); rows = self.records(payload)
        self.assertEqual(payload['summary']['available_sample_workspaces'], 1)
        self.assertEqual(payload['summary']['sample_workspaces'], 3)
        self.assertEqual(rows['uk-eng-bristol']['sample']['state'], 'missing')
        self.assertEqual(rows['uk-eng-westminster']['sample']['state'], 'invalid')
        self.assertEqual(rows['uk-eng-birmingham']['sample']['state'], 'available')
        self.assertEqual(len(rows), 76)
        self.assertEqual(self.snapshots(), before)

    def test_corrupt_current_sample_is_not_replaced_by_valid_seed(self):
        current = self.root / '.local' / 'cities' / 'london' / 'current.gugis.json'
        current.parent.mkdir(parents=True)
        current.write_bytes(b'corrupt saved project, retain without fallback')
        before = self.snapshots()
        payload = self.response()
        sample = next(sample for sample in payload['samples'] if sample['workspace_id'] == 'london')
        self.assertEqual(sample['status'], 'invalid')
        self.assertIsNone(sample['building_count'])
        self.assertIsNone(sample['road_count'])
        self.assertIsNone(sample['data_revision'])
        self.assertEqual(payload['summary']['available_sample_workspaces'], 2)
        self.assertEqual(self.snapshots(), before)

    def test_unexpected_sample_read_failure_is_isolated_and_not_exposed(self):
        real_entry = city_workspaces.workspace_entry
        def entry(workspace_id):
            if workspace_id == 'london':
                raise RuntimeError('private path and internal error details')
            return real_entry(workspace_id)
        with patch.object(city_workspaces, 'workspace_entry', side_effect=entry):
            payload = self.response()
        self.assertEqual(self.records(payload)['uk-eng-westminster']['sample']['state'], 'unavailable')
        self.assertEqual(payload['summary']['available_sample_workspaces'], 2)
        self.assertNotIn('private path', json.dumps(payload))

    @staticmethod
    def synthetic_receipt(city_id='uk-eng-bristol'):
        from app.services.boundary_receipts import build_receipt, receipt_bytes
        # Deliberately not a real city polygon; even a valid receipt proves no coverage.
        source = json.dumps({'type': 'Feature', 'id': 'synthetic', 'properties': {},
                             'geometry': {'type': 'Polygon', 'coordinates':
                                          [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]}}).encode()
        metadata = {'city_id': city_id, 'boundary_definition': {'kind': 'other', 'name': 'Synthetic test only'},
                    'publisher': 'Synthetic test publisher', 'dataset_title': 'Synthetic test polygon',
                    'dataset_version': 'test-v1', 'effective_date': '2026-10-03',
                    'feature_identifier': {'type': 'feature-id', 'value': 'synthetic'},
                    'source_url': 'https://example.test/never-fetched', 'retrieval_date': '2026-10-03',
                    'license_url': 'https://example.test/synthetic-license', 'attribution': 'Synthetic test only',
                    'declared_crs': 'EPSG:4326', 'coordinate_order': 'lon-lat',
                    'expected_source_sha256': hashlib.sha256(source).hexdigest()}
        return receipt_bytes(build_receipt(source, json.dumps(metadata), city_id))

    def test_valid_receipt_only_records_integrity_and_has_a_safe_summary(self):
        self.boundaries.mkdir(parents=True)
        content = self.synthetic_receipt()
        (self.boundaries / 'uk-eng-bristol.json').write_bytes(content)
        before = self.snapshots()
        payload = self.response(); row = self.records(payload)['uk-eng-bristol']
        self.assertEqual(row['boundary']['state'], 'receipt-recorded')
        safe = row['boundary']['receipt']
        self.assertEqual(set(safe), {'schema', 'city_id', 'checksum_sha256', 'source_sha256',
                                   'geometry_sha256', 'validation_level', 'topology', 'city_boundary_authority'})
        self.assertEqual(safe['validation_level'], 'integrity_and_structure')
        self.assertEqual(safe['topology'], 'not_checked')
        self.assertEqual(safe['city_boundary_authority'], 'not_verified')
        self.assertEqual(row['coverage']['state'], 'not-assessed')
        self.assertEqual(row['import'], {'state': 'not-imported', 'scope': 'full-boundary'})
        self.assertIs(row['sample']['boundary_membership_verified'], False)
        self.assertEqual(payload['summary']['coverage_assessment'], 'not-assessed')
        self.assertNotIn('never-fetched', json.dumps(payload))
        self.assertEqual(self.snapshots(), before)
        self.assertFalse((self.root / '.local' / 'render-cache').exists())
        self.assertFalse((self.root / '.local' / 'city').exists())

    def test_mismatched_and_tampered_receipts_are_rejected_per_city(self):
        self.boundaries.mkdir(parents=True)
        content = self.synthetic_receipt()
        (self.boundaries / 'uk-eng-bath.json').write_bytes(content)
        tampered = json.loads(content); tampered['source']['sha256'] = '0' * 64
        (self.boundaries / 'uk-eng-bristol.json').write_text(json.dumps(tampered))
        payload = self.response(); rows = self.records(payload)
        for city_id in ('uk-eng-bath', 'uk-eng-bristol'):
            self.assertEqual(rows[city_id]['boundary']['state'], 'validation-failed')
            self.assertEqual(rows[city_id]['coverage']['state'], 'not-assessed')

    def test_symlink_receipt_parent_is_rejected(self):
        elsewhere = self.root / 'elsewhere'; elsewhere.mkdir()
        (elsewhere / 'uk-eng-bristol.json').write_bytes(self.synthetic_receipt())
        self.boundaries.parent.mkdir(parents=True)
        self.boundaries.symlink_to(elsewhere, target_is_directory=True)
        payload = self.response()
        self.assertEqual(self.records(payload)['uk-eng-bristol']['boundary']['state'], 'validation-failed')
        self.assertEqual(len(payload['cities']), 76)

    def test_unsupported_receipt_platform_is_distinct_and_missing_files_stay_unrecorded(self):
        from app.services import boundary_receipts
        self.boundaries.mkdir(parents=True)
        (self.boundaries / 'uk-eng-bristol.json').write_bytes(self.synthetic_receipt())
        before = self.snapshots()
        with patch.object(boundary_receipts.os, 'supports_dir_fd', set()):
            payload = self.response()
            catalogue = self.client.get('/cities').json()['cities']
        rows = self.records(payload)
        self.assertEqual(rows['uk-eng-bristol']['boundary'],
                         {'state': 'validation-failed', 'receipt': None, 'reason_code': 'unsupported-platform'})
        self.assertTrue(all(row['boundary'] == {'state': 'not-recorded', 'receipt': None}
                            for city_id, row in rows.items() if city_id != 'uk-eng-bristol'))
        self.assertEqual({entry['id'] for entry in catalogue}, {'bristol', 'london', 'birmingham'})
        self.assertTrue(all(entry['status'] == 'ready' for entry in catalogue))
        self.assertEqual(payload['summary']['coverage_assessment'], 'not-assessed')
        self.assertEqual(self.snapshots(), before)

    @unittest.skipUnless(hasattr(os, 'mkfifo'), 'Requires POSIX FIFO support')
    def test_nonregular_receipt_is_rejected_without_blocking(self):
        self.boundaries.mkdir(parents=True)
        os.mkfifo(self.boundaries / 'uk-eng-bristol.json')
        (self.boundaries / 'uk-eng-bath.json').mkdir()
        payload = self.response(); rows = self.records(payload)
        self.assertEqual(rows['uk-eng-bristol']['boundary']['state'], 'validation-failed')
        self.assertEqual(rows['uk-eng-bath']['boundary']['state'], 'validation-failed')

    def test_malformed_and_oversized_receipts_are_isolated(self):
        self.boundaries.mkdir(parents=True)
        (self.boundaries / 'uk-eng-bristol.json').write_bytes(b'not json')
        (self.boundaries / 'uk-eng-bath.json').write_bytes(b' ' * (128 * 1024 + 1))
        before = self.snapshots()
        payload = self.response(); rows = self.records(payload)
        for city_id in ('uk-eng-bristol', 'uk-eng-bath'):
            self.assertEqual(rows[city_id]['boundary'], {'state': 'validation-failed', 'receipt': None})
            self.assertEqual(rows[city_id]['coverage']['state'], 'not-assessed')
        self.assertEqual(rows['uk-eng-birmingham']['boundary']['state'], 'not-recorded')
        self.assertEqual(self.snapshots(), before)

    def test_symlink_receipts_and_unknown_receipt_filenames_are_not_followed(self):
        self.boundaries.mkdir(parents=True)
        outside = self.root / 'outside.json'; outside.write_text('{"private":"never return"}')
        (self.boundaries / 'uk-eng-bristol.json').symlink_to(outside)
        (self.boundaries / 'unknown-city.json').write_bytes(b'not a registered city')
        payload = self.response()
        self.assertEqual(self.records(payload)['uk-eng-bristol']['boundary']['state'], 'validation-failed')
        self.assertNotIn('never return', json.dumps(payload))
        self.assertEqual(len(payload['cities']), 76)


if __name__ == '__main__':
    unittest.main()
