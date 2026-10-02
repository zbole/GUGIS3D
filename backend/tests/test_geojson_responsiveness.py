import asyncio
import copy
import json
import threading
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import httpx
from fastapi.responses import JSONResponse

from app.main import app
from app.routers import city
from app.services.building_generator import document_bytes
from app.studio_models import BuildingDocument


def feature():
    return {
        'type': 'Feature',
        'properties': {'name': '响应性测试建筑', 'height': 12},
        'geometry': {'type': 'Polygon', 'coordinates': [[
            [-2.6, 51.45], [-2.5998, 51.45], [-2.5998, 51.45015],
            [-2.6, 51.45015], [-2.6, 51.45],
        ]]},
    }


class GeoJSONResponsivenessTests(unittest.IsolatedAsyncioTestCase):
    async def post(self, client, features):
        return await client.post('/city/geojson', content=json.dumps({
            'type': 'FeatureCollection', 'name': '导入街区', 'features': features,
        }), headers={'Content-Type': 'application/json'})

    async def test_health_runs_during_conversion_and_response_encoding_is_off_loop(self):
        loop_thread = threading.get_ident()
        started, release, finished = threading.Event(), threading.Event(), threading.Event()
        conversion_threads, encoding_threads = [], []
        original_footprint, original_dumps = city.footprint_document, json.dumps

        def gated_footprint(*args, **kwargs):
            conversion_threads.append(threading.get_ident())
            try:
                document = original_footprint(*args, **kwargs)
                started.set()
                # A synchronous regression must fail without deadlocking the
                # test loop. The timeout is only a deadlock safeguard, not a
                # performance threshold; event ordering is what we assert.
                if threading.get_ident() != loop_thread and not release.wait(10):
                    raise AssertionError('Conversion was never released')
                return document
            finally:
                finished.set()

        def record_encoding(value, *args, **kwargs):
            if isinstance(value, dict) and set(value) == {'documents'}:
                encoding_threads.append(threading.get_ident())
            return original_dumps(value, *args, **kwargs)

        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            with patch.object(city, 'footprint_document', gated_footprint), patch.object(city.json, 'dumps', record_encoding):
                importing = asyncio.create_task(self.post(client, [feature()]))
                try:
                    self.assertTrue(await asyncio.to_thread(started.wait, 10))
                    health = await client.get('/health')
                    self.assertEqual(health.status_code, 200)
                    self.assertEqual(health.json()['status'], 'ok')
                    self.assertFalse(finished.is_set(), 'Conversion finished before health could run')
                    self.assertFalse(importing.done())
                finally:
                    release.set()
                    response = await importing
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(response.json()['documents']), 1)
        self.assertEqual(len(conversion_threads), 1)
        self.assertEqual(len(encoding_threads), 1)
        self.assertTrue(all(thread != loop_thread for thread in conversion_threads + encoding_threads))

    async def test_documents_sources_and_encoded_json_match_previous_response(self):
        items = [feature(), feature()]
        items[1]['properties'] = None
        original = copy.deepcopy(items)
        expected = [json.loads(document_bytes(city.footprint_document(
            item['geometry']['coordinates'][0], name, height,
            '用户导入 GeoJSON / WGS84', reason,
        ))) for item, name, height, reason in (
            (items[0], '响应性测试建筑', 12, 'GeoJSON height 字段（未核验）'),
            (items[1], '导入街区 2', 9.6, '缺少高度：假设 9.6 m'),
        )]
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            response = await self.post(client, items)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers['content-type'], 'application/json')
        self.assertEqual(response.json(), {'documents': expected})
        self.assertEqual(response.content, JSONResponse({'documents': expected}).body)
        for document in response.json()['documents']:
            BuildingDocument.model_validate(document)
        self.assertEqual(items, original)

    async def test_success_and_whole_batch_failure_never_write_saved_state(self):
        invalid = feature()
        invalid['geometry']['type'] = 'MultiPolygon'
        with TemporaryDirectory() as folder, patch.object(city, 'CITY_DIR', Path(folder)):
            root = Path(folder)
            (root / 'versions').mkdir()
            for name in ('current.gugis.json', 'pending-draft.json', 'versions/existing.gugis.json'):
                (root / name).write_bytes(b'Existing state must not be read or replaced by an import')
            before = {str(path.relative_to(root)): path.read_bytes() for path in root.rglob('*') if path.is_file()}
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
                success = await self.post(client, [feature()])
                failure = await self.post(client, [feature(), invalid])
            self.assertEqual(success.status_code, 200, success.text)
            self.assertEqual(failure.status_code, 422, failure.text)
            self.assertEqual(failure.json(), {'detail': '导入未应用。要素 2：仅支持单 Polygon；请先拆分 MultiPolygon'})
            after = {str(path.relative_to(root)): path.read_bytes() for path in root.rglob('*') if path.is_file()}
            self.assertEqual(after, before)


if __name__ == '__main__':
    unittest.main()
