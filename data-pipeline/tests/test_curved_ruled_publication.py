import csv
import hashlib
import json
from pathlib import Path
import sys
import unittest
import zipfile

import numpy as np

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'data-pipeline'))
from publish_curved_ruled_benchmark import verify,DEST
from curved_ruled_benchmark import make_curve_grid,curve_metrics

SHA=lambda b:hashlib.sha256(b).hexdigest()


class CurvedRuledPublicationTests(unittest.TestCase):
    def test_all_models_scripts_packages_and_unfavourable_pairs_are_bound(self):
        report,raw,audit,audit_raw=verify(DEST)
        summary=json.loads((ROOT/'shared/curved-ruled-comparison-v1.json').read_bytes())
        self.assertEqual(SHA(raw),summary['parent_report_sha256'])
        self.assertEqual(SHA(audit_raw),summary['native_audit_sha256'])
        self.assertEqual(SHA((ROOT/'data-pipeline/publish_curved_ruled_benchmark.py').read_text(encoding='utf8').replace('\r\n','\n').encode()),summary['publisher_sha256'])
        self.assertEqual(len(audit['rows']),136)
        self.assertEqual(sum(r['hits'] for r in audit['rows']),557056)
        for name,h in summary['figures'].items():self.assertEqual(SHA((DEST/name).read_bytes()),h)
        self.assertEqual(SHA((DEST/'pairs.csv').read_bytes()),summary['pairs_csv_sha256'])
        with (DEST/'pairs.csv').open(encoding='utf8',newline='') as f:self.assertEqual(len(list(csv.DictReader(f))),81)
        for c in report['cases']:
            package=summary['packages'][c['id']];b=(DEST/package['filename']).read_bytes()
            self.assertEqual(len(b),package['bytes']);self.assertEqual(SHA(b),package['sha256'])
            with zipfile.ZipFile(DEST/package['filename']) as z:
                self.assertIsNone(z.testzip())
                names={f"{c['id']}/{m['filename']}" for m in c['baselines']+c['candidates']}
                self.assertTrue(names.issubset(set(z.namelist())))
                for name in names:self.assertEqual(z.read(name),(DEST/name).read_bytes())
        pairs=[p for c in report['cases'] for p in c['pairs'] if p['method']=='paper_l2_l1']
        self.assertEqual(sum(p['e2_reduction_percent']>0 for p in pairs),24)
        self.assertEqual(sum(p['e2_reduction_percent']<0 for p in pairs),3)

    def test_independent_high_order_integral_from_saved_bezier_coefficients(self):
        # 9x9 Gauss, independent explicit coefficient expansion; no production
        # field evaluator or patch evaluator. Integrates all saved curve models.
        summary=json.loads((ROOT/'shared/curved-ruled-comparison-v1.json').read_bytes())
        nodes,weights=np.polynomial.legendre.leggauss(9);nodes=(nodes+1)/2;weights=weights/2
        u,v=np.meshgrid(nodes,nodes,indexing='ij');ww=weights[:,None]*weights[None,:]
        for c in summary['cases']:
            for entry in c['candidates']:
                model=json.loads((DEST/c['id']/entry['filename']).read_bytes());sq=0.
                for p in model['patches']:
                    a,b=[np.array([model['points'][i] for i in p[k]]) for k in ('left','right')]
                    aa=a[0]+2*u[...,None]*(a[1]-a[0])+u[...,None]**2*(a[0]-2*a[1]+a[2])
                    bb=b[0]+2*u[...,None]*(b[1]-b[0])+u[...,None]**2*(b[0]-2*b[1]+b[2])
                    xyz=aa+v[...,None]*(bb-aa);x,y=xyz[...,0],xyz[...,1]
                    if c['polynomial']:
                        field=30+.0001*(x*x+y*y)+5e-7*x**4+8e-8*y**4
                    else:
                        q=c['q_matrix'];field=30+q[0][0]*x*x+(q[0][1]+q[1][0])*x*y+q[1][1]*y*y
                    controls=np.r_[a,b];span=controls[:,:2].max(axis=0)-controls[:,:2].min(axis=0)
                    sq+=np.sum((xyz[...,2]-field)**2*ww)*np.prod(span)
                self.assertAlmostEqual(float(np.sqrt(sq)),entry['e2_m2'],delta=1e-9*max(1,entry['e2_m2']))

    def test_quadratic_residual_closed_formula_and_shared_grid_continuity(self):
        q=np.array([[.004,.001],[.001,.0004]])
        for axis,nx,ny in [('x',4,8),('y',8,4)]:
            model,_=make_curve_grid(q,nx,ny,axis);metrics=curve_metrics(model,q)
            # Quadratic in the curve axis is exact, mixed term is exact;
            # only the linear across-axis chord contributes to residual.
            width=100/(ny if axis=='x' else nx);coefficient=q[1][1] if axis=='x' else q[0][0]
            expected_e2=100*coefficient*width**2/np.sqrt(30)
            self.assertAlmostEqual(metrics['e2_m2'],expected_e2,delta=1e-10)
            self.assertGreaterEqual(metrics['continuous_bound_m'],coefficient*width**2/4)
            boundaries={}
            for p in model['patches']:
                for key in ('left','right'):
                    pts=tuple(tuple(model['points'][i]) for i in p[key])
                    xy=tuple((p[0],p[1]) for p in pts)
                    if xy in boundaries:self.assertEqual(pts,boundaries[xy])
                    boundaries[xy]=pts


if __name__=='__main__':unittest.main()
