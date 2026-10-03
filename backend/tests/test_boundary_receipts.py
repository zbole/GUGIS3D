"""Synthetic structural fixtures only; none represents a real city boundary."""
import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from app.services import boundary_receipts as receipts

ROOT = Path(__file__).resolve().parents[2]
CITY_ID = 'uk-eng-bristol'


class SyntheticBoundaryFixtures:
    @staticmethod
    def ring():
        return [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]

    @classmethod
    def feature(cls):
        return {'type': 'Feature', 'id': 'synthetic', 'properties': {'code': 'TEST-ONLY'},
                'geometry': {'type': 'Polygon', 'coordinates': [cls.ring()]}}

    @staticmethod
    def metadata(source):
        return {'city_id': CITY_ID, 'boundary_definition': {'kind': 'other', 'name': 'Synthetic test only'},
                'publisher': 'Synthetic fixture, no real publisher', 'dataset_title': 'Synthetic structure test',
                'dataset_version': 'test-1', 'effective_date': '2026-01-01',
                'feature_identifier': {'type': 'feature-id', 'value': 'synthetic'},
                'source_url': 'https://example.invalid/synthetic-boundary', 'retrieval_date': '2026-01-02',
                'license_url': 'https://example.invalid/synthetic-license', 'attribution': 'Synthetic fixture only',
                'declared_crs': 'EPSG:4326', 'coordinate_order': 'lon-lat',
                'expected_source_sha256': hashlib.sha256(source).hexdigest()}

    @classmethod
    def inputs(cls, feature=None):
        source = json.dumps(cls.feature() if feature is None else feature).encode()
        return source, json.dumps(cls.metadata(source)).encode()

    @staticmethod
    def resign(receipt):
        receipt['checksum_sha256'] = hashlib.sha256(receipts.canonical_bytes(
            {key: value for key, value in receipt.items() if key != 'checksum_sha256'})).hexdigest()
        return receipts.receipt_bytes(receipt)


