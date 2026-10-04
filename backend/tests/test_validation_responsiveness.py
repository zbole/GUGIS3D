import asyncio
import json
import threading
import unittest
from contextlib import ExitStack
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import httpx

from app.main import app
from app.routers import city
from app.city_models import CityDocument
from app.environment_models import Terrain, TerrainPatch
from app.services import terrain_builder
from app.services import terrain_multipatch
from app.services import urban_detail
from app.services.city_generator import footprint_document
from app.services.building_generator import document_bytes


def small_terrain():
    return Terrain(name='合成响应性检查', longitude=-2.603, latitude=51.454,
                   vertical_datum='unknown', reference_height=0, demonstration=True,
                   source={'来源': 'test-only'}, points=[[0, 0, 0], [10, 0, 1], [0, 10, 2], [10, 10, 3]],
                   patches=[TerrainPatch(id='strip', kind='ruled-strip', left=[0, 1], right=[2, 3])])


class ValidationResponsivenessTests(unittest.IsolatedAsyncioTestCase):
    async def assert_responsive(self, operation, original, request, expected):
        loop_thread = threading.get_ident()
        started, release, finished = threading.Event(), threading.Event(), threading.Event()
        workers = []

        def gated(*args, **kwargs):
            workers.append(threading.get_ident())
            started.set()
            try:
                # Event ordering, not an arbitrary latency threshold. A regression
                # on the event loop completes immediately and fails the assertions.
                if threading.get_ident() != loop_thread and not release.wait(10):
                    raise AssertionError('Worker was never released')
                return original(*args, **kwargs)
            finally:
                finished.set()

        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            with patch.object(city, operation, gated):
                task = asyncio.create_task(request(client))
                try:
                    self.assertTrue(await asyncio.to_thread(started.wait, 10))
                    health = await client.get('/health')
                    self.assertEqual(health.status_code, 200)
                    self.assertEqual(health.json()['status'], 'ok')
                    self.assertFalse(finished.is_set(), 'Other API requests must finish before the gated work')
                    self.assertFalse(task.done())
                finally:
                    release.set()
                    response = await task
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers['content-type'], 'application/json')
        self.assertEqual(response.json(), expected)
        self.assertEqual(len(workers), 1)
        self.assertNotEqual(workers[0], loop_thread)

    async def test_city_pack_and_response_encoding_do_not_block_health(self):
        document = CityDocument(format='gugis-city', version='1.0', coordinate_system='ENU_METERS_WGS84',
                                name='合成城市检查', assets={}, instances=[], roads=[], metadata={})
        packed, stats = city.pack_city(document)
        expected = {'document': json.loads(packed), 'storage': stats}
        await self.assert_responsive('validate_city_response', city.validate_city_response,
                                     lambda client: client.post('/city/validate', content=document.model_dump_json()), expected)

    async def test_terrain_response_encoding_does_not_block_health_for_each_entry(self):
        terrain = small_terrain()
        expected = {'terrain': terrain.model_dump(mode='json', exclude_none=True)}
        workspace = {'name': '测试街区', 'center_wgs84': [-2.603, 51.454],
                     'query_bbox_wgs84': [-2.61, 51.45, -2.60, 51.46], 'coverage_label': 'test-only'}
        requests = [
            lambda client: client.get('/city/terrain/demo'),
            lambda client: client.post('/city/terrain/upgrade', content=terrain.model_dump_json()),
            lambda client: client.post('/city/terrain/import?filename=test-only.asc', content=b'test-only'),
        ]
        for index, request in enumerate(requests):
            with self.subTest(entry=index), ExitStack() as stack:
                stack.enter_context(patch.object(city.city_workspaces, 'workspace_entry', return_value=workspace))
                stack.enter_context(patch.object(terrain_builder, 'demo_terrain', return_value=terrain))
                stack.enter_context(patch.object(terrain_builder, 'import_dem', return_value=terrain))
                await self.assert_responsive('terrain_response', city.terrain_response, request, expected)

    async def test_invalid_input_remains_rejected_without_creating_encoded_response(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            with patch.object(city, 'validate_city_response') as packed, patch.object(city, 'terrain_response') as encoded:
                self.assertEqual((await client.post('/city/validate', content=b'null')).status_code, 422)
                self.assertEqual((await client.post('/city/terrain/upgrade', content=b'{}')).status_code, 422)
                packed.assert_not_called()
                encoded.assert_not_called()

    async def test_benchmark_snapshot_read_and_export_leave_health_responsive(self):
        terrain = small_terrain()
        document = CityDocument(format='gugis-city', version='1.0', coordinate_system='ENU_METERS_WGS84',
                                name='合成下载检查', assets={}, instances=[], roads=[], metadata={},
                                environment={'terrain': terrain, 'features': [], 'feature_assets': {}})
        content = b'synthetic-benchmark-snapshot'
        digest = city.revision(content)
        loop_thread = threading.get_ident()
        for stage in ['read', 'export']:
            with self.subTest(stage=stage), TemporaryDirectory() as temp, ExitStack() as stack:
                started, release, finished = threading.Event(), threading.Event(), threading.Event()
                workers, active_cities = [], []

                def gate():
                    workers.append(threading.get_ident())
                    active_cities.append(city.city_workspaces.ACTIVE_CITY.get())
                    started.set()
                    if threading.get_ident() != loop_thread and not release.wait(10):
                        raise AssertionError('Worker was never released')
                    finished.set()

                def read():
                    if stage == 'read': gate()
                    return content, document

                def export(value, destination, *, city_revision):
                    if stage == 'export': gate()
                    self.assertEqual(value, terrain)
                    self.assertEqual(city_revision, digest)
                    Path(destination).write_bytes(b'test-only-package')

                stack.enter_context(patch.object(city, 'read_current', read))
                stack.enter_context(patch.object(city, 'benchmark_directory', return_value=Path(temp)))
                stack.enter_context(patch.object(terrain_multipatch, 'export_multipatch', export))
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
                    task = asyncio.create_task(client.get('/cities/london/city/terrain/benchmark.zip', params={'snapshot': digest}))
                    try:
                        self.assertTrue(await asyncio.to_thread(started.wait, 10))
                        self.assertEqual((await client.get('/health')).status_code, 200)
                        self.assertFalse(finished.is_set(), 'Health must respond before gated snapshot work completes')
                        self.assertFalse(task.done())
                    finally:
                        release.set()
                        response = await task
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.content, b'test-only-package')
                self.assertIn('london-terrain-MultiPatch.zip', response.headers['content-disposition'])
                self.assertEqual(active_cities, ['london'])
                self.assertEqual(len(workers), 1)
                self.assertNotEqual(workers[0], loop_thread)
                self.assertEqual([path.name for path in Path(temp).iterdir()], [f'terrain-{digest[:16]}.zip'])

    async def test_building_refinement_and_encoding_do_not_block_health(self):
        document = footprint_document([[-2.6, 51.45], [-2.5997, 51.45], [-2.5997, 51.4502],
                                       [-2.6, 51.4502], [-2.6, 51.45]],
                                      'Synthetic response check', 12, 'test-only', 'synthetic height')
        before = document_bytes(document)
        expected = {'document': json.loads(document_bytes(urban_detail.refine_document(document)))}
        await self.assert_responsive('refine_document_response', city.refine_document_response,
                                     lambda client: client.post('/cities/london/city/refine', content=before), expected)
        self.assertEqual(document_bytes(document), before)

    async def test_refinement_value_errors_remain_422_without_saving_or_encoding_invalid_data(self):
        document = footprint_document([[-2.6, 51.45], [-2.5997, 51.45], [-2.5997, 51.4502],
                                       [-2.6, 51.4502], [-2.6, 51.45]],
                                      'Synthetic rejection check', 12, 'test-only', 'synthetic height')
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            with patch.object(urban_detail, 'refine_document', side_effect=ValueError('synthetic refusal')):
                response = await client.post('/city/refine', content=document_bytes(document))
                self.assertEqual(response.status_code, 422)
                self.assertEqual(response.json(), {'detail': 'synthetic refusal'})
            with patch.object(city, 'refine_document_response') as encoded:
                self.assertEqual((await client.post('/city/refine', content=b'null')).status_code, 422)
                encoded.assert_not_called()


if __name__ == '__main__':
    unittest.main()
