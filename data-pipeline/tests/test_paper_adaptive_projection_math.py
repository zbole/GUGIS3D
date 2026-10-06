import math,sys,unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import paper_adaptive_projection_math as adaptive
import paper_adaptive_projection_audit as independent
from variable_curvature_ruled import field_frame,p1_metrics
from paper_metric_benchmark import bisect
FIELD={'id':'test','quadratic':[.0001,.0001],'quartic':[.0000005,.00000008]}
class AdaptiveProjection(unittest.TestCase):
    def test_saved_local_projection_reproduces_affine_values_and_is_orthogonal_under_independent_quadrature(self):
        affine={'quadratic':[0,0],'quartic':[0,0]};p=np.array([[-50.,-50.],[50.,-50.],[50.,50.]])
        m=adaptive.local(p,affine,np.eye(2));self.assertTrue(np.allclose(m['z'],30,atol=1e-12));self.assertLess(m['l2_squared'],1e-18)
        m=adaptive.local(p,FIELD,field_frame(30));bary,weights=adaptive.quadrature(5);source=adaptive.quartic_value((bary@p)@field_frame(30),FIELD);det=abs(np.linalg.det(np.column_stack((p[1]-p[0],p[2]-p[0]))))
        self.assertLess(np.abs(bary.T@(weights*det*(source-bary@m['z']))).max(),1e-8)
        self.assertAlmostEqual(m['it_l1'],p1_metrics(p,FIELD,field_frame(30))['l1'],places=8)
    def test_full_trace_selects_maximum_PT_error_but_uses_paper_IT_L1_for_each_edge(self):
        frame=field_frame(30);snapshots,trace=adaptive.meshes(FIELD,frame,[8,16,32]);triangles={0:np.array([[-50.,-50.],[50.,-50.],[50.,50.]]),1:np.array([[-50.,-50.],[50.,50.],[-50.,50.]])}
        for row in trace:
            key=max(triangles,key=lambda k:(adaptive.local(triangles[k],FIELD,frame)['l2_squared'],-k));self.assertEqual(row['selected_id'],key);p=triangles.pop(key)
            costs=[math.fsum(p1_metrics(c,FIELD,frame)['l1'] for c in bisect(p,e)) for e in range(3)]
            self.assertTrue(np.allclose(costs,row['child_it_l1_costs'],rtol=1e-10,atol=1e-9));self.assertEqual(row['edge'],min(range(3),key=lambda e:(row['child_it_l1_costs'][e],e)))
            for k,c in zip(row['child_ids'],bisect(p,row['edge'])):triangles[k]=c
        self.assertEqual(len(triangles),32);self.assertEqual(len(trace),30)
    def test_actual_saved_model_integrals_match_and_error_decreases_across_nested_budgets(self):
        frame=field_frame(45);rows,trace=adaptive.meshes(FIELD,frame,[8,16,32,64]);last=math.inf
        for row in rows:
            model=row['model'];self.assertEqual(len(model['patches']),row['budget']);self.assertTrue(all(len(p['indices'])==3 for p in model['patches']))
            values=independent.integral(model,FIELD,frame);self.assertAlmostEqual(values['e2_m2'],row['e2_m2'],places=9);self.assertAlmostEqual(values['integrated_area_m2'],10000,places=7);self.assertLess(row['e2_m2'],last);last=row['e2_m2'];self.assertLess(values['largest_orthogonality_residual_m3'],1e-8)
        audit,snapshots=independent.trace_audit(trace,FIELD,frame,64);self.assertEqual(audit['refinements'],62);self.assertEqual(len(snapshots[64]),64)
if __name__=='__main__':unittest.main()
