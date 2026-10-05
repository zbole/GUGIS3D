import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from app.main import app
from app.routers import city
from app.services import public_terrain
from app.environment_models import Terrain

try:
    import numpy as np
    import rasterio
    from rasterio.windows import Window
except ImportError:
    rasterio = None


class PublicTerrainTests(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        helper = patch.object(city, 'CITY_DIR', self.root / '.local/city')
        helper.start()
        self.addCleanup(helper.stop)
        self.client = TestClient(app)

    def test_source_preview_and_raster_are_read_only_and_city_bound(self):
        info = self.client.get('/cities/bristol/city/terrain/public-source')
        self.assertEqual(info.status_code, 200, info.text)
        source = info.json()['source']
        self.assertEqual(source['valid_pixels'], 6145952)
        preview = self.client.get('/cities/bristol/city/terrain/public-preview')
        self.assertEqual(preview.status_code, 200, preview.text[:300])
        model = Terrain.model_validate(preview.json()['terrain'])
        self.assertFalse(model.demonstration)
        self.assertEqual(model.vertical_datum, 'ODN')
        self.assertEqual(len(model.points), 15480)
        self.assertEqual({p.kind for p in model.patches}, {'ruled-strip', 'triangle-strip'})
        raster = self.client.get('/cities/bristol/city/terrain/public-raster.tif')
        self.assertEqual(raster.status_code, 200)
        self.assertEqual(hashlib.sha256(raster.content).hexdigest(), source['raster_sha256'])
        self.assertEqual(raster.headers['X-GUGIS-Source-SHA256'], source['raster_sha256'])
        self.assertIn('bristol-ea-dtm-1m.tif', raster.headers['Content-Disposition'])
        for city_id in ['edinburgh', 'cardiff']:
            self.assertEqual(self.client.get(f'/cities/{city_id}/city/terrain/public-source').json(), {'status': 'pending', 'source': None})
            self.assertEqual(self.client.get(f'/cities/{city_id}/city/terrain/public-preview').status_code, 404)
            self.assertEqual(self.client.get(f'/cities/{city_id}/city/terrain/public-raster.tif').status_code, 404)
        self.assertEqual(self.client.get('/cities/unknown/city/terrain/public-source').status_code, 404)
        self.assertFalse((self.root / '.local').exists(), 'Read-only data candidates never initialize formal workspaces')

    def test_new_city_candidates_use_their_own_source_model_and_download_name(self):
        for city_id, points in [('london', 16632), ('birmingham', 18620), ('manchester', 13806), ('york', 16074), ('bath', 12915)]:
            source = self.client.get(f'/cities/{city_id}/city/terrain/public-source').json()['source']
            self.assertEqual(source['city_id'], city_id)
            self.assertEqual(source['nodata_pixels'], 0)
            self.assertEqual(source['sample_audit']['hits'], 4096)
            body = self.client.get(f'/cities/{city_id}/city/terrain/public-preview')
            self.assertEqual(body.status_code, 200, body.text[:200])
            terrain = Terrain.model_validate(body.json()['terrain'])
            self.assertFalse(terrain.demonstration)
            self.assertEqual(terrain.vertical_datum, 'ODN')
            self.assertEqual(len(terrain.points), points)
            self.assertEqual({p.kind for p in terrain.patches}, {'ruled-strip', 'triangle-strip'})
            raster = self.client.get(f'/cities/{city_id}/city/terrain/public-raster.tif')
            self.assertEqual(raster.status_code, 200)
            self.assertEqual(hashlib.sha256(raster.content).hexdigest(), source['raster_sha256'])
            self.assertIn(f'{city_id}-ea-dtm-1m.tif', raster.headers['Content-Disposition'])
            self.assertNotIn('bristol', raster.headers['Content-Disposition'])
        self.assertFalse((self.root / '.local').exists())

    @unittest.skipIf(rasterio is None, 'rasterio required for full new-city source audit')
    def test_new_city_pixels_fixtures_and_coarse_outliers_are_exactly_disclosed(self):
        for city_id in ['london', 'birmingham', 'manchester', 'york', 'bath']:
            info = public_terrain.source_info(city_id)['source']
            folder = public_terrain.ROOT / f'frontend/public/research/{city_id}-terrain'
            audit_bytes = (folder / 'preview-audit.json').read_bytes()
            self.assertEqual(hashlib.sha256(audit_bytes).hexdigest(), info['sample_audit_sha256'])
            audit = json.loads(audit_bytes)
            self.assertEqual(audit['misses'], 0)
            self.assertEqual(audit['controls_checked'], info['preview_points'])
            self.assertEqual(audit['controls_hits'], info['preview_points'])
            self.assertLess(audit['max_control_query_error_m'], 1e-10)
            self.assertGreater(audit['max_absolute_m'], {'london': 5, 'birmingham': 14, 'manchester': 5, 'york': 4, 'bath': 4}[city_id])
            digest = hashlib.sha256()
            with rasterio.open(public_terrain.ROOT / f'backend/data/terrain/{city_id}-ea-dtm-1m.tif') as ds:
                self.assertEqual(ds.crs.to_epsg(), 27700)
                self.assertEqual(ds.res, (1., 1.))
                self.assertEqual(list(ds.bounds), info['raster_bbox_bng'])
                for top in range(0, ds.height, 256):
                    for left in range(0, ds.width, 256):
                        w = Window(left, top, min(256, ds.width-left), min(256, ds.height-top))
                        digest.update(ds.read(1, window=w).astype('<f4').tobytes())
                values = ds.read(1)
                fixture_bytes = (folder / 'pixel-queries.json').read_bytes()
                self.assertEqual(hashlib.sha256(fixture_bytes).hexdigest(), audit['fixture_sha256'])
                fixtures = json.loads(fixture_bytes)
                self.assertEqual(len(fixtures), 4096)
                for f in fixtures:
                    self.assertEqual(float(values[f['row'], f['column']]), f['source_height_m'])
            self.assertEqual(digest.hexdigest(), info['raster_pixel_block_sha256'])

    def test_changed_manifest_or_actual_model_bytes_refuse_preview_without_touching_formal_data(self):
        manifest = self.root / 'manifest.json'
        manifest.write_bytes(b'{}')
        with patch.object(public_terrain, 'MANIFEST_PATH', manifest):
            self.assertEqual(self.client.get('/cities/bristol/city/terrain/public-source').status_code, 503)
            self.assertEqual(self.client.get('/cities/bristol/city/terrain/public-preview').status_code, 503)
        package = self.root / 'backend/data/terrain'
        package.mkdir(parents=True)
        (package / public_terrain.FILES['model'][0]).write_bytes(b'{"demonstration":false}')
        # The earlier raster digest also fails; no stale manifest counts are returned.
        (package / public_terrain.FILES['raster'][0]).write_bytes(b'not a GeoTIFF')
        with patch.object(public_terrain, 'ROOT', self.root):
            self.assertEqual(self.client.get('/cities/bristol/city/terrain/public-source').status_code, 503)
            self.assertEqual(self.client.get('/cities/bristol/city/terrain/public-preview').status_code, 503)
        self.assertFalse((self.root / '.local').exists())

    @unittest.skipIf(rasterio is None, 'rasterio is required for pixel verification')
    def test_public_compressed_raster_has_exact_grid_nodata_and_pixel_digest(self):
        info = public_terrain.source_info('bristol')['source']
        path = public_terrain.ROOT / 'backend/data/terrain/bristol-ea-dtm-1m.tif'
        digest = hashlib.sha256()
        with rasterio.open(path) as ds:
            self.assertEqual(ds.crs.to_epsg(), 27700)
            self.assertEqual(ds.res, (1., 1.))
            self.assertEqual([ds.width, ds.height], [2384, 2578])
            self.assertEqual(list(ds.bounds), info['raster_bbox_bng'])
            self.assertEqual(ds.dtypes, ('float32',))
            valid = 0
            for top in range(0, ds.height, 256):
                for left in range(0, ds.width, 256):
                    window = Window(left, top, min(256, ds.width-left), min(256, ds.height-top))
                    block = ds.read(1, window=window)
                    valid += int(np.count_nonzero(~np.ma.getmaskarray(ds.read(1, window=window, masked=True)) & np.isfinite(block)))
                    digest.update(block.astype('<f4').tobytes())
            self.assertEqual(valid, info['valid_pixels'])
        self.assertEqual(digest.hexdigest(), info['raster_pixel_block_sha256'])
        audit_path = public_terrain.ROOT / 'shared/bristol-terrain-preview-audit.json'
        self.assertEqual(hashlib.sha256(audit_path.read_bytes()).hexdigest(), info['sample_audit_sha256'])
        audit = json.loads(audit_path.read_bytes())
        self.assertEqual(audit['hits'], 4096)
        self.assertEqual(audit['controls_checked'], 15480)
        self.assertLess(audit['max_control_query_error_m'], 1e-10)
        self.assertGreater(audit['max_absolute_m'], 6, 'Do not hide the coarse preview outliers')


if __name__ == '__main__':
    unittest.main()
