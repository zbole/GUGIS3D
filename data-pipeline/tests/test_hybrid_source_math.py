import json,sys,unittest
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'data-pipeline'))
import hybrid_source_math as h
import source_band_benchmark as source
class HybridSourceMathTests(unittest.TestCase):
    def test_source_cell_p1_maximum_occurs_between_nodes_on_the_cut_diagonal(self):
        z=np.array([[0.,0.],[0.,4.]]);m=h.block_metrics(z,0,1,0,1);self.assertEqual(m['ruled']['l2_squared'],0);self.assertAlmostEqual(m['p1']['l2_squared'],16/90,places=12);self.assertAlmostEqual(m['p1']['maximum_m'],1,places=12);self.assertEqual(m['p1']['witness_xy'],[-31.5,-31.5])
    def test_bilinear_mass_matrix_agrees_with_independent_tensor_gauss_quadrature(self):
        rng=np.random.default_rng(421);z=rng.normal(size=(4,6));t,w=np.polynomial.legendre.leggauss(4);t=(t+1)/2;w=w/2;total=0
        for j in range(3):
            for i in range(5):
                for u,wu in zip(t,w):
                    for v,wv in zip(t,w):total+=wu*wv*h.bilinear(z[j:j+2,i:i+2],u,v)**2
        self.assertAlmostEqual(float(np.sum(h.masses(z))),total,places=12)
    def test_ridge_source_can_prefer_p1_while_bilinear_source_prefers_ruled(self):
        x,y=np.meshgrid(np.arange(9),np.arange(5));z=np.where(x<=4,np.minimum(x+y,4),4+(x-4)*y/4);a=h.block_metrics(z,0,4,0,4);b=h.block_metrics(z,4,8,0,4);self.assertLess(a['p1']['l2_squared'],a['ruled']['l2_squared']);self.assertEqual(b['ruled']['l2_squared'],0);self.assertGreater(b['p1']['l2_squared'],0)
    def test_full_resolution_models_preserve_the_old_binary_protocol_exactly(self):
        reference=json.loads((ROOT/'frontend/public/research/source-native-bands-v1/manchester-centre/reference.json').read_bytes());expected=source.make_models(reference);grid=h.grid(reference,64,64,{})
        for key,old in [('ruled','ruled'),('p1','source_p1')]:self.assertEqual(source.binary(grid[key][0]),source.binary(expected[old]));self.assertLess(abs(grid[key][1]['e2_m2']-source.integration(reference,expected[old])['e2_m2']),1e-8)
        self.assertEqual(grid['hybrid'][1]['p1_triangles'],0);self.assertEqual(grid['hybrid'][1]['continuous_maximum_m'],0);self.assertEqual(grid['hybrid'][1]['binary_bytes'],135528)
    def test_whole_source_diagonal_clipping_metrics_detect_a_hidden_peak(self):
        z=np.array([[0.,0.,0.],[0.,3.,0.],[0.,0.,0.]]);m=h.block_metrics(z,0,2,0,2)
        for method in ['ruled','p1']:self.assertEqual(m[method]['maximum_m'],3);self.assertEqual(m[method]['witness_xy'],[-31,-31]);self.assertGreater(m[method]['l2_squared'],0)
if __name__=='__main__':unittest.main()
