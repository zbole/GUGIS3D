import json,sys,unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import diagonal_hybrid_math as producer
import diagonal_hybrid_audit as independent
BASE=json.loads((Path(__file__).resolve().parents[2]/'frontend/public/research/source-native-bands-v1/manchester-centre/reference.json').read_bytes())
class DiagonalIntegralAudit(unittest.TestCase):
    def test_saved_native_two_orientation_models_have_independently_matching_integrals_and_maxima(self):
        for nx,ny in [(1,1),(4,8),(64,64)]:
            for model,metrics in producer.grid(BASE,nx,ny,{},{}).values():
                result=independent.audit(BASE,model,nx,ny,metrics['families']);self.assertAlmostEqual(result['e2_m2'],metrics['e2_m2'],places=8);self.assertAlmostEqual(result['continuous_maximum_m'],metrics['continuous_maximum_m'],places=8)
    def test_positive_diagonal_maxima_are_found_inside_source_cells(self):
        x,y=np.meshgrid(np.arange(65),np.arange(65));ref={**BASE,'height':np.minimum(x,y).astype(float).tolist()};model=producer.make_model(ref,1,1,['plus']);r=independent.audit(ref,model,1,1,['plus']);self.assertAlmostEqual(r['continuous_maximum_m'],.25);self.assertLess(r['e2_m2'],1)
    def test_independent_integral_uses_saved_heights_instead_of_replacing_them_with_the_source(self):
        model=producer.make_model(BASE,4,8,['plus']*32);a=independent.audit(BASE,model,4,8,['plus']*32);model['points'][0][2]+=1;b=independent.audit(BASE,model,4,8,['plus']*32);self.assertNotEqual(a['e2_m2'],b['e2_m2']);self.assertGreater(b['continuous_maximum_m'],a['continuous_maximum_m'])
if __name__=='__main__':unittest.main()
