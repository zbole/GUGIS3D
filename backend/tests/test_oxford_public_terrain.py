"""Versioned provenance, original Oxford pixels and read-only public endpoints."""
import hashlib
import json
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


class OxfordPublicTerrainTests(unittest.TestCase):
    def test_version_retains_exact_six_source_records_and_parent_digest(self):
        before=(public.ROOT/'shared/public-terrain-sources.json').read_bytes()
        report=json.loads((public.ROOT/'shared/public-terrain-sources-v2.json').read_bytes())
        self.assertEqual(hashlib.sha256(before).hexdigest(),report['parent_manifest']['sha256'])
        self.assertEqual(report['schema'],'gugis-public-terrain-sources-v2')
        self.assertEqual(report['sources'][:-1],json.loads(before)['sources'])
        self.assertEqual(report['sources'][-1]['city_id'],'oxford')
        self.assertEqual(sum(s['valid_pixels'] for s in report['sources']),45204043)

    def test_original_pixels_unique_query_sources_and_diagnostics(self):
        info=public.source_info('oxford')['source']
        folder=public.ROOT/'frontend/public/research/oxford-terrain'
        audit_bytes=(folder/'preview-audit.json').read_bytes(); audit=json.loads(audit_bytes)
        self.assertEqual(hashlib.sha256(audit_bytes).hexdigest(),info['sample_audit_sha256'])
        self.assertEqual(audit['controls_hits'],20216); self.assertEqual(audit['hits'],4096)
        self.assertLess(audit['max_control_query_error_m'],1e-9)
        self.assertGreater(audit['max_absolute_m'],3.5)
        fixtures_bytes=(folder/'pixel-queries.json').read_bytes()
        self.assertEqual(hashlib.sha256(fixtures_bytes).hexdigest(),audit['fixture_sha256'])
        fixtures=json.loads(fixtures_bytes); self.assertEqual(len({(f['row'],f['column']) for f in fixtures}),4096)
        digest=hashlib.sha256()
        with rasterio.open(public.ROOT/'backend/data/terrain/oxford-ea-dtm-1m.tif') as ds:
            self.assertEqual(ds.crs.to_epsg(),27700); self.assertEqual(ds.res,(1.,1.))
            self.assertEqual(list(ds.bounds),[450264,204949,452919,207980])
            self.assertEqual(ds.scales,(1.,)); self.assertEqual(ds.offsets,(0.,))
            for top in range(0,ds.height,256):
                for left in range(0,ds.width,256):
                    block=ds.read(1,window=Window(left,top,min(256,ds.width-left),min(256,ds.height-top)))
                    digest.update(block.astype('<f4').tobytes())
            values=ds.read(1); self.assertEqual(int(np.isfinite(values).sum()),8047305)
            for f in fixtures:self.assertEqual(float(values[f['row'],f['column']]),f['source_height_m'])
        self.assertEqual(digest.hexdigest(),info['raster_pixel_block_sha256'])

    def test_exact_readonly_bytes_and_tampered_oxford_or_parent_rejected(self):
        with TemporaryDirectory() as temporary, patch.object(city,'CITY_DIR',Path(temporary)/'.local/city'):
            client=TestClient(app); source=client.get('/cities/oxford/city/terrain/public-source').json()['source']
            for route,kind in [('public-preview','model'),('public-raster.tif','raster')]:
                result=client.get('/cities/oxford/city/terrain/'+route); self.assertEqual(result.status_code,200)
                original=(public.ROOT/'backend/data/terrain'/public.CANDIDATES['oxford'][kind][0]).read_bytes()
                expected=original if kind=='raster' else b'{"terrain":'+original+b'}'
                self.assertEqual(result.content,expected)
                self.assertEqual(hashlib.sha256(original).hexdigest(),source[kind+'_sha256'])
            self.assertFalse((Path(temporary)/'.local').exists())
            bad=Path(temporary)/'shared'; bad.mkdir(); (bad/'public-terrain-sources.json').write_bytes(b'{}')
            with patch.object(public,'ROOT',Path(temporary)):
                result=client.get('/cities/oxford/city/terrain/public-source'); self.assertEqual(result.status_code,503)
            self.assertFalse((Path(temporary)/'.local').exists())
            with patch.object(public,'_candidate_bytes',side_effect=ValueError('altered Oxford bytes')):
                self.assertEqual(client.get('/cities/oxford/city/terrain/public-preview').status_code,503)
