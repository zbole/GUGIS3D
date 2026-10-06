import json,sys,unittest
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'data-pipeline'))
import hybrid_source_math as producer
import hybrid_source_audit as independent
class HybridSourceAuditTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.ref=json.loads((ROOT/'frontend/public/research/source-native-bands-v1/manchester-centre/reference.json').read_bytes())
    def test_independent_full_cell_and_clipped_diagonal_integrals_match_all_three_methods(self):
        cache={}
        for nx,ny in [(1,1),(4,8),(64,64)]:
            for method,(model,metrics) in producer.grid(self.ref,nx,ny,cache).items():
                r=independent.audit(self.ref,model,nx,ny,metrics['families']);self.assertAlmostEqual(r['e2_m2'],metrics['e2_m2'],places=8);self.assertAlmostEqual(r['continuous_maximum_m'],metrics['continuous_maximum_m'],places=8);self.assertEqual(r['integrated_area_m2'],4096)
    def test_both_clipped_quadrature_parts_cover_the_full_source_cell(self):
        for dx,dy,c in [(1,1,1),(2,4,3),(8,2,9),(64,32,45)]:
            parts,ends=independent.cut_quadrature(dx,dy,c);self.assertAlmostEqual(sum(float(np.sum(w)) for xy,w in parts),1,places=12);self.assertTrue(np.all(ends>=0));self.assertTrue(np.all(ends<=1));np.testing.assert_allclose(dy*ends[:,0]+dx*ends[:,1],c,atol=1e-12,rtol=0)
    def test_independent_saved_value_evaluation_detects_model_heights_changed_after_selection(self):
        model,metrics=producer.grid(self.ref,2,4,{})['hybrid'];original=independent.audit(self.ref,model,2,4,metrics['families'])
        for p in model['points']:p[2]+=2
        changed=independent.audit(self.ref,model,2,4,metrics['families']);self.assertGreater(changed['continuous_maximum_m'],original['continuous_maximum_m']+1);self.assertGreater(abs(changed['e2_m2']-original['e2_m2']),50)
if __name__=='__main__':unittest.main()
