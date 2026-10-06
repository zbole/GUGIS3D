import json,sys,unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import diagonal_hybrid_math as d
import hybrid_source_math as old
from source_band_benchmark import binary
BASE=json.loads((Path(__file__).resolve().parents[2]/'frontend/public/research/source-native-bands-v1/manchester-centre/reference.json').read_bytes())
def reference(z):return {**BASE,'height':np.asarray(z,dtype=np.float32).astype(float).tolist()}
class DiagonalControl(unittest.TestCase):
    def test_positive_diagonal_ridge_eliminates_a_weak_fixed_diagonal_control(self):
        x,y=np.meshgrid(np.arange(65),np.arange(65));ref=reference(np.minimum(x,y));cells=d.cells(ref,1,1,{},{})[0];self.assertLess(cells['plus']['l2_squared'],cells['minus']['l2_squared']/1000);self.assertLess(cells['plus']['l2_squared'],cells['ruled']['l2_squared']/1000);self.assertAlmostEqual(cells['plus']['maximum_m'],.25)
        a=d.grid(ref,1,1,{},{})
        for method in ['p1-local','hybrid-local']:self.assertEqual(a[method][1]['families'],['plus']);self.assertEqual(a[method][0]['patches'][0]['indices'],[2,0,3,1])
    def test_mirror_diagonal_extrema_and_integrals_agree_under_reflection(self):
        x,y=np.meshgrid(np.arange(65),np.arange(65));ref=reference(np.minimum(x,y)+x*y/128);a=d.cells(ref,4,8,{},{})
        mirrored=d.reflected(ref);b=d.cells(mirrored,4,8,{},{})
        for j in range(8):
            for i in range(4):
                original=a[j*4+i]['plus'];opposite=b[j*4+3-i]['minus'];self.assertAlmostEqual(original['l2_squared'],opposite['l2_squared']);self.assertEqual(original['witness_xy'],[-opposite['witness_xy'][0],opposite['witness_xy'][1]])
    def test_bilinear_source_stays_native_ruled_and_theoretically_equal_p1_diagonals_do_not_create_costly_spurious_switches(self):
        x,y=np.meshgrid(np.arange(65),np.arange(65));ref=reference(20+x/8+y/4+x*y/128);g=d.grid(ref,64,64,{},{})
        self.assertEqual(set(g['hybrid-local'][1]['families']),{'ruled'});self.assertEqual(g['hybrid-local'][1]['e2_m2'],0);self.assertEqual(set(g['p1-local'][1]['families']),{'minus'});self.assertEqual(g['p1-local'][1]['binary_bytes'],135528)
        self.assertEqual(binary(g['p1-local'][0]),binary(old.make_model(ref,64,64,['p1']*4096)))
    def test_orientation_changes_add_real_records_and_index_bytes(self):
        ref=reference(np.zeros((65,65)));fixed=d.make_model(ref,4,1,['minus']*4);mixed=d.make_model(ref,4,1,['minus','plus','minus','plus']);self.assertEqual(len(fixed['patches']),1);self.assertEqual(len(mixed['patches']),4);self.assertEqual(len(binary(mixed))-len(binary(fixed)),60)
    def test_invalid_grid_and_family_are_rejected(self):
        ref=reference(np.zeros((65,65)))
        for nx,ny,families in [(3,1,['minus']*3),(1,1,['unknown']),(2,1,['plus'])]:
            with self.assertRaises(ValueError):d.make_model(ref,nx,ny,families)
if __name__=='__main__':unittest.main()
