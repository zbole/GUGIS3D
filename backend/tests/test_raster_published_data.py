import hashlib,json,sys,unittest
from pathlib import Path
from zipfile import ZipFile
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'backend'))
from app.environment_models import Terrain
from app.services.terrain_compaction import primitive_sha256


class RasterPublishedTests(unittest.TestCase):
    def test_all_continuous_reference_receipts_and_downloads_match(self):
        report=json.loads((ROOT/'shared/raster-triangle-benchmark.json').read_bytes())
        for key,path in [('builder_source_sha256','backend/app/services/terrain_compaction.py'),
                         ('strip_packer_source_sha256','backend/app/services/terrain_triangles.py'),
                         ('raster_certificate_source_sha256','backend/app/services/terrain_raster_reference.py'),
                         ('hybrid_builder_source_sha256','backend/app/services/terrain_hybrid.py'),
                         ('native_query_source_sha256','frontend/src/studio/terrainMath.ts')]:
            self.assertEqual(report[key],hashlib.sha256((ROOT/path).read_bytes().replace(b'\r\n',b'\n')).hexdigest())
        self.assertEqual(report['parent_sha256'],hashlib.sha256((ROOT/'shared/hybrid-terrain-research.json').read_bytes()).hexdigest())
        self.assertIn('not interval',report['certificate'])
        case=report['cases'][0];self.assertEqual(case['source_shape'],[129,129]);self.assertFalse(case['demonstration'])
        public=ROOT/'frontend/public/research/hybrid-terrain';package=public/'swiss-dem-crop-raster-triangles.zip'
        content=package.read_bytes();self.assertEqual(len(content),case['download_bytes']);self.assertEqual(hashlib.sha256(content).hexdigest(),case['download_sha256'])
        with ZipFile(package) as archive:
            self.assertEqual(hashlib.sha256(archive.read('reference.npz')).hexdigest(),case['source_reference_sha256'])
            self.assertIn('Not a bound against unmeasured ground',archive.read('raster-reference.txt').decode())
            full=json.loads(archive.read('results.json'));self.assertIn('history',full['variants'][0]['local_triangles'])
            for pair in case['variants']:
                models={}
                for mode in ('hybrid','local_triangles','compact_hybrid'):
                    receipt=pair[mode];content=archive.read(receipt['filename']);models[mode]=Terrain.model_validate_json(content)
                    self.assertEqual(content,(public/'models'/case['id']/receipt['filename']).read_bytes())
                    self.assertEqual(len(content),receipt['bytes']);self.assertEqual(hashlib.sha256(content).hexdigest(),receipt['sha256'])
                    self.assertTrue(receipt['target_met']);self.assertTrue(receipt['offgrid']['meets_sampled_target'])
                    self.assertLessEqual(receipt['continuous_certificate']['max_error_bound_m'],pair['target_m'])
                    self.assertEqual(receipt['source_grid']['samples'],16641)
                    self.assertEqual(receipt['offgrid']['samples'],4096)
                self.assertEqual(models['hybrid'].points,models['compact_hybrid'].points)
                self.assertEqual(primitive_sha256(models['hybrid']),primitive_sha256(models['compact_hybrid']))
                self.assertEqual(pair['local_triangles']['edge_decision'],'longest-edge')
                self.assertTrue(pair['comparison_eligible'])
                if pair['target_m']<=.25:self.assertGreater(pair['historical_continuous_certificate']['max_error_bound_m'],pair['target_m'])
                self.assertNotIn('history',pair['local_triangles'])


if __name__=='__main__':unittest.main()
