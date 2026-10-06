import sys,unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import source_global_fit_math as fitting
import diagonal_hybrid_math as geometry
import diagonal_hybrid_audit as independent
REF={'origin_bng':[383805.5,398336.5]}
class SharedSourceFit(unittest.TestCase):
    def test_exact_cell_masses_and_cross_loads_preserve_partition_of_unity_and_polynomial_reproduction(self):
        for family in ['ruled','minus','plus']:
            for dx,dy in [(1,1),(4,8),(8,4)]:
                matrix=fitting.mass_matrix(family,dx,dy);cross=fitting.cross_weights(family,dx,dy);self.assertTrue(np.all(np.linalg.eigvalsh(matrix)>0));self.assertAlmostEqual(matrix.sum(),dx*dy);self.assertTrue(np.allclose(cross@np.ones((dx+1)*(dy+1)),matrix@np.ones(4),atol=1e-12));x,y=np.meshgrid(np.arange(dx+1),np.arange(dy+1));coarse=np.array([2,2+3*dx,2-4*dy,2+3*dx-4*dy]);self.assertTrue(np.allclose(cross@(2+3*x-4*y).ravel(),matrix@coarse,atol=1e-10))
    def test_shared_C0_fit_reproduces_affine_source_without_changing_topology_or_bytes(self):
        x,y=np.meshgrid(np.arange(65),np.arange(65));ref={**REF,'height':(10+.02*x+.03*y).tolist()}
        for families in [['ruled']*32,['minus']*32,['plus']*32,['ruled','minus','plus','ruled']*8]:
            original=geometry.make_model(ref,4,8,families);model,a=fitting.fit(ref,4,8,families,{});self.assertEqual(model['patches'],original['patches']);self.assertTrue(np.allclose(np.array(model['points'])[:,2],np.array(original['points'])[:,2],atol=1e-10));self.assertLess(a['relative_galerkin_residual'],1e-11)
    def test_real_saved_source_fitting_improves_actual_integral_in_each_frozen_cell_family_with_identical_cost(self):
        root=Path(__file__).resolve().parents[2];import json
        ref=json.loads((root/'frontend/public/research/source-native-bands-v1/manchester-centre/reference.json').read_bytes())
        for family in ['ruled','minus','plus']:
            families=[family]*32;old=geometry.make_model(ref,4,8,families);model,a=fitting.fit(ref,4,8,families,{});before=independent.audit(ref,old,4,8,families);after=independent.audit(ref,model,4,8,families);self.assertLess(after['e2_m2'],before['e2_m2']);self.assertEqual(len(fitting.binary(old)),len(fitting.binary(model)))
    def test_full_source_grid_is_an_exact_ruled_identity_and_projected_P1_retains_same_native_topology(self):
        root=Path(__file__).resolve().parents[2];import json
        ref=json.loads((root/'frontend/public/research/source-native-bands-v1/manchester-centre/reference.json').read_bytes())
        families=['ruled']*4096;original=geometry.make_model(ref,64,64,families);saved,a=fitting.fit(ref,64,64,families,{})
        self.assertEqual(saved,original);self.assertEqual(a['status'],'exact_source_space_identity')
        families=['minus']*4096;original=geometry.make_model(ref,64,64,families);saved,a=fitting.fit(ref,64,64,families,{})
        self.assertEqual(saved['patches'],original['patches']);self.assertEqual(len(fitting.binary(saved)),len(fitting.binary(original)))
        self.assertLess(a['relative_galerkin_residual'],1e-11)
        before=independent.audit(ref,original,64,64,families);after=independent.audit(ref,saved,64,64,families);self.assertLess(after['e2_m2'],before['e2_m2'])
if __name__=='__main__':unittest.main()
