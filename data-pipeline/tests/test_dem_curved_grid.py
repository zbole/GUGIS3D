import json
from pathlib import Path
import sys
import unittest
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'data-pipeline'))
from dem_curved_grid_benchmark import make_model,compile_grid,metrics,reference_value

class DemCurvedGridTests(unittest.TestCase):
    def reference(self,field):
        x,y=np.meshgrid(np.arange(65)-32,np.arange(65)-32,indexing='xy')
        return {'x':list(range(-32,33)),'y':list(range(-32,33)),'height':field(x,y).tolist()}
    def test_whole_cell_bilinear_fields_are_preserved_at_native_source_density(self):
        ref=self.reference(lambda x,y:30+.001*x+.002*y+.00003*x*y)
        for axis in ('x','y'):
            model=make_model(ref,8,16,axis);result=metrics(ref,model,8,16,axis)
            self.assertLess(result['e2_m2'],1e-9);self.assertLess(result['maximum_residual_m'],1e-9)
            self.assertEqual(len(model['points']),(2*8+1)*(16+1) if axis=='x' else (8+1)*(2*16+1))
        with self.assertRaises(ValueError):make_model(ref,3,4,'x')
        with self.assertRaises(ValueError):reference_value(ref,32.001,0)
    def test_maximum_finds_a_stationary_point_inside_a_source_cell(self):
        ref=self.reference(lambda x,y:np.full_like(x,30,dtype=float));peak=.2453125
        for axis in ('x','y'):
            model=make_model(ref,1,1,axis)
            for patch in model['patches']:
                for key in ('left','right'):
                    samples=np.array([30-1+(s-peak)**2 for s in (0,.5,1)])
                    samples[1]=2*samples[1]-(samples[0]+samples[2])/2
                    for i,z in zip(patch[key],samples):model['points'][i][2]=float(z)
            r=metrics(ref,model,1,1,axis);self.assertAlmostEqual(r['maximum_residual_m'],1,places=12)
            w=r['maximum_witness'];self.assertAlmostEqual(w['x' if axis=='x' else 'y'],-16.3,places=9)
            q=compile_grid(model,1,1,axis);self.assertAlmostEqual(abs(float(q(w['x'],w['y']))-30),w['absolute_error_m'],places=12)
            self.assertAlmostEqual(r['e2_m2'],metrics(ref,model,1,1,axis,nodes=5)['e2_m2'],places=10)
    def test_saved_shared_edges_are_continuous_for_both_ruling_orientations(self):
        ref=self.reference(lambda x,y:30+np.sin(x/9)+.1*np.cos(y/7));nx,ny=4,8
        for axis in ('x','y'):
            model=make_model(ref,nx,ny,axis);q=compile_grid(model,nx,ny,axis)
            for x in (-16.,0.,16.):
                for y in (-31.3,-17.1,8.2,31.2):self.assertLess(abs(float(q(x-1e-8,y)-q(x+1e-8,y))),1e-8)
            for y in np.arange(7)*8-24:
                for x in (-31.3,-17.1,8.2,31.2):self.assertLess(abs(float(q(x,y-1e-8)-q(x,y+1e-8))),1e-8)
            r=metrics(ref,model,nx,ny,axis);self.assertAlmostEqual(r['e2_m2'],metrics(ref,model,nx,ny,axis,nodes=5)['e2_m2'],places=10)

if __name__=='__main__':unittest.main()
