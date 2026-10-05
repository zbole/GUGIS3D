"""Independent original-pixel checks, positive ODN heights and read-only endpoints."""
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


class NottinghamPublicTerrainTests(unittest.TestCase):
    def test_v7_preserves_all_eleven_source_records_and_pinned_ancestors(self):
        previous=(public.ROOT/'shared/public-terrain-sources-v6.json').read_bytes()
        report=json.loads((public.ROOT/'shared/public-terrain-sources-v7.json').read_bytes())
        self.assertEqual(report['schema'],'gugis-public-terrain-sources-v7')
        self.assertEqual(report['parent_manifest'],{'filename':'public-terrain-sources-v6.json','sha256':hashlib.sha256(previous).hexdigest()})
        self.assertEqual(report['sources'][:-1],json.loads(previous)['sources'])
        self.assertEqual(report['sources'][-1]['city_id'],'nottingham')
        self.assertEqual(sum(s['valid_pixels'] for s in report['sources']),89638942)
        for name,digest in public.HISTORICAL_MANIFESTS.items():
            self.assertEqual(hashlib.sha256((public.ROOT/'shared'/name).read_bytes()).hexdigest(),digest)

    def test_source_pixels_positive_heights_and_unsuppressed_preview_outliers(self):
        info=public.source_info('nottingham')['source'];folder=public.ROOT/'frontend/public/research/nottingham-terrain'
        b=(folder/'preview-audit.json').read_bytes();audit=json.loads(b)
        self.assertEqual(hashlib.sha256(b).hexdigest(),info['sample_audit_sha256'])
        self.assertEqual(audit['controls_hits'],26386);self.assertEqual(audit['hits'],4096)
        self.assertLess(audit['max_control_query_error_m'],1e-9)
        self.assertGreater(audit['max_absolute_m'],7)
        fixtures=json.loads((folder/'pixel-queries.json').read_bytes())
        self.assertEqual(len({(f['row'],f['column']) for f in fixtures}),4096)
        self.assertTrue(any(f['source_height_m']>17 for f in fixtures),'Positive ODN source heights retained')
        digest=hashlib.sha256()
        with rasterio.open(public.ROOT/'backend/data/terrain/nottingham-ea-dtm-1m.tif') as ds:
            self.assertEqual(ds.crs.to_epsg(),27700);self.assertEqual(ds.res,(1.,1.));self.assertEqual(ds.dtypes,('float32',))
            self.assertEqual(list(ds.bounds),[455708,338276,459038,341431])
            self.assertEqual(ds.scales,(1.,));self.assertEqual(ds.offsets,(0.,))
            for top in range(0,ds.height,256):
                for left in range(0,ds.width,256):
                    a=ds.read(1,window=Window(left,top,min(256,ds.width-left),min(256,ds.height-top)))
                    digest.update(a.astype('<f4').tobytes())
            a=ds.read(1);self.assertEqual(int(np.isfinite(a).sum()),10506150)
            self.assertEqual(float(a.min()),info['min_height_m']);self.assertLess(float(a.min()),104)
            self.assertEqual(float(a.max()),info['max_height_m'])
            for f in fixtures:self.assertEqual(float(a[f['row'],f['column']]),f['source_height_m'])
        self.assertEqual(digest.hexdigest(),info['raster_pixel_block_sha256'])

    def test_exact_readonly_download_and_refusal_of_changed_candidate(self):
        with TemporaryDirectory() as temporary,patch.object(city,'CITY_DIR',Path(temporary)/'.local/city'):
            client=TestClient(app);source=client.get('/cities/nottingham/city/terrain/public-source').json()['source']
            for route,kind in [('public-preview','model'),('public-raster.tif','raster')]:
                r=client.get('/cities/nottingham/city/terrain/'+route);self.assertEqual(r.status_code,200)
                b=(public.ROOT/'backend/data/terrain'/public.CANDIDATES['nottingham'][kind][0]).read_bytes()
                self.assertEqual(r.content,b if kind=='raster' else b'{"terrain":'+b+b'}')
                self.assertEqual(hashlib.sha256(b).hexdigest(),source[kind+'_sha256'])
            with patch.object(public,'_candidate_bytes',side_effect=ValueError('altered source')):
                self.assertEqual(client.get('/cities/nottingham/city/terrain/public-preview').status_code,503)
            self.assertFalse((Path(temporary)/'.local').exists())
