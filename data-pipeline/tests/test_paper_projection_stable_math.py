import json,sys,unittest
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'data-pipeline'))
import paper_projection_stable_math as stable
import variable_curvature_ruled as frozen
class StableFit(unittest.TestCase):
    def test_near_zero_support_at_a_rotated_clipping_corner_cannot_create_unusable_native_coefficients(self):
        report=json.loads((ROOT/'frontend/public/research/variable-curvature-v1/results.json').read_bytes());case=next(c for c in report['cases'] if c['id']=='published-quartic-45');frame=np.asarray(case['source_frame']);field=case['field']
        for budget in [256,512]:
            receipt=next(p['mean_hessian'] for p in case['pairs'] if p['budget']==budget);model=json.loads((ROOT/'frontend/public/research/variable-curvature-v1'/case['id']/receipt['filename']).read_bytes());p,a=stable.project_c0_ruled(model,lambda xy:frozen.value(xy,field,frame));self.assertTrue(a['accepted']);self.assertGreater(a['weak_controls_held_at_original_z'],0);self.assertLess(np.abs(p['points']).max(),10000);self.assertEqual(p['patches'],model['patches']);self.assertEqual(len(frozen.binary(p)),receipt['binary_bytes']);self.assertLess(frozen.integrate(p,field,frame,5)['e2_m2'],receipt['e2_m2'])
    def test_insufficient_iteration_budget_returns_the_exact_original_model_with_an_explicit_fallback(self):
        field={'quadratic':[.004,.00004],'quartic':[5e-7,5e-9]};frame=frozen.field_frame(30);m=frozen.ruled_grid(field,frame,frame,4,8);p,a=stable.project_c0_ruled(m,lambda xy:frozen.value(xy,field,frame),maximum_iterations=1);self.assertFalse(a['accepted']);self.assertIs(p,m);self.assertEqual(a['fallback_reason'],'fixed iteration limit reached')
if __name__=='__main__':unittest.main()
