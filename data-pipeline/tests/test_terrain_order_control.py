import csv
import json
from pathlib import Path
import struct
import sys
import unittest
import zipfile

import numpy as np

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'data-pipeline'))
from publish_terrain_order_control import verify,DEST
from terrain_order_control import digest,binary_bytes,lagrange_weights,multi_indices


class TerrainOrderControlTests(unittest.TestCase):
    def test_complete_models_binary_envelopes_packages_and_negative_control(self):
        report,raw,audit,audit_raw=verify(DEST)
        summary=json.loads((ROOT/'shared/terrain-order-control-v1.json').read_bytes())
        self.assertEqual(summary['parent_report_sha256'],digest(raw));self.assertEqual(summary['native_audit_sha256'],digest(audit_raw))
        self.assertEqual(summary['publisher_sha256'],digest((ROOT/'data-pipeline/publish_terrain_order_control.py').read_text(encoding='utf8').replace('\r\n','\n').encode()))
        self.assertEqual(len(audit['rows']),86);self.assertEqual(sum(r['hits'] for r in audit['rows']),352256)
        for name,h in summary['figures'].items():self.assertEqual(digest((DEST/name).read_bytes()),h)
        self.assertEqual(summary['order_pairs_csv_sha256'],digest((DEST/'order-pairs.csv').read_bytes()))
        with (DEST/'order-pairs.csv').open(encoding='utf8',newline='') as f:
            rows=list(csv.DictReader(f));self.assertEqual(len(rows),27);self.assertTrue(all(r['verdict']=='p2-lower' for r in rows))
        for c in report['cases']+report['structure_fixtures']:
            package=summary['packages'][c['id']];b=(DEST/package['filename']).read_bytes()
            self.assertEqual(len(b),package['bytes']);self.assertEqual(digest(b),package['sha256'])
            with zipfile.ZipFile(DEST/package['filename']) as z:
                self.assertIsNone(z.testzip())
                for name in z.namelist():self.assertEqual(z.read(name),(DEST/name).read_bytes())
        for c in report['structure_fixtures']:
            a,b=c['ruled'],c['triangles'];self.assertTrue(c['both_numerically_exact'])
            self.assertEqual(a['binary_bytes'],196)
            self.assertEqual(b['binary_bytes'],304 if c['triangle_degree']==2 else 504)
            for e in [a,b]:
                model=json.loads((DEST/c['id']/e['filename']).read_bytes());encoded=(DEST/c['id']/e['binary_filename']).read_bytes()
                self.assertEqual(encoded,binary_bytes(model))
                magic,version,points,patches=struct.unpack('<4sIII',encoded[:16])
                self.assertEqual((magic,version,points,patches),(b'GOC2',2,len(model['points']),len(model['patches'])))

    def test_independent_monomial_interpolation_and_11node_integration(self):
        # Independent Vandermonde solve, not the production Lagrange basis.
        report=json.loads((DEST/'results.json').read_bytes())
        uv=np.array([[0,0],[.5,0],[0,.5],[1,0],[.5,.5],[0,1]])
        mono=lambda u,v:np.stack([np.ones_like(u),u,v,u*u,u*v,v*v],axis=-1)
        inv=np.linalg.inv(mono(uv[:,0],uv[:,1]))
        t,w=np.polynomial.legendre.leggauss(11);t=(t+1)/2;w=w/2;u,v=np.meshgrid(t,t,indexing='ij');v=(1-u)*v
        basis=mono(u,v).reshape(-1,6);bary=np.stack([1-u-v,u,v],axis=-1).reshape(-1,3)
        weight=(w[:,None]*w[None,:]*(1-u)).ravel()
        for c in report['cases']:
            for e in c['p2_models']:
                model=json.loads((DEST/c['id']/e['filename']).read_bytes());xyz=np.asarray(model['points'])[np.array([p['nodes'] for p in model['patches']])]
                coeff=np.einsum('ij,tj->ti',inv,xyz[:,:,2]);z=coeff@basis.T;tri=xyz[:,[0,3,5],:2];xy=np.einsum('qi,tij->tqj',bary,tri)
                x,y=xy[:,:,0],xy[:,:,1]
                if c['polynomial']:reference=30+.0001*(x*x+y*y)+5e-7*x**4+8e-8*y**4
                else:
                    q=c['q_matrix'];reference=30+q[0][0]*x*x+2*q[0][1]*x*y+q[1][1]*y*y
                b,a=tri[:,1]-tri[:,0],tri[:,2]-tri[:,0];det=b[:,0]*a[:,1]-b[:,1]*a[:,0]
                expected=float(np.sqrt(np.sum((z-reference)**2*weight[None,:]*det[:,None])))
                self.assertAlmostEqual(expected,e['e2_m2'],delta=1e-9*max(1,e['e2_m2']))

    def test_lagrange_partition_unity_kronecker_and_polynomial_reproduction(self):
        rng=np.random.default_rng(728)
        points=rng.dirichlet([1,1,1],100)
        for degree in [2,3]:
            nodes=np.asarray(multi_indices(degree))/degree
            self.assertTrue(np.allclose(lagrange_weights(nodes,degree),np.eye(len(nodes)),atol=1e-13))
            weights=lagrange_weights(points,degree)
            self.assertTrue(np.allclose(weights.sum(axis=1),1,atol=1e-13))
            for a in range(degree+1):
                for b in range(degree+1-a):
                    nodal=nodes[:,1]**a*nodes[:,2]**b
                    self.assertTrue(np.allclose(weights@nodal,points[:,1]**a*points[:,2]**b,atol=1e-13))


if __name__=='__main__':unittest.main()
