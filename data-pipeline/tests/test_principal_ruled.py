import ast
from collections import Counter
import math
from pathlib import Path
import sys
import unittest
import numpy as np
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'data-pipeline'))
from principal_ruled_benchmark import principal_frame,ruled_model,ruled_metrics,paper_snapshots,binary
from paper_metric_benchmark import run
from research_triangle_strips import pack_triangle_strips
from principal_order_control import make_control,control_binary,control_metrics

class PrincipalRuledTests(unittest.TestCase):
    def test_directed_strip_packer_matches_frozen_backend_and_preserves_all_faces(self):
        def function(path):return next(n for n in ast.parse(path.read_text(encoding='utf8')).body if isinstance(n,ast.FunctionDef) and n.name=='pack_triangle_strips')
        self.assertEqual(ast.dump(function(ROOT/'backend/app/services/terrain_triangles.py')),ast.dump(function(ROOT/'data-pipeline/research_triangle_strips.py')))
        faces=[(0,1,2),(2,1,3),(2,3,4),(4,3,5),(8,9,10)]
        canonical=lambda t:min(t,t[1:]+t[:1],t[2:]+t[:2])
        for cap in (3,4,256):
            emitted=[]
            for s in pack_triangle_strips(faces,cap):
                for i in range(len(s)-2):
                    a,b,c=s[i:i+3];emitted.append((a,c,b) if i%2 else (a,b,c))
            self.assertEqual(Counter(map(canonical,emitted)),Counter(map(canonical,faces)))
    def test_snapshots_match_original_paper_style_priority_and_edge_decisions(self):
        theta=math.pi/6;r=np.array([[math.cos(theta),-math.sin(theta)],[math.sin(theta),math.cos(theta)]]);q=r@np.diag([.004,.00004])@r.T
        budgets=(8,32,128);rows,_,mesh=run(q,'paper_l2_l1',budgets);snapshots=paper_snapshots(q,budgets)
        self.assertEqual([stats for m,stats in snapshots],rows)
        m=snapshots[-1][0];out=[]
        for patch in m['patches']:
            s=patch['indices']
            for j in range(len(s)-2):out.append(sorted(tuple(m['points'][i][:2]) for i in s[j:j+3]))
        self.assertEqual(sorted(out),sorted(sorted(map(tuple,t)) for t in mesh))
    def test_principal_frame_and_clipped_integral_cover_the_same_square_at_all_fixed_angles(self):
        for angle in (0,15,30,45,60,75,90):
            t=math.radians(angle);r=np.array([[math.cos(t),-math.sin(t)],[math.sin(t),math.cos(t)]]);q=r@np.diag([.004,.00004])@r.T;frame,eigen=principal_frame(q)
            np.testing.assert_allclose(frame.T@frame,np.eye(2),atol=1e-14);np.testing.assert_allclose(frame.T@q@frame,np.diag([.004,.00004]),atol=1e-16)
            m=ruled_model(q,frame,8);a=ruled_metrics(m,q,3);b=ruled_metrics(m,q,5)
            self.assertAlmostEqual(a['integrated_area_m2'],10000,places=7);self.assertAlmostEqual(a['e2_m2'],b['e2_m2'],places=9)
            self.assertEqual(len(binary(m)),48+24*len(m['points'])+36*len(m['patches']))
            if angle in (0,90):self.assertAlmostEqual(a['e2_m2'],100*.00004*(100/8)**2/math.sqrt(30),places=9)
            w=a['maximum_witness'];self.assertTrue(-50-1e-10<=w['x']<=50+1e-10 and -50-1e-10<=w['y']<=50+1e-10)
    def test_shared_oriented_boundaries_and_midpoint_controls_retain_native_function(self):
        r=np.array([[math.sqrt(.5),-math.sqrt(.5)],[math.sqrt(.5),math.sqrt(.5)]]);q=r@np.diag([.004,.00004])@r.T;m=ruled_model(q,r,16)
        for a,b in zip(m['patches'],m['patches'][1:]):self.assertEqual(a['right'],b['left'])
        self.assertEqual(len(m['points']),3*17)
    def test_same_codec_p2_control_preserves_the_global_quadratic_with_nine_shared_nodes(self):
        for angle in (0,15,30,45,60,75,90):
            t=math.radians(angle);r=np.array([[math.cos(t),-math.sin(t)],[math.sin(t),math.cos(t)]]);q=r@np.diag([.004,.00004])@r.T;m=make_control(q)
            self.assertEqual(len(m['points']),9);self.assertEqual(len(m['patches']),2);self.assertEqual(len(control_binary(m)),336)
            self.assertLess(control_metrics(m,q,3)['e2_m2'],1e-8);self.assertLess(control_metrics(m,q,5)['e2_m2'],1e-8)
            self.assertEqual(len(set(m['patches'][0]['indices'])&set(m['patches'][1]['indices'])),3)

if __name__=='__main__':unittest.main()
