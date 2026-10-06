import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from app.main import app
from app.routers import city
from app.services import public_city_datasets as datasets
from app.services.workspace_catalog import CITY_DEFAULTS


class PublicCityDatasetTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.formal = self.root / '.local/city'
        self.formal.mkdir(parents=True)
        self.private = self.formal / 'current.gugis.json'
        self.private.write_bytes(b'private current project: do not download')
        self.helper = patch.object(city, 'CITY_DIR', self.formal)
        self.helper.start()
        self.addCleanup(self.helper.stop)
        self.client = TestClient(app)

    def test_all_cities_serve_exact_public_seeds_and_no_private_formal_files(self):
        report = json.loads(datasets.MANIFEST.read_bytes())
        self.assertEqual({s['city_id'] for s in report['sources']}, set(CITY_DEFAULTS))
        self.assertEqual(sum(s['building_count'] for s in report['sources']), 113115)
        for source in report['sources']:
            city_id = source['city_id']
            metadata = self.client.get(f'/cities/{city_id}/public-dataset')
            self.assertEqual(metadata.status_code, 200)
            self.assertEqual(metadata.json(), {'status': 'available', 'source': source})
            result = self.client.get(f'/cities/{city_id}/public-dataset.gugis.json')
            self.assertEqual(result.status_code, 200)
            self.assertEqual(len(result.content), source['bytes'])
            self.assertEqual(hashlib.sha256(result.content).hexdigest(), source['sha256'])
            self.assertEqual(result.headers['x-gugis-source-sha256'], source['sha256'])
            self.assertEqual(result.headers['cache-control'], 'no-store')
            self.assertIn(f'{city_id}-public-seed.gugis.json', result.headers['content-disposition'])
            self.assertNotIn(b'private current project', result.content)
        self.assertEqual(self.private.read_bytes(), b'private current project: do not download')
        self.assertEqual(list(self.formal.rglob('*')), [self.private])
        self.assertFalse((self.root / '.local/cities').exists())

    def test_changed_manifest_seed_or_missing_source_never_returns_download(self):
        bad_manifest = self.root / 'bad.json'
        bad_manifest.write_bytes(b'{}')
        with patch.object(datasets, 'MANIFEST', bad_manifest):
            for suffix in ['public-dataset', 'public-dataset.gugis.json']:
                result = self.client.get(f'/cities/bath/{suffix}')
                self.assertEqual(result.status_code, 503)
                self.assertNotIn('content-disposition', result.headers)
        # Both a missing source and a same-sized altered source refuse publication.
        source = next(s for s in json.loads(datasets.MANIFEST.read_bytes())['sources'] if s['city_id'] == 'bath')
        path = self.root / 'backend/data/cities/bath.gugis.json'
        with patch.object(datasets, 'ROOT', self.root):
            self.assertEqual(self.client.get('/cities/bath/public-dataset').status_code, 503)
            path.parent.mkdir(parents=True)
            path.write_bytes(b'x' * source['bytes'])
            self.assertEqual(self.client.get('/cities/bath/public-dataset.gugis.json').status_code, 503)
        self.assertEqual(self.private.read_bytes(), b'private current project: do not download')

    def test_download_bound_and_unknown_city_refuse_without_formal_initialization(self):
        with patch.object(datasets, 'MAX_BYTES', 100):
            self.assertEqual(self.client.get('/cities/bath/public-dataset.gugis.json').status_code, 503)
        self.assertEqual(self.client.get('/cities/unknown/public-dataset').status_code, 404)
        self.assertEqual(self.client.get('/cities/unknown/public-dataset.gugis.json').status_code, 404)
        self.assertFalse((self.root / '.local/cities').exists())

    def test_public_height_counts_cover_each_import_without_relabelling_preserved_models(self):
        report = json.loads(datasets.MANIFEST.read_bytes())
        for source in report['sources']:
            if source['city_id'] in ['bristol', 'london', 'birmingham']:
                self.assertIsNone(source['height_counts'])
                self.assertIn('保留', source['height_policy'])
            else:
                self.assertEqual(sum(source['height_counts'].values()), source['building_count'])
            self.assertIn('非全城', source['coverage_label'])
            self.assertFalse(source['terrain_included'])
