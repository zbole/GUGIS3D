"""The catalogue is tied to exact source bytes and resolved CityArchive geometry."""
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import stat
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import zipfile

from fastapi.testclient import TestClient
from app.main import app
from app.routers import city, workspace
from app.services.city_archive import load_city
from app.services import city_workspaces, source_candidates as candidates

DATA = Path(__file__).resolve().parents[1] / 'data' / 'cities'
EXPECTED = {
    'london': {'counts': (823, 814, 762), 'height': (951721975, 0.5), 'wording': 470,
        'removed': [235693291, 297204228, 547238370, 547238381, 825208756, 1149973649, 1487538311, 1487538312, 1487538313],
        'preexisting': [364313092, 367642706]},
    'birmingham': {'counts': (809, 804, 479), 'height': (1436375109, 155.0), 'wording': 623,
        'removed': [29997398, 37716925, 49023587, 195934961, 883020076], 'preexisting': []},
}


def sha(value):
    return hashlib.sha256(value).hexdigest()


def snapshot(root):
    return {str(path.relative_to(root)): sha(path.read_bytes()) for path in root.rglob('*') if path.is_file()}


class CandidateSemanticAuditTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.audit_bytes = (DATA / candidates.AUDIT_NAME).read_bytes()
        cls.audit = json.loads(cls.audit_bytes)

    def test_manifest_and_all_eight_inputs_are_exact_byte_pinned(self):
        self.assertEqual(sha(self.audit_bytes), candidates.AUDIT_SHA256)
        self.assertLess(len(self.audit_bytes), candidates.MAX_AUDIT_BYTES)
        for city_id, entry in self.audit['cities'].items():
            self.assertEqual(set(entry['files']), set(candidates.input_paths(city_id)))
            for role, (relative, maximum) in candidates.input_paths(city_id).items():
                with self.subTest(city_id=city_id, role=role):
                    raw = (DATA / relative).read_bytes()
                    self.assertEqual(entry['files'][role], {'sha256': sha(raw), 'byte_length': len(raw)})
                    self.assertLess(len(raw), maximum)
            source = json.loads((DATA / f'{city_id}-source.json').read_bytes())
            source_data = json.loads((DATA / f'{city_id}-osm.json').read_bytes())
            self.assertEqual(entry['summary']['source']['snapshot'], source_data['osm3s']['timestamp_osm_base'])
            self.assertEqual(entry['summary']['source']['snapshot'], source['osm_timestamp'])
            self.assertEqual(entry['summary']['source']['licence'], 'ODbL 1.0')

    def test_semantic_delta_is_exactly_known_corrections_not_pooled_id_diffs(self):
        for city_id, expected in EXPECTED.items():
            with self.subTest(city_id=city_id):
                entry = self.audit['cities'][city_id]
                summary = entry['summary']; changes = summary['changes']
                base = load_city((DATA / 'baselines/v1' / f'{city_id}.gugis.json').read_bytes())
                next_city = load_city((DATA / 'candidates/v2' / f'{city_id}.gugis.json').read_bytes())
                source = json.loads((DATA / f'{city_id}-osm.json').read_bytes())
                source_ways = {way['id']: way for way in source['elements'] if way['type'] == 'way'}
                before = {i.id: i for i in base.instances}; after = {i.id: i for i in next_city.instances}
                kept = set(before) & set(after)
                self.assertEqual(set(before), set(base.assets))
                self.assertEqual(set(after), set(next_city.assets))
                self.assertEqual((len(before), len(after), len(next_city.roads)), expected['counts'])
                self.assertEqual(base.roads, next_city.roads)
                self.assertIsNone(base.environment); self.assertIsNone(next_city.environment)
                self.assertEqual([int(key[3:]) for key in sorted(set(before)-set(after), key=lambda k: int(k[3:]))], expected['removed'])
                self.assertEqual(set(after)-set(before), set())
                geometry_changes = []; wording_changes = 0
                for key in sorted(kept):
                    self.assertEqual(before[key], after[key])
                    # load_city resolves mesh/box-set/box references before any
                    # comparison; geometry pool IDs are not geometry evidence.
                    old = base.assets[key].model_dump(); new = next_city.assets[key].model_dump()
                    self.assertEqual(old['parameters'], new['parameters'])
                    old_reason = old['nodes'][0]['attributes'].pop('高度依据')
                    new_reason = new['nodes'][0]['attributes'].pop('高度依据')
                    self.assertEqual(old['nodes'], new['nodes'])
                    if old['templates'] != new['templates']:
                        a = old['templates']['volume']; b = new['templates']['volume']
                        from_height = max(v[2] for v in a['vertices']); to_height = max(v[2] for v in b['vertices'])
                        self.assertEqual(min(v[2] for v in a['vertices']), 0)
                        self.assertEqual(min(v[2] for v in b['vertices']), 0)
                        self.assertEqual({v[2] for v in a['vertices']}, {0, from_height})
                        self.assertEqual({v[2] for v in b['vertices']}, {0, to_height})
                        a['vertices'] = [(v[0], v[1], to_height if v[2] == from_height else v[2]) for v in a['vertices']]
                        self.assertEqual(a, b)  # XY, indices, colors and every other field unchanged.
                        osm_way = int(key[3:])
                        self.assertEqual(float(source_ways[osm_way]['tags']['height']), to_height)
                        self.assertEqual(old_reason, '缺少或不支持的高度：假设 9.6 m')
                        self.assertEqual(new_reason, 'OSM height 标签（未独立测量核验）')
                        geometry_changes.append({'osm_way': osm_way, 'name': base.assets[key].parameters.name,
                            'baseline_height_m': from_height, 'candidate_height_m': to_height})
                    elif old_reason != new_reason:
                        self.assertEqual(old_reason, '缺少或不支持的高度：假设 9.6 m')
                        self.assertEqual(new_reason, '缺少高度与楼层标签：假设 9.6 m')
                        wording_changes += 1
                    self.assertEqual(old, new)  # No overlooked asset/node/overview changes.
                self.assertEqual(geometry_changes, changes['height_corrections'])
                self.assertEqual([(v['osm_way'], v['candidate_height_m']) for v in geometry_changes], [expected['height']])
                self.assertEqual(geometry_changes[0]['baseline_height_m'], 9.6)
                self.assertEqual(wording_changes, expected['wording'])
                self.assertEqual(changes['assumed_height_wording_changes'], wording_changes)
                self.assertEqual(changes['added_osm_ways'], [])
                self.assertEqual(changes['unchanged'], {'placements': True, 'parameters': True, 'roads': True})
                base_receipt = json.loads((DATA / f'{city_id}-import.json').read_bytes())
                next_receipt = json.loads((DATA / 'candidates/v2' / f'{city_id}-import.json').read_bytes())
                all_omissions = {v['osm_way']: v for v in next_receipt['omitted_buildings']}
                self.assertEqual(changes['removed_buildings'], [all_omissions[k] for k in expected['removed']])
                self.assertEqual(changes['preexisting_omissions'], [all_omissions[k] for k in expected['preexisting']])
                self.assertEqual(base_receipt['omitted_buildings'], changes['preexisting_omissions'])
                self.assertEqual(set(all_omissions), set(expected['removed'] + expected['preexisting']))
                for role, document, receipt in [('baseline', base, base_receipt), ('candidate', next_city, next_receipt)]:
                    self.assertEqual(summary[role]['height_policy'], receipt['height_policy'])
                    self.assertEqual(summary[role]['height_policy'], json.loads(document.metadata['height_policy']))
                    self.assertEqual(sum(summary[role]['height_policy'].values()), len(document.instances))
                    self.assertEqual(summary[role]['revision'], receipt['gugis_sha256'])
                    self.assertEqual(summary[role]['building_count'], len(document.instances))
                    self.assertEqual(summary[role]['road_count'], len(document.roads))
                self.assertEqual(summary['source']['query_bbox_wgs84'], next_receipt['query_bbox_wgs84'])
                self.assertEqual(summary['source']['actual_data_bbox_wgs84'], next_receipt['actual_data_bbox_wgs84'])
                self.assertNotEqual(summary['source']['query_bbox_wgs84'], summary['source']['actual_data_bbox_wgs84'])
                self.assertEqual(summary['source']['scope'], 'sample-area')


class CandidateEndpointTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory(); self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.data = self.root / 'data'; self.data.mkdir()
        paths = {candidates.AUDIT_NAME, *[path for city_id in EXPECTED for path,_ in candidates.input_paths(city_id).values()]}
        for relative in paths:
            target = self.data / relative; target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(DATA / relative, target)
        self.patch(candidates, 'DATA_ROOT', self.data)
        self.patch(city, 'CITY_DIR', self.root / 'state' / 'city')
        self.patch(city, 'SEED', self.root / 'never-read.gugis.json')
        candidates._catalogue_bytes.cache_clear()
        self.addCleanup(candidates._catalogue_bytes.cache_clear)
        self.client = TestClient(app)

    def patch(self, target, name, value):
        helper = patch.object(target, name, value); helper.start(); self.addCleanup(helper.stop)

    def summary(self, city_id='london'):
        response = self.client.get(f'/cities/{city_id}/source-candidates')
        self.assertEqual(response.status_code, 200, response.text)
        return response, response.json()['candidates'][0]

    def assert_integrity_failure(self, response):
        self.assertEqual(response.status_code, 503, response.text)
        self.assertEqual(response.json()['detail']['code'], 'source_candidate_integrity_failed')
        self.assertEqual(response.headers['cache-control'], 'no-store')
        self.assertEqual(response.headers['x-content-type-options'], 'nosniff')
        self.assertNotIn('etag', response.headers)
        self.assertNotIn(str(self.root), response.text)

    def test_gets_have_exact_etags_safe_downloads_and_zero_workspace_side_effects(self):
        before = snapshot(self.root)
        with patch.object(city, 'read_current', side_effect=AssertionError('Workspace initializer called')), \
             patch.object(city, 'current_revision', side_effect=AssertionError('Revision route called')), \
             patch.object(workspace, 'get_draft', side_effect=AssertionError('Draft read called')), \
             patch.object(city_workspaces, 'workspace_entry', side_effect=AssertionError('Project catalogue called')), \
             patch('app.services.city_archive.load_city', side_effect=AssertionError('Geometry expanded at request time')):
            for city_id in EXPECTED:
                response, value = self.summary(city_id)
                self.assertEqual(response.headers['etag'], f'"{sha(response.content)}"')
                self.assertEqual(response.headers['content-length'], str(len(response.content)))
                self.assertEqual(response.headers['x-content-type-options'], 'nosniff')
                self.assertEqual(response.json()['comparison_basis'], candidates.COMPARISON_BASIS)
                self.assertEqual(value['status'], 'non-active')
                self.assertEqual(value['version'], 'v2')
                self.assertLess(len(response.content), candidates.MAX_SUMMARY_BYTES)
                for kind, descriptor in value['downloads'].items():
                    download = self.client.get(descriptor['url'])
                    self.assertEqual(download.status_code, 200, download.text[:100])
                    self.assertEqual(sha(download.content), descriptor['sha256'])
                    self.assertEqual(len(download.content), descriptor['byte_length'])
                    self.assertEqual(download.headers['content-length'], str(descriptor['byte_length']))
                    self.assertEqual(download.headers['etag'], f'"{descriptor["sha256"]}"')
                    self.assertEqual(download.headers['content-disposition'], f'attachment; filename="{descriptor["filename"]}"')
                    self.assertRegex(descriptor['filename'], r'^[a-z0-9.-]+$')
                    self.assertEqual(download.headers['content-type'], descriptor['media_type'])
                    self.assertEqual(download.headers['x-content-type-options'], 'nosniff')
                    again = self.client.get(descriptor['url'])
                    self.assertEqual(again.content, download.content)
                    role = {'archive': 'candidate_archive', 'report': 'candidate_receipt'}.get(kind)
                    if role:
                        self.assertEqual(download.content, (self.data / candidates.input_paths(city_id)[role][0]).read_bytes())
                    else:
                        self.check_bundle(download.content, city_id, value)
        self.assertEqual(snapshot(self.root), before)
        self.assertFalse((self.root / 'state').exists())

    def check_bundle(self, content, city_id, value):
        with zipfile.ZipFile(io.BytesIO(content)) as package:
            expected = {f'{city_id}.gugis.json': f'candidates/v2/{city_id}.gugis.json',
                f'{city_id}-import.json': f'candidates/v2/{city_id}-import.json',
                f'{city_id}-baseline-import.json': f'{city_id}-import.json',
                f'{city_id}-source.json': f'{city_id}-source.json',
                'README.md': 'candidates/v2/README.md', 'DATA_LICENSE.md': 'DATA_LICENSE.md'}
            self.assertEqual(set(package.namelist()), {*expected, 'audit-summary.json', 'PACKAGE-README.txt'})
            self.assertEqual(len(package.namelist()), len(expected) + 2)
            for name, relative in expected.items():
                self.assertEqual(package.read(name), (self.data / relative).read_bytes())
            for member in package.infolist():
                self.assertEqual(member.date_time, (1980, 1, 1, 0, 0, 0))
                self.assertEqual(member.compress_type, zipfile.ZIP_STORED)
                self.assertEqual(member.create_system, 0)
                self.assertNotIn('/', member.filename)
            notice = package.read('PACKAGE-README.txt').decode('utf-8')
            self.assertIn('raw OpenStreetMap extract and original seed archive are NOT bundled', notice)
            self.assertIn(f'backend/data/cities/{city_id}-osm.json', notice)
            self.assertIn(f'backend/data/cities/baselines/v1/{city_id}.gugis.json', notice)
            self.assertIn('full replacement candidate', notice)
            self.assertIn('explicit manual draft', notice)
            self.assertIn('non-active', notice)
            self.assertIn('those relative paths do not describe this ZIP', notice)
            self.assertIn('not independently measured', notice)
            self.assertIn('No DEM', notice)
            audit = json.loads(package.read('audit-summary.json'))
            self.assertEqual(audit['city_id'], city_id)
            self.assertEqual(audit['baseline'], value['baseline'])
            self.assertEqual(audit['candidate'], value['candidate'])
            self.assertEqual(audit['changes'], value['changes'])
            self.assertEqual(audit['files']['readme']['sha256'], sha(package.read('README.md')))
            self.assertEqual(audit['files']['licence']['sha256'], sha(package.read('DATA_LICENSE.md')))

    def test_conditional_get_handles_lists_weak_get_validators_and_wildcard(self):
        response, value = self.summary()
        urls = [(response.request.url.path, response.headers['etag'])]
        urls += [(entry['url'], f'"{entry["sha256"]}"') for entry in value['downloads'].values()]
        for url, etag in urls:
            for header in (etag, f'"other", W/{etag}', '*'):
                with self.subTest(url=url, header=header):
                    cached = self.client.get(url, headers={'If-None-Match': header})
                    self.assertEqual(cached.status_code, 304, cached.text)
                    self.assertEqual(cached.content, b'')
                    self.assertEqual(cached.headers['etag'], etag)
                    self.assertNotIn('content-length', cached.headers)
            self.assertEqual(self.client.get(url, headers={'If-None-Match': '"other"'}).status_code, 200)

    def test_bristol_empty_and_unknown_cities_never_fallback_or_read_files(self):
        with patch.object(candidates, 'bounded_read', side_effect=AssertionError('Unexpected filesystem read')):
            response = self.client.get('/cities/bristol/source-candidates')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['candidates'], [])
            for city_id in ('unknown', 'London', 'Bristol', 'bristol%00', '..%5Clondon'):
                self.assertEqual(self.client.get(f'/cities/{city_id}/source-candidates').status_code, 404)
            self.assertEqual(self.client.get('/cities/bristol/source-candidates/v2/downloads/' + 'a'*64 + '/archive').status_code, 404)

    def test_unknown_versions_digests_kinds_and_malicious_inputs_are_not_file_paths(self):
        _, value = self.summary()
        valid = value['downloads']['archive']; digest = valid['sha256']
        paths = [f'/cities/london/source-candidates/{version}/downloads/{digest}/archive' for version in ('v1', 'v3', '..%5Cv2')]
        paths += [f'/cities/london/source-candidates/v2/downloads/{value}/archive' for value in ('a'*64, digest.upper(), '../etc/passwd', '%00', 'f'*1000, 'https:%2F%2Fevil.example')]
        paths += [f'/cities/london/source-candidates/v2/downloads/{digest}/{kind}' for kind in ('source', 'current', 'README.md', '..%5Carchive', 'http:%2F%2Fevil.example')]
        paths += [f'/cities/birmingham/source-candidates/v2/downloads/{digest}/archive']
        for path in paths:
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 404)
        for method in ('post', 'put', 'patch', 'delete'):
            self.assertEqual(getattr(self.client, method)('/cities/london/source-candidates').status_code, 405)
            self.assertEqual(getattr(self.client, method)(valid['url']).status_code, 405)

    def test_corruption_in_each_input_fails_closed_even_after_cache_and_with_matching_etag(self):
        response, value = self.summary()
        for role, (relative, _) in candidates.input_paths('london').items():
            with self.subTest(role=role):
                path = self.data / relative; raw = path.read_bytes(); metadata = path.stat()
                corrupt = bytes([raw[0] ^ 1]) + raw[1:]
                path.write_bytes(corrupt)
                # Exact-byte checking, rather than mtime+size-only trust.
                os.utime(path, ns=(metadata.st_atime_ns, metadata.st_mtime_ns))
                self.assert_integrity_failure(self.client.get(response.request.url.path, headers={'If-None-Match': response.headers['etag']}))
                for descriptor in value['downloads'].values():
                    self.assert_integrity_failure(self.client.get(descriptor['url'], headers={'If-None-Match': f'"{descriptor["sha256"]}"'}))
                path.write_bytes(raw)
        self.assertEqual(self.summary()[1], value)

    def test_manifest_missing_corrupt_oversize_and_directory_fail_closed(self):
        path = self.data / candidates.AUDIT_NAME; raw = path.read_bytes()
        for content in (b'{}', b'x' * (candidates.MAX_AUDIT_BYTES + 1)):
            path.write_bytes(content)
            self.assert_integrity_failure(self.client.get('/cities/london/source-candidates'))
        path.unlink()
        self.assert_integrity_failure(self.client.get('/cities/london/source-candidates'))
        path.mkdir()
        self.assert_integrity_failure(self.client.get('/cities/london/source-candidates'))
        path.rmdir(); path.write_bytes(raw)

    def test_oversize_candidate_rejected_before_opening_it(self):
        _, value = self.summary()
        path = self.data / 'candidates/v2/london.gugis.json'
        with path.open('wb') as handle:
            handle.truncate(candidates.MAX_DOCUMENT_BYTES + 1)
        real_open = os.open
        def guarded_open(filename, flags, *args, **kwargs):
            self.assertNotEqual(Path(filename), path, 'Oversized candidate was opened')
            return real_open(filename, flags, *args, **kwargs)
        with patch.object(candidates.os, 'open', side_effect=guarded_open):
            self.assert_integrity_failure(self.client.get('/cities/london/source-candidates'))
            self.assert_integrity_failure(self.client.get(value['downloads']['archive']['url']))

    def test_receipt_hash_disagreement_is_rejected_even_if_file_pin_is_updated(self):
        original = candidates.read_audit()
        for field, replacement in [('source_sha256', '0'*64), ('gugis_sha256', '0'*64), ('gugis_bytes', 1), ('imported_buildings', 1)]:
            audit = copy.deepcopy(original)
            path = self.data / 'candidates/v2/london-import.json'; raw = path.read_bytes()
            receipt = json.loads(raw); receipt[field] = replacement; changed = json.dumps(receipt).encode(); path.write_bytes(changed)
            audit['cities']['london']['files']['candidate_receipt'] = {'sha256': sha(changed), 'byte_length': len(changed)}
            with self.subTest(field=field), patch.object(candidates, 'read_audit', return_value=audit):
                self.assert_integrity_failure(self.client.get('/cities/london/source-candidates'))
            path.write_bytes(raw)

    def test_wrong_generated_zip_digest_is_rejected(self):
        _, value = self.summary()
        with patch.object(candidates, 'bundle_bytes', return_value=b'not a zip'):
            self.assert_integrity_failure(self.client.get(value['downloads']['provenance']['url']))

    def test_summary_cache_is_bounded_and_outputs_cannot_mutate_it(self):
        for _ in range(3):
            for city_id in ('london', 'birmingham', 'bristol'):
                self.assertEqual(self.client.get(f'/cities/{city_id}/source-candidates').status_code, 200)
        self.assertLessEqual(candidates._catalogue_bytes.cache_info().currsize, 2)
        self.assertEqual(candidates._catalogue_bytes.cache_info().maxsize, 2)
        _, value = self.summary(); value['changes']['removed_buildings'].clear()
        self.assertEqual(len(self.summary()[1]['changes']['removed_buildings']), 9)

    def test_file_and_directory_symlinks_and_fifo_fail_closed(self):
        path = self.data / 'candidates/v2/london.gugis.json'
        backup = self.data / 'saved.json'; path.rename(backup)
        try:
            path.symlink_to(backup)
        except (OSError, NotImplementedError):
            self.skipTest('Host cannot create test symlinks')
        self.assert_integrity_failure(self.client.get('/cities/london/source-candidates'))
        path.unlink(); backup.rename(path)
        directory = self.data / 'candidates/v2'; moved = self.data / 'moved-v2'; directory.rename(moved)
        directory.symlink_to(moved, target_is_directory=True)
        self.assert_integrity_failure(self.client.get('/cities/london/source-candidates'))
        directory.unlink(); moved.rename(directory)
        path.unlink(); path.mkdir()
        self.assert_integrity_failure(self.client.get('/cities/london/source-candidates'))
        path.rmdir()
        if hasattr(os, 'mkfifo'):
            os.mkfifo(path)
            self.assert_integrity_failure(self.client.get('/cities/london/source-candidates'))

    def test_portable_reader_does_not_require_posix_only_open_flags(self):
        relative = 'candidates/v2/london-import.json'
        with patch.object(candidates.os, 'O_NOFOLLOW', 0, create=True), patch.object(candidates.os, 'O_NONBLOCK', 0, create=True):
            self.assertEqual(candidates.bounded_read(self.data, relative, 65536), (self.data / relative).read_bytes())
            self.assertEqual(self.client.get('/cities/london/source-candidates').status_code, 200)
        reparse = SimpleNamespace(st_mode=stat.S_IFDIR | 0o755, st_file_attributes=0x400)
        self.assertTrue(candidates._is_link(reparse), 'Windows junction/reparse point was accepted')

    def test_windows_cross_api_ctime_difference_keeps_other_identity_checks(self):
        path = (1, 2, stat.S_IFREG | 0o644, 50, 100, 200)
        descriptor = (*path[:5], 300)
        self.assertTrue(candidates._same_opened_file(path, descriptor, platform='nt'))
        self.assertFalse(candidates._same_opened_file(path, descriptor, platform='posix'))
        for index in range(5):
            changed = list(descriptor); changed[index] += 1
            with self.subTest(field=index):
                self.assertFalse(candidates._same_opened_file(path, tuple(changed), platform='nt'))

    def test_reader_rejects_racing_replacement_before_open(self):
        relative = 'candidates/v2/london-import.json'; path = self.data / relative
        real_open = os.open
        replaced = False
        def racing_open(filename, flags, *args, **kwargs):
            nonlocal replaced
            if Path(filename) == path and not replaced:
                replaced = True
                replacement = path.with_suffix('.replacement'); replacement.write_bytes(path.read_bytes()); replacement.replace(path)
            return real_open(filename, flags, *args, **kwargs)
        with patch.object(candidates.os, 'open', side_effect=racing_open):
            with self.assertRaises(candidates.CandidateIntegrityError):
                candidates.bounded_read(self.data, relative, 65536)
        self.assertTrue(replaced)

    def test_reader_rejects_changed_descriptor_during_read(self):
        relative = 'candidates/v2/london-import.json'
        real_fstat = os.fstat
        for changed_field in ('st_mtime_ns', 'st_ctime_ns'):
            calls = 0
            def changed_fstat(descriptor):
                nonlocal calls
                calls += 1
                value = real_fstat(descriptor)
                if calls == 2:
                    fields = {name: getattr(value, name) for name in ('st_dev', 'st_ino', 'st_mode', 'st_size', 'st_mtime_ns', 'st_ctime_ns')}
                    fields[changed_field] += 1
                    return SimpleNamespace(**fields)
                return value
            with self.subTest(field=changed_field), patch.object(candidates.os, 'fstat', side_effect=changed_fstat):
                with self.assertRaises(candidates.CandidateIntegrityError):
                    candidates.bounded_read(self.data, relative, 65536)
            self.assertEqual(calls, 2)

    def test_reader_rejects_internal_relative_path_escape_and_invalid_limits(self):
        for relative in ('../london.gugis.json', '/etc/passwd', 'candidates//v2', 'candidates\\v2', 'C:evil'):
            with self.subTest(relative=relative), self.assertRaises(candidates.CandidateIntegrityError):
                candidates.bounded_read(self.data, relative, 65536)
        for limit, length in ((True, None), (-1, None), (65536, True), (65536, 65537), (candidates.MAX_BUNDLE_BYTES + 1, None)):
            with self.subTest(limit=limit, length=length), self.assertRaises(candidates.CandidateIntegrityError):
                candidates.bounded_read(self.data, 'london-import.json', limit, length)


if __name__ == '__main__':
    unittest.main()
