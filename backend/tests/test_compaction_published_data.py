import hashlib,json,sys,unittest
from pathlib import Path
from zipfile import ZipFile
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'backend'));sys.path.insert(0,str(ROOT/'data-pipeline'))
from app.environment_models import Terrain
from app.services.terrain_compaction import primitive_sha256
from build_strip_compaction_research import independent_heights
import numpy as np


class CompactionPublishedTests(unittest.TestCase):
    def test_downloads_and_source_revisions_preserve_primitive_evidence(self):
        report=json.loads((ROOT/'shared/strip-compaction-benchmark.json').read_bytes())
        for key,path in [('builder_source_sha256','backend/app/services/terrain_compaction.py'),
                         ('strip_packer_source_sha256','backend/app/services/terrain_triangles.py'),
                         ('decoder_source_sha256','data-pipeline/build_strip_compaction_research.py'),
                         ('native_query_source_sha256','frontend/src/studio/terrainMath.ts')]:
            self.assertEqual(report[key],hashlib.sha256((ROOT/path).read_bytes().replace(b'\r\n',b'\n')).hexdigest())
        self.assertEqual(report['parent_sha256'],hashlib.sha256((ROOT/'shared/local-triangle-benchmark.json').read_bytes()).hexdigest())
        public=ROOT/'frontend/public/research/hybrid-terrain'
        for case in report['cases']:
            content=(public/f'{case["id"]}-strip-compaction.zip').read_bytes()
            self.assertEqual(len(content),case['download_bytes']);self.assertEqual(hashlib.sha256(content).hexdigest(),case['download_sha256'])
            with ZipFile(public/f'{case["id"]}-strip-compaction.zip') as archive:
                for pair in case['variants']:
                    original=Terrain.model_validate_json(archive.read(pair['hybrid']['filename']))
                    compact=Terrain.model_validate_json(archive.read(pair['compact_hybrid']['filename']))
                    self.assertEqual(primitive_sha256(original),primitive_sha256(compact))
                    self.assertEqual(original.points,compact.points)
                    for mode in ('hybrid','compact_hybrid','local_triangles'):
                        model=pair[mode];content=archive.read(model['filename'])
                        self.assertEqual(content,(public/'models'/case['id']/model['filename']).read_bytes())
                        self.assertEqual(hashlib.sha256(content).hexdigest(),model['sha256'])
                    self.assertEqual(hashlib.sha256(archive.read(pair['boundary_fixture'])).hexdigest(),pair['boundary_fixture_sha256'])

    def test_independent_decoder_reads_every_quad_of_a_long_band(self):
        data={'points':[[0,0,0],[1,0,0],[0,1,0],[1,1,1],[0,2,0],[1,2,2]],
              'patches':[{'kind':'ruled-strip','left':[1,3,5],'right':[0,2,4]}]}
        values=independent_heights(data,np.asarray([[.5,.5],[.5,1.5],[1,2],[0,0]]))
        np.testing.assert_allclose(values,[.25,.75,2,0],rtol=0,atol=1e-12)


if __name__=='__main__':unittest.main()
