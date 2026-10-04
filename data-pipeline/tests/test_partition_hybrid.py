import unittest
from pathlib import Path
import sys
from collections import Counter
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'data-pipeline'))
from terrain_partition_hybrid import partition_hybrid,RasterReference


def edges(model):
    result=Counter()
    for patch in model.patches:
        if patch.kind=='ruled-strip':
            a,b,c,d=patch.left[0],patch.right[0],patch.left[1],patch.right[1]
            sides=[(a,b),(b,d),(d,c),(c,a)]
        else:
            face=patch.indices;sides=list(zip(face,face[1:]+face[:1]))
        for a,b in sides:result[tuple(sorted((a,b)))]+=1
    return result


class LocalPartitionTests(unittest.TestCase):
    def test_exact_saddle_keeps_one_ruled_cell_and_plane_does_not_overrefine(self):
        axis=np.arange(17)-8;xx,yy=np.meshgrid(axis,axis)
        for z in (20+.06*xx*yy,20+.2*xx+.1*yy):
            model,receipt=partition_hybrid(RasterReference(axis,axis,z),tolerance=.001)
            self.assertTrue(receipt['target_met']);self.assertEqual(len(model.points),4)
            self.assertEqual(receipt['local_cells'],1)
        self.assertEqual(model.patches[0].kind,'triangle-strip')

    def test_local_curvature_has_closed_shared_edges_no_fans_and_certified_error(self):
        axis=np.arange(17)-8;xx,yy=np.meshgrid(axis,axis)
        z=20+.03*xx*yy+3*np.exp(-((xx-4)**2+(yy-4)**2)/4)
        ref=RasterReference(axis,axis,z)
        source=ref.height.copy();model,receipt=partition_hybrid(ref,tolerance=.1)
        self.assertTrue(receipt['target_met'])
        self.assertGreater(receipt['boundary_triangulated_cells'],0)
        self.assertLessEqual(receipt['continuous_bound_m'],.1)
        self.assertTrue(all(p.kind in ('ruled-strip','triangle-strip') for p in model.patches))
        area=0.
        for patch in model.patches:
            for face in patch.faces():
                xyz=np.asarray([model.points[i][:2] for i in face])
                signed=np.linalg.det(np.column_stack((xyz[1]-xyz[0],xyz[2]-xyz[0])))/2
                self.assertGreater(signed,0);area+=signed
        self.assertAlmostEqual(area,16*16)
        for (a,b),count in edges(model).items():
            p,q=model.points[a],model.points[b]
            outer=any(p[i]==q[i] and abs(p[i])==8 for i in (0,1))
            self.assertEqual(count,1 if outer else 2,'every internal edge must have an exact partner')
        np.testing.assert_array_equal(ref.height,source)

    def test_budget_failure_remains_explicit_and_cannot_allocate_past_limit(self):
        axis=np.arange(9);xx,yy=np.meshgrid(axis,axis)
        ref=RasterReference(axis,axis,20+.1*xx**2+.1*yy**2)
        for kwargs,status in [({'max_steps':0},'step-budget'),({'max_points':4},'point-budget')]:
            model,receipt=partition_hybrid(ref,tolerance=.01,**kwargs)
            self.assertFalse(receipt['target_met']);self.assertEqual(receipt['status'],status)
            self.assertEqual(len(model.points),4)
        for kwargs in [{'tolerance':float('nan')},{'tolerance':True},{'max_steps':True},{'max_points':3}]:
            with self.assertRaises(ValueError):partition_hybrid(ref,**kwargs)


if __name__=='__main__':unittest.main()
