from pathlib import Path
import sys
import unittest
import numpy as np
from app.services.terrain_hybrid import adaptive_grid
from app.environment_models import Terrain

pipeline=Path(__file__).resolve().parents[2]/'data-pipeline'
sys.path.insert(0,str(pipeline))
try:
    from build_hybrid_research import quadratic_certificate, quadratic_triangle_error
finally:
    sys.path.remove(str(pipeline))


class HybridTerrainTests(unittest.TestCase):
    def setUp(self):
        self.axis=np.linspace(-100,100,17)
        self.x,self.y=np.meshgrid(self.axis,self.axis)

    def test_steep_plane_does_not_force_triangles_or_refinement_based_on_slope(self):
        z=20+.6*self.x+.3*self.y
        for mode in ('hybrid','triangles'):
            t,r,p=adaptive_grid(self.axis,self.axis,z,mode=mode,tolerance=.1,
                cell_certificate=quadratic_certificate([[0,0],[0,0]]))
            self.assertTrue(r['target_met']);self.assertEqual(len(t.points),4)
            np.testing.assert_allclose(p,z,atol=1e-12)

    def test_finite_scale_saddle_saves_controls_without_source_grid_aliasing(self):
        z=20+.004*self.x*self.y;certificate=quadratic_certificate([[0,.004],[.004,0]])
        hybrid,hr,hp=adaptive_grid(self.axis,self.axis,z,tolerance=.25,cell_certificate=certificate)
        triangles,tr,tp=adaptive_grid(self.axis,self.axis,z,mode='triangles',tolerance=.25,cell_certificate=certificate)
        self.assertTrue(hr['target_met']);self.assertTrue(tr['target_met'])
        self.assertEqual(hr['points'],4);self.assertEqual(hr['ruled_patches'],1)
        self.assertGreater(tr['points'],hr['points'])
        self.assertLessEqual(tr['max_selection_bound_m'],.25)
        np.testing.assert_allclose(hp,z,atol=1e-12)
        for record in hr['diagnostics']:
            self.assertAlmostEqual(record['mother_error'],0)
            self.assertAlmostEqual(record['boundary_error'],0)

    def test_convex_separable_bowl_reports_equal_cost_instead_of_forced_advantage(self):
        z=20+.002*(self.x**2+1.5*self.y**2);certificate=quadratic_certificate([[.004,0],[0,.006]])
        a,ra,pa=adaptive_grid(self.axis,self.axis,z,tolerance=.5,cell_certificate=certificate)
        b,rb,pb=adaptive_grid(self.axis,self.axis,z,mode='triangles',tolerance=.5,cell_certificate=certificate)
        self.assertTrue(ra['target_met']);self.assertTrue(rb['target_met'])
        self.assertEqual(a.model_dump(),b.model_dump());self.assertEqual(ra['native_bytes'],rb['native_bytes'])

    def test_missing_samples_are_holes_and_shared_control_edges_are_valid(self):
        axis=np.arange(9,dtype=float);x,y=np.meshgrid(axis,axis);z=10+.1*x+.2*y;z[4,4]=np.nan
        t,r,p=adaptive_grid(axis,axis,z,tolerance=.1)
        self.assertTrue(r['target_met']);self.assertTrue(np.isnan(p[4,4]))
        self.assertGreater(r['covered_samples'],0);self.assertEqual(r['missing_samples'],1)
        self.assertFalse(any(point[:2]==[4,4] for point in t.points))
        self.assertEqual(Terrain.model_validate_json(t.model_dump_json()).model_dump(),t.model_dump())
        self.assertFalse(any(c['xy_bounds'][0]<4<c['xy_bounds'][2] and c['xy_bounds'][1]<4<c['xy_bounds'][3]
                             for c in r['diagnostics']))

    def test_budget_and_source_resolution_failures_do_not_claim_target_met(self):
        z=20+.002*(self.x**2+self.y**2)
        _,report,_=adaptive_grid(self.axis,self.axis,z,tolerance=.01,max_steps=0)
        self.assertFalse(report['target_met']);self.assertEqual(report['status'],'step-budget')
        _,report,_=adaptive_grid(self.axis,self.axis,z,tolerance=.01,max_points=4)
        self.assertFalse(report['target_met']);self.assertEqual(report['status'],'point-budget')
        axis=np.array([0,1.]);x,y=np.meshgrid(axis,axis)
        _,report,_=adaptive_grid(axis,axis,x*x+y*y,tolerance=.01,cell_certificate=quadratic_certificate([[2,0],[0,2]]))
        self.assertFalse(report['target_met']);self.assertEqual(report['status'],'source-resolution-limit')

    def test_exact_quadratic_triangle_bound_covers_interior_extrema(self):
        vertices=np.array([[0,0],[2,0],[.2,3.]])
        h=np.array([[3,.4],[.4,2.]])
        bound=quadratic_triangle_error(vertices,h)
        k=(vertices[1:]-vertices[0]).T
        for s in np.linspace(0,1,31):
            for t in np.linspace(0,1-s,31):
                p=vertices[0]+k@np.array([s,t])
                f=.5*p@h@p
                linear=(1-s-t)*(.5*vertices[0]@h@vertices[0])+s*(.5*vertices[1]@h@vertices[1])+t*(.5*vertices[2]@h@vertices[2])
                self.assertLessEqual(abs(f-linear),bound+1e-12)

    def test_invalid_coordinates_elevations_and_budgets_are_rejected(self):
        for kwargs in [{'tolerance':float('nan')},{'max_steps':True},{'max_points':3},{'mode':'fan'}]:
            with self.assertRaises(ValueError):adaptive_grid(self.axis,self.axis,20+self.x*0,**kwargs)
        with self.assertRaises(ValueError):adaptive_grid(self.axis[::-1],self.axis,20+self.x*0)


if __name__=='__main__':unittest.main()
