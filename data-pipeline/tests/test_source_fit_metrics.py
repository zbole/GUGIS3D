import sys,json,unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from source_fit_metrics import measure
from source_global_fit_math import fit
from diagonal_hybrid_math import make_model
from diagonal_hybrid_audit import audit
import source_fit_galerkin_audit as galerkin
import source_global_fit_math as fitting

class SavedFitMetrics(unittest.TestCase):
    def test_independent_numeric_GL5_load_and_mass_for_every_family_and_anisotropic_shape(self):
        for family in ['ruled','minus','plus']:
            for dx,dy in [(1,1),(4,8),(8,4)]:
                m,c=galerkin.matrices(family,dx,dy);self.assertTrue(np.allclose(m,fitting.mass_matrix(family,dx,dy),atol=1e-12));self.assertTrue(np.allclose(c,fitting.cross_weights(family,dx,dy),atol=1e-12))
    def test_noninterpolatory_shared_corners_and_both_diagonals_agree_with_independent_GL5(self):
        root=Path(__file__).resolve().parents[2];ref=json.loads((root/'frontend/public/research/source-native-bands-v1/manchester-centre/reference.json').read_bytes());cache={}
        for nx,ny in [(1,2),(4,8),(8,4),(64,64)]:
            for families in [['ruled']*(nx*ny),['minus']*(nx*ny),['plus']*(nx*ny),(['ruled','minus','plus','ruled']*(nx*ny//4+1))[:nx*ny]]:
                model,_=fit(ref,nx,ny,families,cache);a=measure(ref,model,nx,ny,families);b=audit(ref,model,nx,ny,families);g=galerkin.audit(ref,make_model(ref,nx,ny,families),model,nx,ny,families,{})
                self.assertLess(abs(a['e2_m2']-b['e2_m2']),1e-8);self.assertLess(abs(a['continuous_maximum_m']-b['continuous_maximum_m']),1e-9)
    def test_exact_source_ruled_and_affine_P1_have_zero_integrated_error(self):
        x,y=np.meshgrid(np.arange(65),np.arange(65));ref={'origin_bng':[1.,2.],'height':(2+.03*x-.02*y).tolist()}
        for family in ['ruled','minus','plus']:
            a=measure(ref,make_model(ref,8,4,[family]*32),8,4,[family]*32);self.assertLess(a['e2_m2'],1e-12);self.assertLess(a['continuous_maximum_m'],1e-13)
if __name__=='__main__':unittest.main()
