import asyncio
import hashlib
import threading
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import httpx

from app.main import app
from app.routers import studio
from app.services.building_generator import document_bytes, generate_building, statistics
from app.studio_models import BuildingParameters


class StudioResponsivenessTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.document = generate_building(BuildingParameters(name='合成单栋检查', floors=2, units=1))
        self.content = document_bytes(self.document)

    async def gated_request(self, target, name, original, url):
        loop_thread = threading.get_ident()
        started, release, finished = threading.Event(), threading.Event(), threading.Event()
        workers = []

        def gated(*args, **kwargs):
            workers.append(threading.get_ident())
            started.set()
            try:
                if threading.get_ident() != loop_thread and not release.wait(10):
                    raise AssertionError('Worker was never released')
                return original(*args, **kwargs)
            finally:
                finished.set()

        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            with patch.object(target, name, side_effect=gated):
                task = asyncio.create_task(client.post(url, content=self.content))
                try:
                    self.assertTrue(await asyncio.to_thread(started.wait, 10))
                    self.assertEqual((await client.get('/health')).status_code, 200)
                    self.assertFalse(finished.is_set(), 'Health must finish before the gated model work')
                    self.assertFalse(task.done())
                finally:
                    release.set()
                    response = await task
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(workers), 1)
        self.assertNotEqual(workers[0], loop_thread)
        return response

    async def test_single_building_validation_and_encoding_leave_health_responsive(self):
        response = await self.gated_request(studio, 'validation_response', studio.validation_response, '/studio/validate')
        self.assertEqual(response.json(), {'document': self.document.model_dump(mode='json', exclude_none=True),
                                           'statistics': statistics(self.document)})
        self.assertEqual(response.headers['content-type'], 'application/json')
        self.assertEqual(document_bytes(self.document), self.content)

    async def test_both_single_building_entries_parse_off_the_event_loop(self):
        with TemporaryDirectory() as temp, patch.object(studio, 'EXPORT_DIR', Path(temp)):
            for url in ['/studio/validate', '/studio/save']:
                with self.subTest(entry=url):
                    response = await self.gated_request(studio.BuildingDocument, 'model_validate_json',
                                                        studio.BuildingDocument.model_validate_json, url)
                    if url.endswith('validate'):
                        self.assertEqual(response.json()['document'], self.document.model_dump(mode='json', exclude_none=True))
                    else:
                        self.assertEqual((Path(temp) / response.json()['filename']).read_bytes(), self.content)

    async def test_atomic_single_building_save_leaves_health_responsive_and_keeps_receipt(self):
        with TemporaryDirectory() as temp, patch.object(studio, 'EXPORT_DIR', Path(temp)):
            response = await self.gated_request(studio, 'save_document', studio.save_document, '/studio/save')
            file_id = hashlib.sha256(self.content).hexdigest()
            self.assertEqual(response.json(), {'id': file_id, 'filename': f'{file_id}.gugis.json',
                                              'directory': temp, 'bytes': len(self.content),
                                              'download_path': f'/studio/files/{file_id}'})
            self.assertEqual((Path(temp) / f'{file_id}.gugis.json').read_bytes(), self.content)
            self.assertEqual(len(list(Path(temp).iterdir())), 1)

    async def test_invalid_single_building_never_reaches_encoding_or_file_publication(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            with patch.object(studio, 'validation_response') as encoded, patch.object(studio, 'save_document') as publish:
                for url in ['/studio/validate', '/studio/save']:
                    for content in [b'null', b'{broken', b' ' * (8 * 1024 * 1024 + 1)]:
                        response = await client.post(url, content=content)
                        self.assertEqual(response.status_code, 413 if len(content) > 8 * 1024 * 1024 else 422)
                encoded.assert_not_called()
                publish.assert_not_called()


if __name__ == '__main__':
    unittest.main()
