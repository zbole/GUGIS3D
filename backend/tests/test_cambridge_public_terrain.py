"""Cambridge original pixels, native preview and all historical provenance gates."""
import hashlib,json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
import numpy as np
import rasterio
from rasterio.windows import Window
from app.main import app
from app.routers import city
from app.services import public_terrain as public


class CambridgePublicTerrainTests(unittest.TestCase):
    def test_current_catalogue_preserves_seven_source_records_and_both_ancestors(self):
        previous=(public.ROOT/'shared/public-terrain-sources-v2.json').read_bytes()
        report=json.loads(public.MANIFEST_PATH.read_bytes())
        self.assertEqual(report['schema'],'gugis-public-terrain-sources-v3')
        self.assertEqual(report['parent_manifest'],{'filename':'public-terrain-sources-v2.json','sha256':hashlib.sha256(previous).hexdigest()})
        self.assertEqual(report['sources'][:-1],json.loads(previous)['sources'])
        self.assertEqual(report['sources'][-1]['city_id'],'cambridge')
        self.assertEqual(sum(s['valid_pixels'] for s in report['sources']),54790216)
        client=TestClient(app)
        with TemporaryDirectory() as temporary,patch.object(public,'ROOT',Path(temporary)),patch.object(public,'_candidate_bytes',return_value=b'isolated geometry gate'):
            folder=Path(temporary)/'shared';folder.mkdir()
            originals={name:(Path(__file__).resolve().parents[2]/'shared'/name).read_bytes() for name in public.HISTORICAL_MANIFESTS}
            for name,data in originals.items():(folder/name).write_bytes(data)
            self.assertEqual(client.get('/cities/cambridge/city/terrain/public-source').status_code,200)
            for name,data in originals.items():
                (folder/name).write_bytes(b'{}')
                self.assertEqual(client.get('/cities/cambridge/city/terrain/public-source').status_code,503,name)
                (folder/name).write_bytes(data)
                self.assertEqual(client.get('/cities/cambridge/city/terrain/public-source').status_code,200)

    def test_unique_original_pixel_queries_and_lossless_block_digest(self):
        info=public.source_info('cambridge')['source'];folder=public.ROOT/'frontend/public/research/cambridge-terrain'
        b=(folder/'preview-audit.json').read_bytes();audit=json.loads(b)
        self.assertEqual(hashlib.sha256(b).hexdigest(),info['sample_audit_sha256'])
        self.assertEqual(audit['controls_hits'],24070);self.assertEqual(audit['hits'],4096)
        self.assertLess(audit['max_control_query_error_m'],1e-9)
        self.assertGreater(audit['max_absolute_m'],2.5)
        fixtures=json.loads((folder/'pixel-queries.json').read_bytes())
        self.assertEqual(len({(f['row'],f['column']) for f in fixtures}),4096)
        digest=hashlib.sha256()
        with rasterio.open(public.ROOT/'backend/data/terrain/cambridge-ea-dtm-1m.tif') as ds:
            self.assertEqual(ds.crs.to_epsg(),27700);self.assertEqual(ds.res,(1.,1.));self.assertEqual(ds.dtypes,('float32',))
            self.assertEqual(list(ds.bounds),[543967,256618,546864,259927])
            self.assertEqual(ds.scales,(1.,));self.assertEqual(ds.offsets,(0.,))
            for top in range(0,ds.height,256):
                for left in range(0,ds.width,256):
                    a=ds.read(1,window=Window(left,top,min(256,ds.width-left),min(256,ds.height-top)))
                    digest.update(a.astype('<f4').tobytes())
            a=ds.read(1);self.assertEqual(int(np.isfinite(a).sum()),9586173)
            for f in fixtures:self.assertEqual(float(a[f['row'],f['column']]),f['source_height_m'])
        self.assertEqual(digest.hexdigest(),info['raster_pixel_block_sha256'])

    def test_readonly_exact_native_and_raster_bytes_and_bad_candidate_refusal(self):
        with TemporaryDirectory() as temporary,patch.object(city,'CITY_DIR',Path(temporary)/'.local/city'):
            client=TestClient(app);source=client.get('/cities/cambridge/city/terrain/public-source').json()['source']
            for route,kind in [('public-preview','model'),('public-raster.tif','raster')]:
                r=client.get('/cities/cambridge/city/terrain/'+route);self.assertEqual(r.status_code,200)
                b=(public.ROOT/'backend/data/terrain'/public.CANDIDATES['cambridge'][kind][0]).read_bytes()
                self.assertEqual(r.content,b if kind=='raster' else b'{"terrain":'+b+b'}')
                self.assertEqual(hashlib.sha256(b).hexdigest(),source[kind+'_sha256'])
            with patch.object(public,'_candidate_bytes',side_effect=ValueError('altered source')):
                self.assertEqual(client.get('/cities/cambridge/city/terrain/public-preview').status_code,503)
            self.assertFalse((Path(temporary)/'.local').exists())
