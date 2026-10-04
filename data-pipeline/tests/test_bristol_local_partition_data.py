import hashlib
import json
from pathlib import Path
import sys
import unittest
from zipfile import ZipFile
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'data-pipeline'));sys.path.insert(0,str(ROOT/'backend'))
from app.environment_models import Terrain
from app.services.terrain_raster_reference import RasterReference
from app.services.terrain_compaction import primitive_sha256
from publish_bristol_local_partition import closure


class PublishedLocalPartitionTests(unittest.TestCase):
    def test_shipped_models_are_certified_closed_oriented_and_geometry_identical_after_compaction(self):
        report=json.loads((ROOT/'shared/bristol-local-partition.json').read_bytes())
        parent=json.loads((ROOT/'shared/bristol-certified-terrain.json').read_bytes())
        for case in report['cases']:
            original=next(c for c in parent['cases'] if c['id']==case['id'])
            self.assertEqual(case['reference_sha256'],original['reference_sha256'])
            with ZipFile(ROOT/'frontend/public/research/bristol-local-partition'/case['download']['filename']) as archive:
                reference_bytes=archive.read('reference.json')
                self.assertEqual(hashlib.sha256(reference_bytes).hexdigest(),case['reference_sha256'])
                reference=json.loads(reference_bytes);ref=RasterReference(reference['x'],reference['y'],reference['height'])
                for pair in case['variants']:
                    for family in ('local_hybrid','compact_local_hybrid'):
                        record=pair[family];content=archive.read(record['filename'])
                        self.assertEqual(len(content),record['bytes']);self.assertEqual(hashlib.sha256(content).hexdigest(),record['sha256'])
                        model=Terrain.model_validate(json.loads(content))
                        self.assertEqual(primitive_sha256(model),pair['primitive_sha256'])
                        self.assertEqual(closure(model),record['closure'])
                        self.assertTrue(all(p.kind in ('ruled-strip','triangle-strip') for p in model.patches))
                        certificate=ref.model_error(model.model_dump(exclude_none=True))
                        self.assertAlmostEqual(certificate['max_error_bound_m'],record['continuous_bound_m'],places=9)
                        self.assertLessEqual(certificate['max_error_bound_m'],pair['target_m'])
                        csv=archive.read(record['query_audit']['csv']['filename'])
                        self.assertEqual(hashlib.sha256(csv).hexdigest(),record['query_audit']['csv']['sha256'])
                        from io import BytesIO
                        rows=np.genfromtxt(BytesIO(csv),delimiter=',',skip_header=1)
                        np.testing.assert_allclose(rows[:,2],ref(rows[:,0],rows[:,1]),rtol=0,atol=1e-12)
                        np.testing.assert_allclose(rows[:,4],rows[:,3]-rows[:,2],rtol=0,atol=1e-12)
                        self.assertLessEqual(float(np.max(np.abs(rows[:,4]))),certificate['max_error_bound_m'])


if __name__=='__main__':unittest.main()
