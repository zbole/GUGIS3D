import importlib.util
import json
import math
from pathlib import Path
import unittest

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("paper_metrics", ROOT/"data-pipeline/paper_metric_benchmark.py")
bench = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bench)


class PaperMetricsTests(unittest.TestCase):
    def test_integrals_independent_gauss_quadrature(self):
        p = np.array([[1., 2.], [7., 3.], [-1., 6.]])
        q = np.array([[.2, .07], [.07, .05]])
        expected = bench.metrics(p, q)
        # Duffy transform of tensor Gauss quadrature; independent direct interpolation.
        nodes, weights = np.polynomial.legendre.leggauss(8)
        nodes, weights = (nodes+1)/2, weights/2
        z = np.einsum("ij,jk,ik->i", p, q, p) + 10 + p @ [3., -2.]
        l1, l2 = 0., 0.
        for u, wu in zip(nodes, weights):
            for v, wv in zip(nodes, weights):
                bary = np.array([1-u-(1-u)*v, u, (1-u)*v])
                point = bary @ p
                gap = float(bary @ z - (point @ q @ point + 10 + point @ [3., -2.]))
                weight = wu*wv*(1-u)*2*expected["area"]
                l1 += gap*weight
                l2 += gap*gap*weight
        self.assertAlmostEqual(l1, expected["l1"], places=11)
        self.assertAlmostEqual(l2, expected["l2_squared"], places=11)

    def test_supremum_interior_and_boundary(self):
        p = np.array([[0., 0.], [1., 0.], [.5, math.sqrt(3)/2]])
        self.assertAlmostEqual(bench.metrics(p, np.eye(2))["linf"], 1/3)
        right = np.array([[0., 0.], [1., 0.], [0., 1.]])
        self.assertAlmostEqual(bench.metrics(right, np.eye(2))["linf"], .5)

    def test_shape_affine_invariance(self):
        p = np.array([[0., 0.], [1., 0.], [.4, .8]])
        q = np.array([[2., .3], [.3, 1.]])
        transform = np.array([[3., .2], [-.4, .7]])
        before = bench.metrics(p @ transform.T, q)
        after = bench.metrics(p, transform.T @ q @ transform)
        self.assertAlmostEqual(before["rho"], after["rho"])
        self.assertAlmostEqual(before["sigma"], after["sigma"])

    def test_l1_choice_is_q_longest_not_euclidean(self):
        p = np.array([[0., 0.], [2., 0.], [0., 1.]])
        q = np.array([[1., -1.], [-1., 5.]])
        choice = bench.choose_edge(p, q, "paper_l2_l1")
        ds = np.einsum("ij,jk,ik->i", p[[1,2,0]]-p, q, p[[1,2,0]]-p)
        self.assertEqual(choice, int(np.argmax(ds)))
        for edge in range(3):
            children = bench.bisect(p, edge)
            self.assertAlmostEqual(sum(bench.metrics(c,q)["area"] for c in children), 1.)
            for child in children:
                gap = bench.metrics(child,q)["linf"]
                self.assertLessEqual(gap, bench.metrics(p,q)["linf"] + 1e-12)

    def test_published_values_recompute_and_domain_partition(self):
        report = json.loads((ROOT/"shared/paper-terrain-metrics.json").read_text(encoding="utf-8"))
        self.assertEqual(report["source_sha256"], bench.source_hash())
        for case in report["cases"]:
            q = case.get('polynomial') or np.array(case["q_matrix"])
            for method in case["methods"]:
                rows, slope, _ = bench.run(q, method["id"])
                self.assertEqual(rows, method["rows"])
                self.assertEqual(slope, method["observed_e2_slope"])
                self.assertEqual([r["triangles"] for r in rows], list(bench.BUDGETS))
                self.assertTrue(all(a["e2_m2"] >= b["e2_m2"] for a,b in zip(rows,rows[1:])))
                self.assertTrue(all(math.isclose(r["rms_m"], r["e2_m2"]/100) for r in rows))

    def test_terminal_meshes_cover_domain_once_at_independent_points(self):
        report=json.loads((ROOT/'shared/paper-terrain-metrics.json').read_bytes())
        probes=np.random.default_rng(916).uniform(-49.99,49.99,(257,2))
        for case in report['cases']:
            for method in case['methods']:
                mesh=json.loads((ROOT/'frontend/public/research/paper-metrics'/method['mesh_filename']).read_bytes())
                triangles=np.array(mesh['triangles']);a=triangles[:,0]
                inverses=np.linalg.inv(np.stack((triangles[:,1]-a,triangles[:,2]-a),axis=-1))
                uv=np.einsum('tij,tpj->tpi',inverses,probes[None,:,:]-a[:,None,:])
                inside=(uv[:,:,0]>0)&(uv[:,:,1]>0)&(uv.sum(axis=2)<1)
                self.assertTrue(np.array_equal(inside.sum(axis=0),np.ones(len(probes))),method['id'])

    def test_validation_excludes_saddle_and_bad_budgets(self):
        p = np.array([[0.,0.], [1.,0.], [0.,1.]])
        for q in (np.diag([1.,-1.]), np.zeros((2,2)), np.full((2,2), np.nan)):
            with self.assertRaises(ValueError): bench.metrics(p,q)
        for budgets in ((4,2),(2,2),(1,)):
            with self.assertRaises(ValueError): bench.run(np.eye(2), "paper_l2_l1", budgets)

    def test_variable_curvature_exact_degree_integrals_against_higher_order_quadrature(self):
        field=bench.all_cases()[2][2]
        p=np.array([[-43.,-37.],[41.,-26.],[-12.,45.]])
        result=bench.metrics(p,field)
        nodes,weights=np.polynomial.legendre.leggauss(9);nodes=(nodes+1)/2;weights=weights/2
        z=bench.quartic_value(p,field);l1=l2=0.
        for u,wu in zip(nodes,weights):
            for v,wv in zip(nodes,weights):
                bary=np.array([1-u-(1-u)*v,u,(1-u)*v]);site=bary@p
                # Direct independent function expression.
                value=30+.0001*(site@site)+.0000005*site[0]**4+.00000008*site[1]**4
                residual=float(bary@z-value);w=wu*wv*(1-u)*2*result['area']
                l1+=residual*w;l2+=residual**2*w
                self.assertLessEqual(residual,result['linf']+1e-10)
        self.assertAlmostEqual(l1,result['l1'],places=8)
        self.assertAlmostEqual(l2,result['l2_squared'],places=8)

    def test_quartic_stationary_point_and_quadratic_limit(self):
        field=bench.all_cases()[2][2]
        p=np.array([[-50.,-50.],[50.,-50.],[50.,50.]])
        self.assertAlmostEqual(bench.metrics(p,field)['linf'],4.125,places=10)
        # At the origin the interpolation plane is constant, and the true
        # minimum is 30; a boundary maximum is valid for this initial triangle.
        zero={**field,'quartic':[0.,0.]}
        for key in ('l1','l2_squared','linf','rho','sigma'):
            self.assertAlmostEqual(bench.metrics(p,zero)[key],bench.metrics(p,np.eye(2)*.0001)[key],places=8)


if __name__ == "__main__": unittest.main()
