import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.environment_models import Terrain
from app.services.terrain_compaction import compact_strips,primitives,primitive_sha256


def chain(n):
    points=[[x,y,.1*x*y] for x in range(n+1) for y in (0,1)]
    return Terrain(name='Test',longitude=0,latitude=0,vertical_datum='local',reference_height=0,
        source={},demonstration=True,points=points,
        patches=[{'id':f'q{i}','kind':'ruled-strip','left':[2*i,2*i+2],'right':[2*i+1,2*i+3]} for i in range(n)])


class TerrainCompactionTest(unittest.TestCase):
    def test_long_boundary_budget_and_all_functions_preserved(self):
        before=chain(130);after,stats=compact_strips(before)
        self.assertEqual([len(p.left) for p in after.patches],[128,4])
        self.assertEqual(primitives(before),primitives(after))
        self.assertEqual(before.points,after.points)
        self.assertEqual(primitive_sha256(before),stats['primitive_sha256'])
        self.assertFalse(stats['patch_ids_preserved'])

    def test_small_budget_and_deterministic_regrouping(self):
        before=chain(7);a,_=compact_strips(before,max_boundary=3);b,_=compact_strips(before,max_boundary=3)
        self.assertEqual(len(a.patches),4)
        self.assertEqual(a,b)
        self.assertEqual(primitives(before),primitives(a))

    def test_mixed_triangle_winding_and_no_bridge(self):
        data=chain(4).model_dump(exclude_none=True)
        data['patches'][1]={'id':'a','kind':'triangle-strip','indices':[2,4,3,5]}
        before=Terrain.model_validate(data);after,stats=compact_strips(before)
        self.assertEqual(primitives(before),primitives(after))
        self.assertEqual(stats['ruled_quads'],3)
        self.assertEqual(stats['triangle_faces'],2)
        self.assertEqual(stats['ruled_strips'],2)
        for patch in after.patches:
            if patch.kind=='ruled-strip':self.assertLessEqual(len(patch.left),128)

    def test_invalid_limits_and_fans_refused(self):
        for key,value in [('max_boundary',True),('max_boundary',129),('max_indices',True),('max_indices',257)]:
            with self.assertRaises(ValueError):compact_strips(chain(2),**{key:value})
        data=chain(1).model_dump(exclude_none=True)
        data['points']=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[.5,.5,0]]
        data['patches']=[{'id':'f','kind':'triangle-fan','hub':4,'ring':[0,1,2,3]}]
        with self.assertRaises(ValueError):compact_strips(data)


if __name__=='__main__':unittest.main()
