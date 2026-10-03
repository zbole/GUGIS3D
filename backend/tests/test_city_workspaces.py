import json
import asyncio
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import httpx

from fastapi.testclient import TestClient
from fastapi import HTTPException

from app.main import app
from app.city_models import CityDocument
from app.services.city_archive import archive_bytes
from app.services import city_workspaces
from app.routers import city


class IndependentCityWorkspacesTests(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.seed = self.root / 'data' / 'bristol.gugis.json'
        self.seed.parent.mkdir()
        self.seed.write_bytes(archive_bytes(self.document('Original Bristol')))
        for key, value in [('CITY_DIR', self.root / '.local' / 'city'), ('SEED', self.seed),
                           ('_validated_snapshot', None), ('_archive_snapshot', None)]:
            helper = patch.object(city, key, value)
            helper.start()
            self.addCleanup(helper.stop)
        self.client = TestClient(app)
        self.start = self.client.get('/city/current').json()
        self.bristol_bytes = (city.CITY_DIR / 'current.gugis.json').read_bytes()

    @staticmethod
    def document(name):
        return CityDocument(format='gugis-city', version='1.0', coordinate_system='ENU_METERS_WGS84',
                            name=name, assets={}, instances=[])

    def workspace_path(self, city_id):
        return city.CITY_DIR if city_id == 'bristol' else city.CITY_DIR.parent / 'cities' / city_id

    def get(self, city_id):
        response = self.client.get(f'/cities/{city_id}/city/current')
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_catalog_is_read_only_and_marks_empty_workspaces_pending(self):
        response = self.client.get('/cities')
        self.assertEqual(response.status_code, 200, response.text)
        catalog = {entry['id']: entry for entry in response.json()['cities']}
        self.assertEqual(set(catalog), {'bristol', 'london', 'birmingham'})
        self.assertEqual(catalog['london']['status'], 'pending')
        self.assertEqual(catalog['london']['building_count'], 0)
        self.assertIn('非全城', catalog['bristol']['coverage_label'])
        self.assertEqual(catalog['london']['center_wgs84'], [-0.1305, 51.502])
        self.assertFalse(self.workspace_path('london').exists())
        self.assertFalse(self.workspace_path('birmingham').exists())
        self.assertEqual((city.CITY_DIR / 'current.gugis.json').read_bytes(), self.bristol_bytes)

    def test_pending_city_is_empty_and_never_falls_back_to_bristol(self):
        result = self.get('london')
        self.assertEqual(result['document']['instances'], [])
        self.assertEqual(result['document']['assets'], {})
        self.assertEqual(result['document']['metadata']['city_id'], 'london')
        self.assertIn('待导入', result['document']['name'])
        self.assertNotEqual(result['revision'], self.start['revision'])
        self.assertEqual(self.client.get('/city/current').json(), self.start)
        self.assertEqual(city_workspaces.ACTIVE_CITY.get(), 'bristol')

    def test_bristol_prefixed_route_reuses_existing_bytes_and_history(self):
        versions = city.CITY_DIR / 'versions'
        versions.mkdir()
        historical = versions / f"{self.start['revision']}.gugis.json"
        historical.write_bytes(self.bristol_bytes)
        self.assertEqual(self.get('bristol'), self.start)
        response = self.client.get('/cities/bristol/city/versions')
        self.assertEqual(response.json()['versions'][0]['revision'], self.start['revision'])
        self.assertEqual(historical.read_bytes(), self.bristol_bytes)

    def test_unknown_city_and_encoded_path_traversal_are_rejected(self):
        # HTTP clients normalize literal /../ before sending; encoded identifiers
        # exercise server rejection rather than requesting legacy /city itself.
        for city_id in ['paris', 'london%2f..', '%2e%2e', '%2e', 'LONDON']:
            response = self.client.get(f'/cities/{city_id}/city/current')
            self.assertEqual(response.status_code, 404, (city_id, response.text))
        self.assertFalse((city.CITY_DIR.parent / 'cities').exists())
        with self.assertRaises(HTTPException) as rejected:
            city_workspaces.directory(city.CITY_DIR, '..')
        self.assertEqual(rejected.exception.status_code, 404)

    def test_seed_and_baseline_are_city_specific(self):
        seeds = self.seed.parent / 'cities'
        seeds.mkdir()
        london_bytes = archive_bytes(self.document('Real London seed'))
        (seeds / 'london.gugis.json').write_bytes(london_bytes)
        london = self.get('london')
        self.assertEqual(london['document']['name'], 'Real London seed')
        baseline = self.client.get('/cities/london/city/versions/baseline').json()
        self.assertEqual(baseline['document']['name'], 'Real London seed')
        self.assertEqual(self.client.get('/cities/birmingham/city/versions/baseline').status_code, 404)
        self.assertEqual(self.client.get('/city/versions/baseline').json()['document']['name'], 'Original Bristol')

    def test_parallel_async_updates_keep_each_worker_bound_to_its_city(self):
        starts = {city_id: self.get(city_id) for city_id in ['london', 'birmingham']}
        barrier = threading.Barrier(2)
        observed = []
        original = city.apply_update

        def synchronized(edit):
            observed.append(city_workspaces.ACTIVE_CITY.get())
            barrier.wait(timeout=5)
            return original(edit)

        def save(city_id):
            current = starts[city_id]
            return self.client.post(f'/cities/{city_id}/city/current', json={
                'base_revision': current['revision'],
                'document': {**current['document'], 'name': f'{city_id} changed'},
            })

        with patch.object(city, 'apply_update', synchronized), ThreadPoolExecutor(max_workers=2) as workers:
            responses = list(workers.map(save, ['london', 'birmingham']))
        self.assertEqual(sorted(observed), ['birmingham', 'london'])
        self.assertEqual([r.status_code for r in responses], [200, 200], [r.text for r in responses])
        for city_id in starts:
            self.assertEqual(self.get(city_id)['document']['name'], f'{city_id} changed')
            self.assertEqual(len(list((self.workspace_path(city_id) / 'versions').glob('*.json'))), 2)
        self.assertEqual((city.CITY_DIR / 'current.gugis.json').read_bytes(), self.bristol_bytes)
        self.assertFalse((city.CITY_DIR / 'versions').exists())

    def test_equal_bytes_in_different_cities_do_not_share_write_paths(self):
        seeds = self.seed.parent / 'cities'
        seeds.mkdir()
        for city_id in ['london', 'birmingham']:
            (seeds / f'{city_id}.gugis.json').write_bytes(self.seed.read_bytes())
            self.assertEqual(self.get(city_id), self.start)
        changed = self.client.post('/cities/london/city/current', json={
            'base_revision': self.start['revision'],
            'document': {**self.start['document'], 'name': 'London only'},
        })
        self.assertEqual(changed.status_code, 200, changed.text)
        self.assertEqual(self.client.get('/city/current').json(), self.start)
        self.assertEqual(self.get('birmingham'), self.start)
        self.assertEqual(self.get('london')['document']['name'], 'London only')
        self.assertEqual((city.CITY_DIR / 'current.gugis.json').read_bytes(), self.bristol_bytes)
        self.assertFalse((self.workspace_path('birmingham') / 'versions').exists())

    def test_dependency_resets_after_success_conflict_and_server_exception_in_same_task(self):
        async def verify():
            transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
            async with httpx.AsyncClient(transport=transport, base_url='http://gugis.test') as client:
                response = await client.get('/cities/london/city/current')
                self.assertEqual(response.status_code, 200)
                self.assertEqual(city_workspaces.ACTIVE_CITY.get(), 'bristol')
                rejected = await client.post('/cities/london/city/current', json={
                    'base_revision': 'a' * 64,
                    'document': {**response.json()['document'], 'name': 'Rejected'},
                })
                self.assertEqual(rejected.status_code, 409)
                self.assertEqual(city_workspaces.ACTIVE_CITY.get(), 'bristol')
                with patch.object(city, 'read_current', side_effect=RuntimeError('simulated failure')):
                    failed = await client.get('/cities/birmingham/city/current')
                self.assertEqual(failed.status_code, 500)
                self.assertEqual(city_workspaces.ACTIVE_CITY.get(), 'bristol')
                legacy = await client.get('/city/current')
                self.assertEqual(legacy.json(), self.start)
        asyncio.run(verify())

    def test_drafts_commit_and_history_never_cross_city_boundaries(self):
        starts = {city_id: self.get(city_id) for city_id in ['london', 'birmingham']}
        tokens = {}
        for city_id, start in starts.items():
            response = self.client.post(f'/cities/{city_id}/city/draft', json={
                'base_revision': start['revision'], 'base_draft_revision': None,
                'label': f'{city_id} only', 'document': {**start['document'], 'name': city_id},
            })
            self.assertEqual(response.status_code, 200, response.text)
            tokens[city_id] = response.json()['revision']
        cross = self.client.post('/cities/london/city/draft/commit', json={'revision': tokens['birmingham']})
        self.assertEqual(cross.status_code, 409)
        result = self.client.post('/cities/london/city/draft/commit', json={'revision': tokens['london']})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(self.get('london')['document']['name'], 'london')
        self.assertEqual(self.get('birmingham'), starts['birmingham'])
        self.assertIsNotNone(self.client.get('/cities/birmingham/city/draft').json()['draft'])
        self.assertIsNone(self.client.get('/cities/london/city/draft').json()['draft'])
        self.assertEqual(self.client.get('/cities/birmingham/city/versions').json()['versions'], [])
        self.assertEqual(self.client.get('/cities/birmingham/city/versions/' + result.json()['revision']).status_code, 404)
        self.assertEqual((city.CITY_DIR / 'current.gugis.json').read_bytes(), self.bristol_bytes)

    def test_export_is_bound_to_request_and_has_matching_city_filename(self):
        for city_id in ['london', 'birmingham']:
            result = self.get(city_id)
            response = self.client.get(f'/cities/{city_id}/city/export')
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(city.revision(response.content), result['revision'])
            self.assertIn(city_id + '-city.gugis.json', response.headers['Content-Disposition'])
        self.assertEqual(self.client.get('/city/export').content, self.bristol_bytes)

    def test_dem_import_gets_selected_workspace_bounds(self):
        from app.services import terrain_builder
        demo = terrain_builder.demo_terrain()
        with patch.object(terrain_builder, 'import_dem', return_value=demo) as importer:
            response = self.client.post('/cities/london/city/terrain/import?filename=london.tif', content=b'test')
        self.assertEqual(response.status_code, 200, response.text)
        kwargs = importer.call_args.kwargs
        self.assertEqual(kwargs['clip_bounds'], city_workspaces.CITY_DEFAULTS['london']['query_bbox_wgs84'])
        self.assertEqual(kwargs['center'], [-0.1305, 51.502])
        self.assertIn('伦敦', kwargs['coverage_label'])

    def test_catalog_metadata_reflects_current_project_and_invalid_json(self):
        self.get('london')
        path = self.workspace_path('london') / 'current.gugis.json'
        payload = json.loads(path.read_bytes())
        payload['metadata'].update(coverage_bbox_wgs84='[-0.14,51.49,-0.12,51.51]',
                                   data_bbox_wgs84='[-0.15,51.48,-0.11,51.52]', source='OSM', license='ODbL 1.0')
        path.write_text(json.dumps(payload), encoding='utf-8')
        catalog = {entry['id']: entry for entry in self.client.get('/cities').json()['cities']}
        self.assertEqual(catalog['london']['query_bbox_wgs84'], [-0.14, 51.49, -0.12, 51.51])
        self.assertEqual(catalog['london']['actual_data_bbox_wgs84'], [-0.15, 51.48, -0.11, 51.52])
        self.assertEqual(catalog['london']['source'], 'OSM')
        self.assertEqual(catalog['london']['license'], 'ODbL 1.0')
        path.write_bytes(b'{corrupt city')
        catalog = {entry['id']: entry for entry in self.client.get('/cities').json()['cities']}
        self.assertEqual(catalog['london']['status'], 'invalid')
        self.assertEqual(path.read_bytes(), b'{corrupt city')


if __name__ == '__main__':
    unittest.main()
