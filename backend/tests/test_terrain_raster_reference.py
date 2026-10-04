import sys,unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.services.terrain_raster_reference import RasterReference


class RasterReferenceTests(unittest.TestCase):
    def test_exact_saddle_extremum_inside_triangle_edge(self):
        reference=RasterReference([0,1],[0,1],[[0,0],[0,1]])
        p=np.asarray([[0,0],[1,0],[0,1]])
        self.assertAlmostEqual(reference.triangle_error(p),.25+reference.guard_m,places=12)

    def test_internal_raster_vertex_peak_is_not_missed(self):
        height=np.zeros((5,5));height[2,2]=3
        reference=RasterReference(np.arange(5),np.arange(5),height)
        p=np.asarray([[0,0],[4,0],[2,4]])
        self.assertAlmostEqual(reference.triangle_error(p),3+reference.guard_m,places=12)

    def test_plane_and_nonuniform_axes(self):
        x=np.asarray([-2,0,.3,5]);y=np.asarray([-1,.1,3]);xx,yy=np.meshgrid(x,y)
        reference=RasterReference(x,y,2+3*xx-yy)
        p=np.asarray([[-1,-.5],[4,-.5],[0,2]])
        self.assertLess(reference.triangle_error(p),1e-8)
        np.testing.assert_allclose(reference([0,5],[.1,3]),[1.9,14],rtol=0,atol=1e-12)
        self.assertFalse(reference.height.flags.writeable)

    def test_crossing_triangle_random_dense_reference_never_exceeds_bound(self):
        rng=np.random.default_rng(20261004)
        reference=RasterReference(np.linspace(-3,3,9),np.linspace(-2,2,7),rng.normal(size=(7,9)))
        for _ in range(30):
            p=rng.uniform([-3,-2],[3,2],size=(3,2))
            if abs(np.linalg.det(np.column_stack((p[1]-p[0],p[2]-p[0]))))<.01:continue
            weights=rng.dirichlet([1,1,1],size=5000);sites=weights@p
            controls=reference(p[:,0],p[:,1])
            error=np.abs(reference(sites[:,0],sites[:,1])-weights@controls)
            self.assertLessEqual(float(error.max()),reference.triangle_error(p))

    def test_invalid_and_outside_inputs_rejected(self):
        for x,y,z in [([0,0],[0,1],[[0,0],[0,0]]),([0,1],[0,1],[[0,float('nan')],[0,0]]),([0],[0,1],[[0],[0]])]:
            with self.assertRaises(ValueError):RasterReference(x,y,z)
        r=RasterReference([0,1],[0,1],[[0,0],[0,1]])
        with self.assertRaises(ValueError):r(2,0)
        with self.assertRaises(ValueError):r.triangle_error([[0,0],[1,0],[2,0]])

    def test_saved_control_rounding_and_each_quad_are_counted(self):
        r=RasterReference([0,1],[0,1],[[0,0],[0,1]])
        model={'points':[[0,0,.001],[1,0,.001],[0,1,.001]],
               'patches':[{'kind':'triangle-strip','indices':[0,1,2]}]}
        result=r.model_error(model)
        self.assertAlmostEqual(result['max_error_bound_m'],.251+r.guard_m,places=12)
        self.assertEqual(result['triangles_checked'],1)
        model={'points':[[0,0,0],[0,1,0],[1,0,0],[1,1,1]],
               'patches':[{'kind':'ruled-strip','left':[0,2],'right':[1,3]}]}
        result=r.model_error(model)
        self.assertEqual(result['quads_checked'],1)
        self.assertLess(result['max_error_bound_m'],1e-8)

    def test_cell_certificate_selects_ruled_saddle_at_subcell_tolerance(self):
        from app.services.terrain_hybrid import adaptive_grid
        r=RasterReference([0,1],[0,1],[[0,0],[0,1]])
        bounds=r.cell_certificate(0,1,0,1)
        self.assertLess(bounds['ruled'],1e-8)
        np.testing.assert_allclose(bounds['triangles'],[.25+r.guard_m]*2,rtol=0,atol=1e-12)
        terrain,stats,_=adaptive_grid(r.x,r.y,r.height,tolerance=.1,cell_certificate=r.cell_certificate)
        self.assertTrue(stats['target_met'])
        self.assertEqual(terrain.patches[0].kind,'ruled-strip')

    def test_rectangle_fast_certificate_matches_general_clipped_triangles(self):
        rng=np.random.default_rng(54);x=np.asarray([-2,-.3,0,.2,1,3]);y=np.asarray([-1,-.4,0,.9,2])
        r=RasterReference(x,y,rng.normal(size=(len(y),len(x))))
        for _ in range(30):
            i,j=sorted(rng.choice(len(x),2,replace=False));k,l=sorted(rng.choice(len(y),2,replace=False))
            xy=np.asarray([[x[i],y[k]],[x[j],y[k]],[x[i],y[l]],[x[j],y[l]]])
            expected=[max(r.triangle_error(xy[list(f)]) for f in faces) for faces in [[(0,1,3),(0,3,2)],[(0,1,2),(1,3,2)]]]
            np.testing.assert_allclose(r.cell_certificate(x[i],x[j],y[k],y[l])['triangles'],expected,rtol=0,atol=1e-10)


if __name__=='__main__':unittest.main()