class BoundaryReceiptTests(unittest.TestCase, SyntheticBoundaryFixtures):
    def build(self, feature=None):
        return receipts.build_receipt(*self.inputs(feature), CITY_ID)

    def test_polygon_retains_holes_and_uses_computed_extrema(self):
        feature = self.feature()
        hole = [[.5, .5], [1, .5], [1, 1], [.5, .5]]
        feature['geometry']['coordinates'].append(hole)
        feature['bbox'] = [-100, -50, 100, 50]
        feature['geometry']['bbox'] = [-100, -50, 100, 50]
        before = copy.deepcopy(feature)
        receipt = self.build(feature)
        self.assertEqual(feature, before)
        self.assertEqual(receipt['geometry']['ring_count'], 2)
        self.assertEqual(receipt['geometry']['coordinate_count'], 9)
        self.assertEqual(receipt['geometry']['extrema'], [0, 0, 2, 2])
        selected = {'type': 'Polygon', 'coordinates': feature['geometry']['coordinates']}
        self.assertEqual(receipt['geometry']['sha256'], hashlib.sha256(receipts.canonical_bytes(selected)).hexdigest())
        self.assertEqual(receipts.validate_receipt(receipts.receipt_bytes(receipt), CITY_ID), receipt)

    def test_multipolygon_preserves_every_ring_and_polygon(self):
        feature = self.feature()
        feature['geometry'] = {'type': 'MultiPolygon', 'coordinates': [[self.ring()], [self.ring(), self.ring()]]}
        receipt = self.build(feature)
        self.assertEqual(receipt['geometry']['polygon_count'], 2)
        self.assertEqual(receipt['geometry']['ring_count'], 3)
        self.assertEqual(receipt['geometry']['coordinate_count'], 15)
        receipts.validate_receipt(receipts.receipt_bytes(receipt), CITY_ID)

    def test_single_feature_collection_is_explicitly_supported(self):
        self.assertEqual(self.build({'type': 'FeatureCollection', 'features': [self.feature()]})['geometry'], self.build()['geometry'])
        for features in ([], [self.feature(), self.feature()], 'not-an-array'):
            with self.subTest(features=features), self.assertRaisesRegex(ValueError, 'exactly one'):
                self.build({'type': 'FeatureCollection', 'features': features})

    def test_only_identified_features_are_accepted(self):
        for change in ({'type': 'GeometryCollection'}, {'type': 'Polygon'}, {'id': None}, {'id': 1}, {'id': True}):
            feature = self.feature(); feature.update(change)
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.build(feature)
        feature = self.feature(); del feature['id']
        with self.assertRaisesRegex(ValueError, 'identity'):
            self.build(feature)

    def test_property_identity_uses_explicit_key_and_exact_type(self):
        source, _ = self.inputs()
        metadata = self.metadata(source)
        metadata['feature_identifier'] = {'type': 'property', 'key': 'code', 'value': 'TEST-ONLY'}
        receipts.build_receipt(source, json.dumps(metadata), CITY_ID)
        for identifier in ({'type': 'property', 'key': 'wrong', 'value': 'TEST-ONLY'},
                           {'type': 'property', 'key': 'code', 'value': True},
                           {'type': 'property', 'key': 'code', 'value': 12},
                           {'type': 'feature-id', 'value': 2**53},
                           {'type': 'guess', 'value': 'synthetic'}):
            metadata['feature_identifier'] = identifier
            with self.subTest(identifier=identifier), self.assertRaises(ValueError):
                receipts.build_receipt(source, json.dumps(metadata), CITY_ID)
        feature = self.feature(); feature['id'] = 12
        source, _ = self.inputs(feature); metadata = self.metadata(source)
        metadata['feature_identifier']['value'] = 12
        receipts.build_receipt(source, json.dumps(metadata), CITY_ID)
        metadata['feature_identifier']['value'] = '12'
        with self.assertRaisesRegex(ValueError, 'identity'):
            receipts.build_receipt(source, json.dumps(metadata), CITY_ID)

    def test_all_provenance_fields_are_required(self):
        source, _ = self.inputs()
        for key in self.metadata(source):
            metadata = self.metadata(source); del metadata[key]
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, 'Metadata'):
                receipts.build_receipt(source, json.dumps(metadata), CITY_ID)
        for key in ('publisher', 'dataset_title', 'dataset_version', 'attribution'):
            metadata = self.metadata(source); metadata[key] = ' '
            with self.subTest(key=key), self.assertRaises(ValueError):
                receipts.build_receipt(source, json.dumps(metadata), CITY_ID)

    def test_unknown_city_and_metadata_city_mismatch(self):
        source, content = self.inputs()
        with self.assertRaisesRegex(ValueError, 'city ID'):
            receipts.build_receipt(source, content, 'uk-eng-london')
        metadata = self.metadata(source); metadata['city_id'] = 'uk-eng-no-such-city'
        with self.assertRaises(ValueError):
            receipts.build_receipt(source, json.dumps(metadata), metadata['city_id'])

    def test_definition_must_be_named_and_explicit(self):
        source, _ = self.inputs()
        for definition in ({'kind': 'other', 'name': ''}, {'kind': 'city'}, 'administrative', {'kind': [], 'name': 'Test'}):
            metadata = self.metadata(source); metadata['boundary_definition'] = definition
            with self.subTest(definition=definition), self.assertRaises(ValueError):
                receipts.build_receipt(source, json.dumps(metadata), CITY_ID)
        for kind in ('administrative', 'built-up', 'settlement', 'other'):
            metadata = self.metadata(source); metadata['boundary_definition']['kind'] = kind
            receipts.build_receipt(source, json.dumps(metadata), CITY_ID)

    def test_expected_raw_file_hash_is_required_and_verified(self):
        source, _ = self.inputs()
        metadata = self.metadata(source); metadata['expected_source_sha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'SHA-256'):
            receipts.build_receipt(source, json.dumps(metadata), CITY_ID)
        metadata['expected_source_sha256'] = 'A' * 64
        with self.assertRaisesRegex(ValueError, 'lowercase'):
            receipts.build_receipt(source, json.dumps(metadata), CITY_ID)
        metadata = self.metadata(source)
        with self.assertRaisesRegex(ValueError, 'SHA-256'):
            receipts.build_receipt(source + b' ', json.dumps(metadata), CITY_ID)

    def test_crs_and_axis_order_are_explicit_no_reprojection(self):
        source, _ = self.inputs()
        for key, value in (('declared_crs', 'EPSG:27700'), ('declared_crs', None), ('coordinate_order', 'lat-lon')):
            metadata = self.metadata(source); metadata[key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                receipts.build_receipt(source, json.dumps(metadata), CITY_ID)
        for place in ('root', 'geometry', 'collection'):
            feature = self.feature()
            crs = {'type': 'name', 'properties': {'name': 'EPSG:27700'}}
            if place == 'geometry':
                feature['geometry']['crs'] = crs
            elif place == 'collection':
                feature = {'type': 'FeatureCollection', 'features': [feature], 'crs': crs}
            else:
                feature['crs'] = crs
            with self.subTest(place=place), self.assertRaisesRegex(ValueError, 'CRS'):
                self.build(feature)
        for value in (None, {'type': 'link', 'properties': {'name': 'EPSG:4326'}},
                      {'type': 'name', 'properties': {'name': 'OGC:CRS84'}}):
            feature = self.feature(); feature['crs'] = value
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, 'CRS'):
                self.build(feature)
        feature = self.feature(); feature['crs'] = {'type': 'name', 'properties': {'name': 'urn:ogc:def:crs:EPSG::4326'}}
        self.build(feature)
        feature['crs']['properties']['name'] = 'urn:ogc:def:crs:OGC:1.3:CRS84'
        source, _ = self.inputs(feature); metadata = self.metadata(source); metadata['declared_crs'] = 'OGC:CRS84'
        receipts.build_receipt(source, json.dumps(metadata), CITY_ID)

    def test_provenance_urls_are_credential_free_http_only(self):
        source, _ = self.inputs()
        bad_urls = ('file:///tmp/data', 'https://user:secret@example.invalid/a', 'https://@example.invalid/a',
                    'https://example.invalid:bad/a', 'https://', 'javascript:alert(1)',
                    'https://example.invalid/white space', 'https://example.invalid\\other/a')
        for key in ('source_url', 'license_url'):
            for value in bad_urls:
                metadata = self.metadata(source); metadata[key] = value
                with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                    receipts.build_receipt(source, json.dumps(metadata), CITY_ID)

    def test_dates_and_text_are_bounded_and_valid(self):
        source, _ = self.inputs()
        for key, value in (('effective_date', '2026-02-30'), ('retrieval_date', 'yesterday'),
                           ('dataset_title', 'a' * 2049), ('attribution', 'test\nline')):
            metadata = self.metadata(source); metadata[key] = value
            with self.subTest(key=key, value=value[:20]), self.assertRaises(ValueError):
                receipts.build_receipt(source, json.dumps(metadata), CITY_ID)

    def test_rejects_unsupported_null_and_empty_geometries(self):
        for geometry in (None, {'type': 'Point', 'coordinates': [0, 0]},
                         {'type': 'Polygon', 'coordinates': []}, {'type': 'MultiPolygon', 'coordinates': [[]]},
                         {'type': 'Polygon', 'coordinates': 'bad'}):
            feature = self.feature(); feature['geometry'] = geometry
            with self.subTest(geometry=geometry), self.assertRaises(ValueError):
                self.build(feature)
        for properties in ([], 'not-properties'):
            feature = self.feature(); feature['properties'] = properties
            with self.assertRaisesRegex(ValueError, 'properties'):
                self.build(feature)

    def test_invalid_coordinates_never_get_repaired(self):
        bad_positions = ([True, 0], [0, False], ['1', 0], [float('nan'), 0], [float('inf'), 0],
                         [-181, 0], [181, 0], [0, 91], [0, -91], [0], [0, 0, 1], None, [10**400, 0])
        for position in bad_positions:
            feature = self.feature(); feature['geometry']['coordinates'][0][1] = position
            with self.subTest(position=str(position)[:50]), self.assertRaises(ValueError):
                self.build(feature)
        feature = self.feature(); feature['geometry']['coordinates'] = [[[-180, -90], [180, -90], [180, 90], [-180, -90]]]
        self.build(feature)

    def test_ring_closure_and_cardinality_are_required(self):
        for ring in ([], self.ring()[:-1], [[0, 0]] * 4, [[0, 0], [1, 1], [0, 0], [1, 1], [0, 0]], [0, 1, 2, 0]):
            feature = self.feature(); feature['geometry']['coordinates'] = [ring]
            with self.subTest(ring=ring), self.assertRaises(ValueError):
                self.build(feature)

    def test_coordinate_and_ring_limits_apply_to_total_not_each_polygon(self):
        feature = self.feature()
        feature['geometry'] = {'type': 'MultiPolygon', 'coordinates': [[self.ring()], [self.ring()]]}
        with patch.object(receipts, 'MAX_COORDINATES', 9), self.assertRaisesRegex(ValueError, 'Coordinate count'):
            self.build(feature)
        with patch.object(receipts, 'MAX_COORDINATES', 10):
            self.build(feature)
        with patch.object(receipts, 'MAX_RINGS', 1), self.assertRaisesRegex(ValueError, 'limit'):
            self.build(feature)
        feature['geometry'] = {'type': 'Polygon', 'coordinates': [self.ring(), self.ring()]}
        with patch.object(receipts, 'MAX_RINGS', 1), self.assertRaisesRegex(ValueError, 'Ring count'):
            self.build(feature)

    def test_duplicate_keys_and_nonfinite_json_are_rejected_everywhere(self):
        source, metadata = self.inputs()
        bad_source = source.replace(b'"type": "Feature"', b'"type": "Feature", "type": "Feature"', 1)
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            receipts.build_receipt(bad_source, json.dumps(self.metadata(bad_source)), CITY_ID)
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            receipts.build_receipt(source, metadata[:-1] + b', "city_id":"uk-eng-bristol"}', CITY_ID)
        for number in (b'NaN', b'Infinity', b'-Infinity', b'1e999'):
            bad_source = source[:-1] + b',"foreign":' + number + b'}'
            with self.subTest(number=number), self.assertRaisesRegex(ValueError, 'Non-finite'):
                receipts.build_receipt(bad_source, json.dumps(self.metadata(bad_source)), CITY_ID)

    def test_raw_byte_limits_and_nesting_are_bounded(self):
        source, metadata = self.inputs()
        with patch.object(receipts, 'MAX_SOURCE_BYTES', len(source) - 1), self.assertRaisesRegex(ValueError, 'bounded'):
            receipts.build_receipt(source, metadata, CITY_ID)
        with patch.object(receipts, 'MAX_METADATA_BYTES', len(metadata) - 1), self.assertRaisesRegex(ValueError, 'limit'):
            receipts.build_receipt(source, metadata, CITY_ID)
        with self.assertRaisesRegex(ValueError, 'nesting'):
            receipts._parse(b'{"a":' + b'[' * 33 + b'0' + b']' * 33 + b'}', 1000)
        self.assertEqual(receipts._parse(b'{"a":"[[[\\\"{\\\\", "b":1}', 100), {'a': '[[["{\\', 'b': 1})
        for content in (b'\xff', b'{', b'[]', b'', b'{"a":true,}'):
            with self.subTest(content=content), self.assertRaises(ValueError):
                receipts._parse(content, 100)

    def test_deterministic_receipt_is_independent_of_metadata_key_order(self):
        source, metadata = self.inputs()
        first = receipts.receipt_bytes(receipts.build_receipt(source, metadata, CITY_ID))
        reverse = json.dumps(dict(reversed(list(json.loads(metadata).items())))).encode()
        second = receipts.receipt_bytes(receipts.build_receipt(source, reverse, CITY_ID))
        self.assertEqual(first, second)
        self.assertTrue(first.endswith(b'\n'))
        self.assertNotIn(str(ROOT).encode(), first)
        self.assertNotIn(b'created_at', first)
        self.assertNotIn(b'coordinates', first)
        self.assertEqual(self.build()['source'], {'sha256': hashlib.sha256(source).hexdigest(), 'bytes': len(source)})

    def test_geometry_hash_preserves_ring_order_and_numeric_representation(self):
        first = self.build()
        feature = self.feature(); feature['geometry']['coordinates'][0].reverse()
        self.assertNotEqual(self.build(feature)['geometry']['sha256'], first['geometry']['sha256'])
        feature = self.feature(); feature['geometry']['coordinates'][0][0][0] = 0.0
        self.assertNotEqual(self.build(feature)['geometry']['sha256'], first['geometry']['sha256'])

    def test_topology_authority_and_coverage_are_never_upgraded(self):
        # Bow-tie, collinear vertices and overlapping MultiPolygon parts are
        # deliberately accepted structurally; no topology checks are implied.
        for ring in ([[0, 0], [2, 2], [0, 2], [2, 0], [0, 0]], [[0, 0], [1, 0], [2, 0], [0, 0]]):
            feature = self.feature(); feature['geometry']['coordinates'] = [ring]
            receipt = self.build(feature)
            self.assertEqual(receipt['topology'], 'not_checked')
            self.assertEqual(receipt['city_boundary_authority'], 'not_verified')
            self.assertEqual(receipt['coverage'], 'not_assessed')
        for key, value in (('topology', 'validated'), ('city_boundary_authority', 'verified'), ('coverage', 'complete')):
            receipt = self.build(); receipt[key] = value
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, 'cannot upgrade'):
                receipts.validate_receipt(self.resign(receipt), CITY_ID)

    def test_receipt_tampering_is_detected(self):
        receipt = self.build(); receipt['metadata']['publisher'] = 'Changed'
        with self.assertRaisesRegex(ValueError, 'checksum'):
            receipts.validate_receipt(receipts.receipt_bytes(receipt), CITY_ID)
        content = receipts.receipt_bytes(self.build())
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            receipts.validate_receipt(content.rstrip()[:-1] + b',"coverage":"not_assessed"}', CITY_ID)
        with patch.object(receipts, 'MAX_RECEIPT_BYTES', len(content) - 1), self.assertRaisesRegex(ValueError, 'limit'):
            receipts.validate_receipt(content, CITY_ID)
        with self.assertRaisesRegex(ValueError, 'city ID'):
            receipts.validate_receipt(content, 'uk-eng-london')

    def test_rehashed_receipts_still_cannot_change_schema_or_claim_level(self):
        mutations = [lambda r: r.update(schema='boundary-receipt/v2'),
                     lambda r: r.update(complete=True),
                     lambda r: r['checker'].update(version='99.0'),
                     lambda r: r['checker'].update(validation_level='topologically_validated'),
                     lambda r: r['source'].update(bytes=True),
                     lambda r: r['source'].update(sha256='0' * 64),
                     lambda r: r['source'].update(bytes=receipts.MAX_SOURCE_BYTES + 1),
                     lambda r: r['geometry'].update(coordinate_count=3),
                     lambda r: r['geometry'].update(ring_count=receipts.MAX_RINGS + 1),
                     lambda r: r['geometry'].update(polygon_count=2),
                     lambda r: r['geometry'].update(extrema=[2, 0, 0, 2]),
                     lambda r: r['geometry'].update(extrema=[False, 0, 2, 2]),
                     lambda r: r['geometry'].update(sha256='bad'),
                     lambda r: r['metadata'].update(authority='verified')]
        for mutation in mutations:
            receipt = self.build(); mutation(receipt)
            with self.subTest(receipt=receipt), self.assertRaises(ValueError):
                receipts.validate_receipt(self.resign(receipt), CITY_ID)

    def test_receipt_reader_checks_record_without_source_or_authentication_claim(self):
        receipt = self.build()
        with patch.object(receipts, 'read_bounded_file', side_effect=AssertionError('must not open source')):
            self.assertEqual(receipts.validate_receipt(receipts.receipt_bytes(receipt).decode(), CITY_ID), receipt)
        # A self-checksum is not a signature. Recomputed, internally consistent
        # provenance remains an unverified operator claim.
        receipt['metadata']['publisher'] = 'Unverified replacement claim'
        checked = receipts.validate_receipt(self.resign(receipt), CITY_ID)
        self.assertEqual(checked['city_boundary_authority'], 'not_verified')


