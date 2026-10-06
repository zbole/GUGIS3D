import math
from pathlib import Path
import sys
import unittest
import numpy as np
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'data-pipeline'))
from source_band_benchmark import make_models,binary,grid_binary,integration,p1_closed_metrics
class SourceBandTests(unittest.TestCase):
    def reference(self,field):
        x,y=np.meshgrid(np.arange(65)-32,np.arange(65)-32,indexing='xy');z=field(x,y).astype(np.float32).astype(float)
        return {'x':list(range(-32,33)),'y':list(range(-32,33)),'height':z.tolist(),'origin_bng':[383805.5,398336.5]}
    def test_complete_georeferenced_file_counts_include_all_real_source_controls(self):
        ref=self.reference(lambda x,y:30+x/64+y/128+x*y/4096);m=make_models(ref)
        self.assertEqual((len(m['ruled']['points']),len(m['ruled']['patches'])),(4225,64));self.assertEqual((len(m['source_p2']['points']),len(m['source_p2']['patches'])),(16641,8192))
        self.assertEqual(len(binary(m['ruled'])),135528);self.assertEqual(len(binary(m['source_p1'])),135528);self.assertEqual(len(binary(m['source_p2'])),694376);self.assertEqual(len(grid_binary(ref)),16980)
        self.assertLess(len(grid_binary(ref)),len(binary(m['ruled'])));self.assertGreater(100*(1-len(binary(m['ruled']))/len(binary(m['source_p2']))),80)
    def test_saved_bands_and_p2_triangles_preserve_the_complete_cellwise_bilinear_function(self):
        ref=self.reference(lambda x,y:30+x/64+y/128+x*y/4096);m=make_models(ref)
        for family in ('ruled','source_p2'):
            a=integration(ref,m[family],3);b=integration(ref,m[family],5);self.assertEqual(a['integrated_area_m2'],4096);self.assertLess(a['e2_m2'],1e-8);self.assertLess(b['e2_m2'],1e-8)
        measured=integration(ref,m['source_p1'],3);exact=p1_closed_metrics(ref);self.assertAlmostEqual(measured['e2_m2'],exact['e2_m2'],places=10)
        self.assertAlmostEqual(exact['e2_m2'],64/4096/math.sqrt(90),places=10);self.assertAlmostEqual(exact['maximum_residual_m'],1/4096/4,places=10)
    def test_p2_cell_centre_nodes_use_true_source_bilinear_height_not_diagonal_endpoint_average(self):
        ref=self.reference(lambda x,y:30+x*y/16);m=make_models(ref);triangle=m['source_p2']['patches'][0];z=[m['source_p2']['points'][i][2] for i in triangle['indices']]
        self.assertNotEqual(z[4],(z[3]+z[5])/2)
        self.assertAlmostEqual(z[4],30+(-31.5)*(-31.5)/16)
        for a,b in zip(m['ruled']['patches'],m['ruled']['patches'][1:]):self.assertEqual(a['right'],b['left'])

if __name__=='__main__':unittest.main()
