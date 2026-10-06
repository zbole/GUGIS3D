import json,sys,unittest
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'data-pipeline'))
import variable_curvature_ruled as v
class VariableCurvatureTests(unittest.TestCase):
    def setUp(self):self.protocol=json.loads(v.PROTOCOL.read_bytes());self.field=self.protocol['fields'][0]
    def test_unrotated_baseline_reuses_the_exact_frozen_paper_metrics(self):
        report=json.loads((ROOT/'shared/paper-terrain-metrics.json').read_bytes());rows=next(m['rows'] for c in report['cases'] if c['id']=='variable_curvature' for m in c['methods'] if m['id']=='paper_l2_l1')
        for n,mesh,metrics in v.paper_meshes(self.field,v.field_frame(0),[8,16,32]):
            old=next(r for r in rows if r['triangles']==n);self.assertEqual(metrics['e2_m2'],old['e2_m2']);self.assertEqual(metrics['linf_m'],old['linf_m']);self.assertEqual(len(mesh),n)
    def test_clipped_rotated_ruled_and_p2_integrals_have_exact_degree_and_count_all_overhanging_controls(self):
        frame=v.field_frame(30);model=v.ruled_grid(self.field,frame,frame,4,8);a=v.integrate(model,self.field,frame,5);b=v.integrate(model,self.field,frame,7);self.assertAlmostEqual(a['e2_m2'],b['e2_m2'],places=10);self.assertEqual(a['integrated_area_m2'],10000);self.assertEqual(len(model['points']),9*9);self.assertEqual(len(v.binary(model)),48+24*81+36*32);self.assertTrue(any(abs(p[0])>50 or abs(p[1])>50 for p in model['points']))
        triangles=[np.array([[-50.,-50.],[50.,-50.],[50.,50.]]),np.array([[-50.,-50.],[50.,50.],[-50.,50.]])];p2=v.triangle_model(triangles,self.field,frame,2);self.assertEqual(len(v.binary(p2)),336);self.assertGreater(v.integrate(p2,self.field,frame)['e2_m2'],1e-8)
        quadratic={**self.field,'quartic':[0.,0.]};exact=v.triangle_model(triangles,quadratic,frame,2);self.assertLess(v.integrate(exact,quadratic,frame)['e2_m2'],1e-8)
    def test_protocol_keeps_all_rotations_and_source_derivatives_are_in_world_coordinates(self):
        self.assertEqual(self.protocol['angles_degrees'],[0,15,30,45,60,75,90]);self.assertEqual(len(self.protocol['fields']),2);self.assertEqual(len(self.protocol['ruling_segments'])*len(self.protocol['across_segments'])*len(self.protocol['frames']),180)
        frame=v.field_frame(45);p=np.array([[3.2,-7.1],[-13.7,29.3]]);h=1e-4;expected=v.source_gradient(p,self.field,frame)
        for i in range(2):
            step=np.eye(2)[i]*h;actual=(v.value(p+step,self.field,frame)-v.value(p-step,self.field,frame))/(2*h);np.testing.assert_allclose(actual,expected[:,i],atol=1e-7,rtol=0)
if __name__=='__main__':unittest.main()