@unittest.skipUnless(hasattr(os, 'O_NOFOLLOW') and os.open in os.supports_dir_fd,
                     'Secure receipt file I/O requires POSIX nofollow directory descriptors')
class BoundaryReceiptFileTests(unittest.TestCase, SyntheticBoundaryFixtures):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source_path = self.root / 'synthetic.geojson'
        self.metadata_path = self.root / 'synthetic-metadata.json'
        self.output = self.root / 'receipt.json'
        source, metadata = self.inputs()
        self.source_path.write_bytes(source)
        self.metadata_path.write_bytes(metadata)
        self.content = receipts.receipt_bytes(receipts.build_receipt(source, metadata, CITY_ID))

    def publish(self, output=None):
        return receipts.publish_receipt(output or self.output, self.content, self.source_path, self.metadata_path, self.root)

    def test_unsupported_platform_fails_closed_with_specific_error(self):
        with patch.object(receipts.os, 'supports_dir_fd', set()):
            with self.assertRaises(receipts.UnsupportedPlatformError):
                receipts.read_bounded_file(self.source_path, 1000)
            with self.assertRaises(receipts.UnsupportedPlatformError):
                self.publish()
        self.assertFalse(self.output.exists())

    def test_bounded_reads_and_atomic_new_file_idempotency(self):
        source = self.source_path.read_bytes()
        self.assertEqual(receipts.read_bounded_file(self.source_path, len(source)), source)
        with self.assertRaisesRegex(ValueError, 'bounded'):
            receipts.read_bounded_file(self.source_path, len(source) - 1)
        self.assertTrue(self.publish())
        before = self.output.stat()
        self.assertFalse(self.publish())
        after = self.output.stat()
        self.assertEqual((before.st_ino, before.st_mtime_ns), (after.st_ino, after.st_mtime_ns))
        self.assertEqual(self.output.read_bytes(), self.content)
        self.assertEqual(self.source_path.read_bytes(), source)
        self.assertFalse(list(self.root.glob('.boundary-receipt-*')))

    def test_existing_different_output_never_changes(self):
        self.output.write_bytes(b'pre-existing receipt')
        with self.assertRaisesRegex(ValueError, 'overwrite'):
            self.publish()
        self.assertEqual(self.output.read_bytes(), b'pre-existing receipt')
        self.assertFalse(list(self.root.glob('.boundary-receipt-*')))

    def test_input_output_aliases_and_traversal_are_rejected(self):
        for target in (self.source_path, self.metadata_path, self.root / 'missing' / '..' / 'receipt.json'):
            with self.subTest(target=target), self.assertRaises(ValueError):
                self.publish(target)
        alias = self.root / 'alias.json'; os.link(self.source_path, alias)
        with self.assertRaisesRegex(ValueError, 'alias'):
            self.publish(alias)
        with self.assertRaisesRegex(ValueError, 'separate'):
            receipts.publish_receipt(self.output, self.content, self.source_path, self.source_path, self.root)
        with self.assertRaisesRegex(ValueError, 'traversal'):
            receipts.read_bounded_file(self.root / 'missing' / '..' / self.source_path.name, 1000)

    def test_symlink_files_and_parent_directories_are_rejected(self):
        link = self.root / 'input-link.json'; link.symlink_to(self.source_path)
        with self.assertRaisesRegex(ValueError, 'symlinks'):
            receipts.read_bounded_file(link, 10000)
        self.output.symlink_to(self.source_path)
        with self.assertRaisesRegex(ValueError, 'symlinks'):
            self.publish()
        parent_link = self.root / 'parent-link'; parent_link.symlink_to(self.root, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'symlinks'):
            receipts.read_bounded_file(parent_link / self.source_path.name, 10000)
        with self.assertRaisesRegex(ValueError, 'symlinks'):
            self.publish(parent_link / 'new.json')
        self.assertFalse((self.root / 'new.json').exists())

    def test_non_regular_inputs_are_rejected_without_blocking(self):
        with self.assertRaisesRegex(ValueError, 'bounded regular'):
            receipts.read_bounded_file(self.root, 1000)
        fifo = self.root / 'fifo'; os.mkfifo(fifo)
        with self.assertRaisesRegex(ValueError, 'bounded regular'):
            receipts.read_bounded_file(fifo, 1000)

    def test_seed_workspace_history_and_cache_directories_are_protected(self):
        protected = ('backend/data/cities/new.json', 'backend/data/uk-cities.json', 'database/new.json',
                     '.local/city/current.gugis.json', '.local/cities/new/draft.json',
                     '.local/city/versions/new.json', '.local/render-cache/new.json',
                     '.local/coverage/boundaries/nested/new.json')
        for relative in protected:
            output = self.root / relative
            with self.subTest(relative=relative), self.assertRaises(ValueError):
                self.publish(output)
            self.assertFalse(output.exists())
            self.assertFalse(output.parent.exists())
        output = self.root / '.local/coverage/boundaries' / f'{CITY_ID}.json'
        output.parent.mkdir(parents=True)
        self.assertTrue(self.publish(output))
        self.assertEqual(output.read_bytes(), self.content)
        self.assertFalse((self.root / '.local/city').exists())

    def test_missing_output_parent_is_not_initialized(self):
        output = self.root / 'not-created' / 'receipt.json'
        with self.assertRaisesRegex(ValueError, 'paths must exist'):
            self.publish(output)
        self.assertFalse(output.parent.exists())

    def test_failed_atomic_publication_cleans_temp_and_keeps_sources(self):
        original = self.source_path.read_bytes()
        with patch.object(receipts.os, 'link', side_effect=OSError('synthetic failure')):
            with self.assertRaises(ValueError):
                self.publish()
        self.assertFalse(self.output.exists())
        self.assertFalse(list(self.root.glob('.boundary-receipt-*')))
        self.assertEqual(self.source_path.read_bytes(), original)

    def test_concurrent_existing_output_is_never_replaced(self):
        def race(*args, **kwargs):
            self.output.write_bytes(b'concurrent bytes')
            raise FileExistsError
        with patch.object(receipts.os, 'link', side_effect=race), self.assertRaisesRegex(ValueError, 'concurrently'):
            self.publish()
        self.assertEqual(self.output.read_bytes(), b'concurrent bytes')
        self.assertFalse(list(self.root.glob('.boundary-receipt-*')))

    def cli(self, *extra):
        return subprocess.run([sys.executable, str(ROOT / 'data-pipeline/validate_city_boundary.py'),
                               '--city-id', CITY_ID, '--input', str(self.source_path),
                               '--metadata', str(self.metadata_path), *extra], capture_output=True, text=True, cwd=self.root)

    def test_cli_requires_explicit_output_and_produces_deterministic_receipt(self):
        result = self.cli()
        self.assertEqual(result.returncode, 2)
        self.assertIn('--output', result.stderr)
        result = self.cli('--output', str(self.output))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('topology not checked', result.stdout)
        self.assertIn('coverage not assessed', result.stdout)
        self.assertEqual(self.output.read_bytes(), self.content)
        result = self.cli('--output', str(self.output))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('identical', result.stdout)

    def test_cli_failure_creates_no_receipt_or_partial_files(self):
        metadata = json.loads(self.metadata_path.read_bytes()); metadata['expected_source_sha256'] = '0' * 64
        self.metadata_path.write_text(json.dumps(metadata))
        before = {path.name: path.read_bytes() for path in self.root.iterdir()}
        result = self.cli('--output', str(self.output))
        self.assertEqual(result.returncode, 2)
        self.assertIn('SHA-256', result.stderr)
        self.assertEqual({path.name: path.read_bytes() for path in self.root.iterdir()}, before)


if __name__ == '__main__':
    unittest.main()
