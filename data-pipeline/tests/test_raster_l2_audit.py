import hashlib
import importlib.util
import json
from pathlib import Path
import unittest
from zipfile import ZipFile
import numpy as np

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('raster_l2',ROOT/'data-pipeline/raster_l2_audit.py')
audit=importlib.util.module_from_spec(spec);spec.loader.exec_module(audit)


class RasterL2Tests(unittest.TestCase):
    def test_exact_bilinear_residual_squared_on_both_triangle_intersections(self):
        ref={'x':[0,1],'y':[0,1],'height':[[0,0],[0,1]]}
        model={'points':[[0,0,0],[1,0,0],[0,1,0],[1,1,0]],'patches':[{'kind':'triangle-strip','indices':[0,1,2,3]}]}
        result=audit.integrate_model(ref,model)
        self.assertAlmostEqual(result['e2_m2'],1/3,places=13)
        self.assertEqual(result['native_triangles'],2)
        self.assertEqual(result['ruled_quads'],0)
        self.assertAlmostEqual(result['integrated_area_m2'],1.)

    def test_exact_ruled_interpolation_and_internal_raster_breaks(self):
        ref={'x':[0,.3,1],'y':[0,.4,1],'height':[[0,0,0],[0,.12,.4],[0,.3,1]]}
        model={'points':[[0,0,0],[1,0,0],[0,1,0],[1,1,1]],'patches':[{'kind':'ruled-strip','left':[0,2],'right':[1,3]}]}
        result=audit.integrate_model(ref,model)
        self.assertLess(result['e2_m2'],1e-15)
        model['points'][3][2]=0
        self.assertAlmostEqual(audit.integrate_model(ref,model)['e2_m2'],1/3,places=13)

    def test_clipping_outside_and_mixed_source_domain(self):
        poly=audit.clip_rectangle([[0,0],[2,0],[0,2]],.5,1,.5,1)
        value=0.;area=0.
        for i in range(1,len(poly)-1):
            v,a=audit.integrate_triangle([poly[0],poly[i],poly[i+1]],lambda sites:np.ones(len(sites)))
            value+=v;area+=a
        self.assertAlmostEqual(area,.25);self.assertAlmostEqual(value,.25)
        self.assertEqual(audit.clip_rectangle([[0,0],[1,0],[0,1]],2,3,2,3),[])

    def test_published_integrals_recompute_all_immutable_archives(self):
        report=json.loads((ROOT/'shared/bristol-global-l2.json').read_bytes())
        self.assertEqual(report['source_sha256'],hashlib.sha256((ROOT/'data-pipeline/raster_l2_audit.py').read_bytes().replace(b'\r\n',b'\n')).hexdigest())
        self.assertEqual(len(report['models']),18)
        for case_id in ('bristol-harbour','bristol-brandon-hill'):
            with ZipFile(ROOT/f'frontend/public/research/bristol-local-partition/{case_id}-local-partition.zip') as archive:
                ref_bytes=archive.read('reference.json')
            reference=json.loads(ref_bytes)
            for row in report['models']:
                if row['case_id']!=case_id:continue
                raw=(ROOT/'frontend/public/research/bristol-viewer/models'/case_id/row['filename']).read_bytes()
                self.assertEqual(hashlib.sha256(raw).hexdigest(),row['sha256'])
                self.assertEqual(hashlib.sha256(ref_bytes).hexdigest(),row['reference_sha256'])
                actual=audit.integrate_model(reference,json.loads(raw))
                for key,value in actual.items():self.assertEqual(value,row[key])
                self.assertLessEqual(row['rms_integral_m'],row['continuous_bound_m'])


if __name__=='__main__':unittest.main()
