import sys,unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import paper_projection_math as projection
import principal_ruled_benchmark as geometry
import variable_curvature_ruled as fields
class ProjectionMath(unittest.TestCase):
    def test_p1_projection_reproduces_affine_functions_and_is_orthogonal_to_all_three_basis_functions(self):
        triangle=np.array([[0.,0.],[1.,0.],[0.,1.]]);source=lambda xy:2+3*xy[:,0]-4*xy[:,1];m=geometry.model([[*p,float(source(p[None,:])[0])] for p in triangle],[{'kind':'triangle-strip','indices':[0,1,2]}]);p,a=projection.project_p1(m,source);self.assertTrue(np.allclose(np.array(p['points'])[:,2],np.array(m['points'])[:,2]));self.assertLess(a['largest_orthogonality_residual'],1e-14)
        source=lambda xy:xy[:,0]**2+2*xy[:,1]**2;p,a=projection.project_p1(m,source);xy,w,b=projection.quadrature(triangle,5);self.assertLess(np.max(np.abs(b.T@(w*(b@np.array(p['points'])[:,2]-source(xy))))),1e-14)
    def test_global_ruled_projection_keeps_shared_curve_indices_and_reproduces_an_in_space_function(self):
        field={'quadratic':[.004,.00004],'quartic':[0.,0.]};m=fields.ruled_grid(field,np.eye(2),np.eye(2),4,8);source=lambda xy:30+.004*xy[:,0]**2+2*xy[:,1];p,a=projection.project_c0_ruled(m,source);self.assertEqual(p['patches'],m['patches']);self.assertEqual(np.asarray(p['points'])[:,:2].tolist(),np.asarray(m['points'])[:,:2].tolist());self.assertAlmostEqual(a['integrated_area_m2'],10000);self.assertLess(a['relative_galerkin_residual'],1e-11)
        for patch in p['patches']:
            query,*_=geometry.primitive_coefficients(p,patch);nodes=np.asarray(p['points'])[patch['left']+patch['right'],:2];self.assertTrue(np.allclose(query(nodes),source(nodes),atol=1e-10,rtol=0))
    def test_saved_c0_projection_improves_full_error_for_a_rotated_quartic_with_exact_same_file_cost(self):
        field={'quadratic':[.004,.00004],'quartic':[5e-7,5e-9]}
        for angle in [0,30,45,90]:
            frame=fields.field_frame(angle);m=fields.ruled_grid(field,frame,frame,4,8);p,a=projection.project_c0_ruled(m,lambda xy:fields.value(xy,field,frame));self.assertEqual(len(fields.binary(m)),len(fields.binary(p)));self.assertLess(fields.integrate(p,field,frame,7)['e2_m2'],fields.integrate(m,field,frame,7)['e2_m2']);self.assertLess(a['relative_galerkin_residual'],1e-11);self.assertAlmostEqual(a['integrated_area_m2'],10000,places=6)
if __name__=='__main__':unittest.main()
