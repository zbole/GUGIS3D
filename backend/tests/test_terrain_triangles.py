from pathlib import Path
import sys
import unittest
from collections import Counter
import numpy as np
from app.services.terrain_triangles import local_triangles, l1_interpolation, pack_triangle_strips
from app.environment_models import TerrainPatch

pipeline=Path(__file__).resolve().parents[2]/'data-pipeline'
sys.path.insert(0,str(pipeline))
try:
    from build_hybrid_research import quadratic_triangle_error
    from build_local_triangle_research import triangle_certificate
finally:
    sys.path.remove(str(pipeline))


def triangles(strips):
    result=[]
    for ids in strips:
        for f in TerrainPatch(id='test',kind='triangle-strip',indices=ids).faces():
            result.append(min(f,f[1:]+f[:1],f[2:]+f[:2]))
    return Counter(result)


class LocalTriangleTests(unittest.TestCase):
    def test_longest_edge_reference_strategy_is_explicit(self):
        from app.services.terrain_raster_reference import RasterReference
        reference=RasterReference([0,1],[0,1],[[0,0],[0,1]])
        terrain,stats=local_triangles([0,0,1,1],reference,reference.triangle_error,tolerance=.05,edge_decision='longest-edge')
        self.assertTrue(stats['target_met'])
        self.assertEqual(stats['edge_decision'],'longest-edge')
        self.assertIn('not the paper',stats['decision'])
        self.assertLessEqual(reference.model_error(terrain.model_dump(exclude_none=True))['max_error_bound_m'],.05)

    def test_geometry_floor_returns_valid_incomplete_mesh(self):
        terrain,stats=local_triangles([0,0,.001,.001],lambda x,y:np.zeros_like(x),lambda p:1.,
            tolerance=.1,max_steps=1000,edge_decision='longest-edge')
        self.assertFalse(stats['target_met'])
        self.assertEqual(stats['status'],'geometry-resolution-limit')
        self.assertGreaterEqual(stats['max_bound_m'],1.)
        self.assertTrue(terrain.patches)

    def test_longest_edge_neighbor_preparation_avoids_needles_on_raster_creases(self):
        from app.services.terrain_raster_reference import RasterReference
        rng=np.random.default_rng(63);reference=RasterReference(np.arange(5),np.arange(5),rng.normal(size=(5,5)))
        terrain,stats=local_triangles([0,0,4,4],reference,reference.triangle_error,tolerance=.03,edge_decision='longest-edge')
        self.assertTrue(stats['target_met'])
        self.assertGreater(stats['longest_edge_preparation_splits'],0)
        for patch in terrain.patches:
            for face in patch.faces():
                p=np.asarray([terrain.points[i][:2] for i in face])
                cross=abs(np.linalg.det(np.column_stack((p[1]-p[0],p[2]-p[0]))))
                longest=max(float(np.dot(a-b,a-b)) for a,b in zip(p,np.roll(p,-1,axis=0)))
                self.assertLessEqual(longest/cross,4.000001)

    def test_plane_remains_two_faces_and_one_compact_strip(self):
        t,r=local_triangles([-10,-10,10,10],lambda x,y:20+.4*x-.2*y,lambda p:0)
        self.assertEqual(r['points'],4);self.assertEqual(r['triangles'],2)
        self.assertEqual(r['patches'],1);self.assertTrue(r['target_met'])
        self.assertEqual(len(list(t.patches[0].faces())),2)

    def test_convex_quadratic_uses_exact_l1_and_closure_without_hanging_nodes(self):
        f=lambda x,y:20+.002*x*x+.006*y*y
        hessian=[[.004,0],[0,.012]]
        t,r=local_triangles([-10,-10,10,10],f,lambda p:quadratic_triangle_error(p,hessian),tolerance=.03,convex=True)
        self.assertTrue(r['target_met']);self.assertGreater(r['closure_splits'],0)
        self.assertEqual(r['decision'],'Exact convex L1 reduction')
        points=np.asarray(t.points)
        area=0
        for patch in t.patches:
            for face in patch.faces():
                p=points[list(face),:2]
                determinant=np.linalg.det(np.column_stack((p[1]-p[0],p[2]-p[0])))
                self.assertGreater(determinant,0);area+=determinant/2
                self.assertLessEqual(quadratic_triangle_error(p,hessian)+5e-6,.03)
                for a,b in zip(face,face[1:]+face[:1]):
                    v=points[b,:2]-points[a,:2];w=points[:,:2]-points[a,:2]
                    cross=w[:,0]*v[1]-w[:,1]*v[0];projection=w@v
                    interior=(projection>1e-9)&(projection<(v@v)-1e-9)
                    self.assertFalse(np.any((np.abs(cross)<1e-9)&interior))
        self.assertAlmostEqual(area,400)

    def test_positive_quadrature_matches_exact_convex_quadratic_integral(self):
        xy=np.array([[0.,0.],[2.,0.],[0.,3.]])
        # f=x²+y²: area/12 times sum of squared edge lengths.
        actual=l1_interpolation(xy,lambda x,y:x*x+y*y)
        self.assertAlmostEqual(actual,3/12*(4+9+13),places=11)

    def test_strip_packing_preserves_oriented_faces_and_length_limits(self):
        faces=[(0,1,3),(0,3,2),(1,4,5),(1,5,3)]
        expected=Counter(min(f,f[1:]+f[:1],f[2:]+f[:2]) for f in faces)
        for limit in (3,4,256):
            strips=pack_triangle_strips(faces,limit)
            self.assertTrue(all(len(s)<=limit for s in strips))
            self.assertEqual(triangles(strips),expected)

    def test_resource_limits_leave_a_conforming_mesh_without_claiming_success(self):
        f=lambda x,y:20+.01*(x*x+y*y)
        bound=lambda p:quadratic_triangle_error(p,[[.02,0],[0,.02]])
        for options,status in [({'max_steps':0},'step-budget'),({'max_points':5},'point-budget')]:
            t,r=local_triangles([-10,-10,10,10],f,bound,tolerance=.001,convex=True,**options)
            self.assertFalse(r['target_met']);self.assertEqual(r['status'],status)
            self.assertEqual(sum(len(list(p.faces())) for p in t.patches),r['triangles'])
            self.assertLessEqual(r['points'],options.get('max_points',30000))

    def test_invalid_domains_callbacks_and_false_convex_promises_are_rejected(self):
        f=lambda x,y:20+.01*(x*x+y*y)
        for domain in ([0,0,0,1],[0,0,float('nan'),1],[0,0,1.000001,1]):
            with self.assertRaises(ValueError):local_triangles(domain,f,lambda p:1)
        for error in (-1,float('nan'),True):
            with self.assertRaises(ValueError):local_triangles([0,0,1,1],f,lambda p:error)
        with self.assertRaisesRegex(ValueError,'convex'):
            local_triangles([-10,-10,10,10],lambda x,y:20-.01*(x*x+y*y),lambda p:1,convex=True)

    def test_rotating_nonconvex_case_avoids_short_edge_stagnation_and_xy_rounding(self):
        f=lambda x,y:20+1e-7*(x*x-y*y)**2
        t,r=local_triangles([-100,-100,100,100],f,triangle_certificate('rotating-direction',f),tolerance=.1)
        self.assertTrue(r['target_met']);self.assertLessEqual(r['max_bound_m']+5e-6,.1)
        self.assertGreater(r['longest_edge_safeguards'],0)
        self.assertTrue(any(abs(p[0]-round(p[0],5))>1e-9 or abs(p[1]-round(p[1],5))>1e-9 for p in t.points))


if __name__=='__main__':unittest.main()
