"""Exact original pixels, additive provenance and read-only Exeter downloads."""
import hashlib,json,unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from fastapi.testclient import TestClient
import numpy as np
import rasterio
from rasterio.windows import Window
from app.main import app
from app.routers import city
from app.services import public_terrain as public

class ExeterPublicTerrainTests(unittest.TestCase):
    def test_v9_preserves_thirteen_exact_sources_and_all_ancestor_pins(self):
        previous=(public.ROOT/'shared/public-terrain-sources-v8.json').read_bytes()
        report=json.loads(public.MANIFEST_PATH.read_bytes())
        self.assertEqual(report['schema'],'gugis-public-terrain-sources-v9')
        self.assertEqual(report['parent_manifest'],{'filename':'public-terrain-sources-v8.json','sha256':hashlib.sha256(previous).hexdigest()})
        self.assertEqual(report['sources'][:-1],json.loads(previous)['sources'])
        self.assertEqual(report['sources'][-1]['city_id'],'exeter')
        self.assertEqual(sum(s['valid_pixels'] for s in report['sources']),108433526)
        for name,digest in public.HISTORICAL_MANIFESTS.items():
            self.assertEqual(hashlib.sha256((public.ROOT/'shared'/name).read_bytes()).hexdigest(),digest)
        for source in report['sources'][:-1]:
            for kind in ('raster','model'):
                self.assertEqual(hashlib.sha256(public._candidate_bytes(source,kind)).hexdigest(),source[kind+'_sha256'])

    def test_actual_original_pixel_values_and_all_preview_outliers_are_retained(self):
        info=public.source_info('exeter')['source'];folder=public.ROOT/'frontend/public/research/exeter-terrain'
        audit_bytes=(folder/'preview-audit.json').read_bytes();audit=json.loads(audit_bytes)
        self.assertEqual(hashlib.sha256(audit_bytes).hexdigest(),info['sample_audit_sha256'])
        self.assertEqual(audit['controls_hits'],25080);self.assertEqual(audit['hits'],4096)
        self.assertLess(audit['max_control_query_error_m'],1e-9);self.assertGreater(audit['max_absolute_m'],5)
        fixtures=json.loads((folder/'pixel-queries.json').read_bytes())
        self.assertEqual(len({(f['row'],f['column']) for f in fixtures}),4096)
        digest=hashlib.sha256()
        with rasterio.open(public.ROOT/'backend/data/terrain/exeter-ea-dtm-1m.tif') as ds:
            self.assertEqual(ds.crs.to_epsg(),27700);self.assertEqual(ds.res,(1.,1.));self.assertEqual(ds.dtypes,('float32',))
            self.assertEqual(list(ds.bounds),[290508,90794,293540,94081]);self.assertEqual(ds.scales,(1.,));self.assertEqual(ds.offsets,(0.,))
            for top in range(0,ds.height,256):
                for left in range(0,ds.width,256):
                    block=ds.read(1,window=Window(left,top,min(256,ds.width-left),min(256,ds.height-top)))
                    digest.update(block.astype('<f4').tobytes())
            values=ds.read(1);self.assertEqual(int(np.isfinite(values).sum()),9966184)
            self.assertEqual(float(values.min()),info['min_height_m']);self.assertEqual(float(values.max()),info['max_height_m'])
            for f in fixtures:self.assertEqual(float(values[f['row'],f['column']]),f['source_height_m'])
        self.assertEqual(digest.hexdigest(),info['raster_pixel_block_sha256'])

    def test_readonly_exact_downloads_and_changed_previous_manifest_refusal(self):
        with TemporaryDirectory() as folder,patch.object(city,'CITY_DIR',Path(folder)/'.local/city'):
            client=TestClient(app)
            response=client.get('/cities/exeter/city/terrain/public-source');self.assertEqual(response.status_code,200)
            source=response.json()['source']
            for route,kind in [('public-preview','model'),('public-raster.tif','raster')]:
                response=client.get('/cities/exeter/city/terrain/'+route);self.assertEqual(response.status_code,200)
                blob=public._candidate_bytes(source,kind)
                self.assertEqual(response.content,blob if kind=='raster' else b'{"terrain":'+blob+b'}')
            read=public._read_bounded
            def changed(path,limit):
                blob=read(path,limit)
                return blob+b' ' if path.name=='public-terrain-sources-v8.json' else blob
            with patch.object(public,'_read_bounded',side_effect=changed):
                self.assertEqual(client.get('/cities/exeter/city/terrain/public-preview').status_code,503)
            with patch.object(public,'_candidate_bytes',side_effect=ValueError('damaged source')):
                self.assertEqual(client.get('/cities/exeter/city/terrain/public-raster.tif').status_code,503)
            self.assertFalse((Path(folder)/'.local').exists())
