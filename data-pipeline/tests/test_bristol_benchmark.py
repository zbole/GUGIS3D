"""Verify shipped ZIPs against original pixels, reference bounds and saved XYZ."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from zipfile import ZipFile
import numpy as np
import rasterio

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'data-pipeline'))
sys.path.insert(0, str(ROOT/'backend'))
from app.environment_models import Terrain
from app.services.terrain_raster_reference import RasterReference
from app.services.terrain_compaction import primitive_sha256
from build_bristol_terrain_benchmark import packed
from export_raster_multipatch import read_parts, readback_heights, recover_native
from benchmark_research_joined_strips import triangles_digest


class BristolBenchmarkTests(unittest.TestCase):
    def test_shipped_reference_exact_pixels_and_all_saved_models_satisfy_reference_bound(self):
        report = json.loads((ROOT/'shared/bristol-certified-terrain.json').read_bytes())
        with rasterio.open(ROOT/'backend/data/terrain/bristol-ea-dtm-1m.tif') as raster:
            for case in report['cases']:
                with ZipFile(ROOT/'frontend/public/research/bristol-certified'/case['download']['filename']) as archive:
                    reference_bytes = archive.read('reference.json')
                    self.assertEqual(hashlib.sha256(reference_bytes).hexdigest(),case['reference_sha256'])
                    reference = json.loads(reference_bytes)
                    row,col,h,w = case['source_window']
                    actual = raster.read(1,window=rasterio.windows.Window(col,row,w,h))[::-1]
                    np.testing.assert_array_equal(actual,np.asarray(reference['height']))
                    self.assertEqual(list(raster.xy(row+32,col+32)),case['origin_bng'])
                    ref = RasterReference(reference['x'],reference['y'],reference['height'])
                    for pair in case['variants']:
                        models = {}
                        for family in ('hybrid','compact_hybrid','local_triangles'):
                            receipt = pair[family];content = archive.read(receipt['filename'])
                            self.assertEqual(hashlib.sha256(content).hexdigest(),receipt['sha256'])
                            self.assertEqual(len(content),receipt['bytes'])
                            model = Terrain.model_validate(json.loads(content))
                            models[family] = model
                            bound = ref.model_error(model.model_dump(exclude_none=True))['max_error_bound_m']
                            self.assertAlmostEqual(bound,receipt['continuous_bound_m'],places=9)
                            self.assertLessEqual(bound,pair['target_m'])
                        self.assertEqual(primitive_sha256(models['hybrid']),primitive_sha256(models['compact_hybrid']))
                        self.assertEqual(primitive_sha256(models['hybrid']),pair['primitive_sha256'])

    def test_shipped_multipatch_and_recovery_are_exact_and_match_native_query_csv(self):
        report = json.loads((ROOT/'shared/bristol-certified-terrain.json').read_bytes())
        for case in report['cases']:
            with ZipFile(ROOT/'frontend/public/research/bristol-certified'/case['download']['filename']) as archive:
                fixture = json.loads(archive.read('query-fixture.json'))
                self.assertEqual(hashlib.sha256(archive.read('query-fixture.json')).hexdigest(),case['fixture_sha256'])
                for pair in case['variants']:
                    prefix = f"multipatch-{pair['target_m']:g}m/"
                    mp = pair['multipatch'];model = pair['local_triangles']
                    with tempfile.TemporaryDirectory() as directory:
                        base = Path(directory)/'terrain'
                        for component in mp['components']:
                            content = archive.read(prefix+component['filename'])
                            self.assertEqual(hashlib.sha256(content).hexdigest(),component['sha256'])
                            self.assertEqual(len(content),component['bytes'])
                            (Path(directory)/component['filename']).write_bytes(content)
                        saved = read_parts(base)
                        self.assertEqual(triangles_digest(saved),mp['geometry'])
                        recovery_bytes = archive.read(prefix+'native-recovery.json')
                        self.assertEqual(hashlib.sha256(recovery_bytes).hexdigest(),mp['native_recovery']['sha256'])
                        self.assertEqual(packed(recover_native(saved,json.loads(recovery_bytes))),archive.read(model['filename']))
                        csv = archive.read(model['query_audit']['csv']['filename'])
                        self.assertEqual(hashlib.sha256(csv).hexdigest(),model['query_audit']['csv']['sha256'])
                        from io import BytesIO
                        rows = np.genfromtxt(BytesIO(csv),delimiter=',',skip_header=1)
                        measured = readback_heights(saved,np.asarray(fixture['xy']),case['origin_bng'])
                        self.assertLessEqual(float(np.max(np.abs(measured-rows[:,3]))),1e-8)


if __name__ == '__main__':
    unittest.main()
