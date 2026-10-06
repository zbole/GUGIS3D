"""Finite quadratic interpolation experiments aligned with arXiv:1101.1452.

Not a reproduction of the paper's figures or a new optimality proof. No city writes.
Uses float64 exact polynomial integrals (up to floating-point rounding), not samples.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import heapq
import json
import math
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
BUDGETS = (8, 16, 32, 64, 128, 256, 512, 1024, 2048)
METHODS = ("paper_l2_l1", "greedy_euclidean", "uniform_euclidean")
METHOD_LABELS = ("论文式 L₂ 贪心 / L₁ 选边", "L₂ 贪心 / 欧氏最长边", "均匀面积 / 欧氏最长边")
GAUSS_NODES, GAUSS_WEIGHTS = np.polynomial.legendre.leggauss(5)
GAUSS_NODES, GAUSS_WEIGHTS = (GAUSS_NODES+1)/2, GAUSS_WEIGHTS/2
GU,GV = np.meshgrid(GAUSS_NODES,GAUSS_NODES)
GWU,GWV = np.meshgrid(GAUSS_WEIGHTS,GAUSS_WEIGHTS)
QUARTIC_BARY = np.column_stack(((1-GU-(1-GU)*GV).ravel(),GU.ravel(),((1-GU)*GV).ravel()))
QUARTIC_WEIGHTS = (GWU*GWV*(1-GU)).ravel()


def quadratic_cases():
    angle = math.pi / 6
    rotation = np.array([[math.cos(angle), -math.sin(angle)],
                         [math.sin(angle), math.cos(angle)]])
    return (("isotropic", "各向同性凸碗", np.eye(2) * .002),
            ("anisotropic", "旋转 30° / 曲率比 100:1", rotation @ np.diag([.004, .00004]) @ rotation.T))


def all_cases():
    return (*quadratic_cases(), ("variable_curvature", "变曲率严格凸曲面", {'kind':'separable-quartic','quadratic':[.0001,.0001],'quartic':[.0000005,.00000008]}))


def quartic_value(points, field):
    p=np.asarray(points)
    return 30+np.sum(p*p*np.asarray(field['quadratic'])+p**4*np.asarray(field['quartic']),axis=-1)


def quartic_metrics(triangle, field):
    p=np.asarray(triangle,dtype=float)
    a=np.asarray(field.get('quartic'),dtype=float);q=np.asarray(field.get('quadratic'),dtype=float)
    if p.shape!=(3,2) or a.shape!=(2,) or q.shape!=(2,) or not all(np.isfinite(v).all() for v in (p,a,q)) or np.any(a<0) or np.any(q<=0):
        raise ValueError('Finite strictly convex separable quartic required')
    basis=(p[1:]-p[0]).T;det=abs(float(np.linalg.det(basis)));area=det/2
    if area<=0:raise ValueError('Nondegenerate triangle required')
    z=quartic_value(p,field)
    plane=np.linalg.solve(np.column_stack((p,np.ones(3))),z)
    sites=QUARTIC_BARY @ p
    residual=QUARTIC_BARY @ z-quartic_value(sites,field)
    l1=float(np.dot(QUARTIC_WEIGHTS,residual))*det
    l2sq=float(np.dot(QUARTIC_WEIGHTS,residual*residual))*det
    maximum=0.
    # For strict convex f, interpolant-f is strictly concave. Its unique
    # unconstrained stationary point and edge stationary points exhaust maxima.
    critical=[]
    for axis in range(2):
        if a[axis]==0:critical.append(plane[axis]/(2*q[axis]));continue
        roots=np.roots([4*a[axis],0,2*q[axis],-plane[axis]])
        real=[r.real for r in roots if abs(r.imag)<1e-8*(1+abs(r.real))]
        if len(real)!=1:raise RuntimeError('Strictly monotone derivative root not isolated')
        critical.append(real[0])
    critical=np.asarray(critical);uv=np.linalg.solve(basis,critical-p[0])
    if np.all(uv>=0) and uv.sum()<=1:maximum=max(maximum,float(critical @ plane[:2]+plane[2]-quartic_value(critical,field)))
    poly=np.polynomial.polynomial
    for start,end in zip(p,np.roll(p,-1,axis=0)):
        delta=end-start;coeff=np.array([30.])
        for axis in range(2):
            squared=poly.polymul([start[axis],delta[axis]],[start[axis],delta[axis]])
            coeff=poly.polyadd(coeff,poly.polyadd(q[axis]*squared,a[axis]*poly.polymul(squared,squared)))
        gap=poly.polysub([float(start @ plane[:2]+plane[2]),float(delta @ plane[:2])],coeff)
        roots=poly.polyroots(poly.polyder(gap));ts=[0.,1.]+[float(r.real) for r in roots if abs(r.imag)<1e-8 and 0<r.real<1]
        maximum=max(maximum,float(np.max(poly.polyval(ts,gap))))
    centre=p.mean(axis=0);local_q=np.diag(q+6*a*centre**2)
    edges=p[[1,2,0]]-p;d=np.einsum('ij,jk,ik->i',edges,local_q,edges)
    denominator=area*math.sqrt(float(np.linalg.det(local_q)))
    return {'area':area,'l1':l1,'l2_squared':l2sq,'linf':maximum,
            'rho':float(d.max())/denominator,'sigma':float(np.sort(d)[:2].sum())/(4*denominator),
            'hessian_det':float(np.linalg.det(2*local_q))}


def metrics(triangle, q):
    """q(x)=x^T Q x; interpolation gap is sum d_ij lambda_i lambda_j."""
    if isinstance(q,dict):return quartic_metrics(triangle,q)
    p = np.asarray(triangle, dtype=float)
    q = np.asarray(q, dtype=float)
    if p.shape != (3, 2) or q.shape != (2, 2) or not np.isfinite(p).all() or not np.isfinite(q).all():
        raise ValueError("finite 3x2 triangle and 2x2 SPD matrix required")
    if not np.allclose(q, q.T, rtol=0, atol=1e-15) or np.linalg.eigvalsh(q)[0] <= 0:
        raise ValueError("strictly positive definite Q required")
    basis = (p[1:] - p[0]).T
    area = abs(float(np.linalg.det(basis))) / 2
    if area <= 0:
        raise ValueError("nondegenerate triangle required")
    edges = p[[1, 2, 0]] - p
    d = np.einsum("ij,jk,ik->i", edges, q, edges)
    l1 = area * float(d.sum()) / 12
    l2sq = area * float(np.dot(d, d) + d[0]*d[1] + d[1]*d[2] + d[2]*d[0]) / 90
    r = basis.T @ q @ basis
    g = np.diag(r)
    critical = np.linalg.solve(2*r, g)
    linf = float(d.max()) / 4
    if critical.min() >= 0 and critical.sum() <= 1:
        linf = max(linf, float(g @ critical - critical @ r @ critical))
    denominator = area * math.sqrt(float(np.linalg.det(q)))
    return {"area": area, "l1": l1, "l2_squared": l2sq, "linf": linf,
            "rho": float(d.max()) / denominator,
            "sigma": float(np.sort(d)[:2].sum()) / (4*denominator)}


def bisect(triangle, edge):
    i, j = ((0, 1), (1, 2), (2, 0))[edge]
    k = 3-i-j
    midpoint = (triangle[i] + triangle[j]) / 2
    return (np.array([triangle[k], triangle[i], midpoint]),
            np.array([triangle[k], midpoint, triangle[j]]))


def choose_edge(triangle, q, method):
    if method == "paper_l2_l1":
        # Equation 2.18: child L1 interpolation errors, even though selection uses L2.
        costs = [sum(metrics(child, q)["l1"] for child in bisect(triangle, e)) for e in range(3)]
        return min(range(3), key=lambda e: (costs[e], e))
    if method not in METHODS:
        raise ValueError("unknown method")
    lengths = np.sum((triangle[[1, 2, 0]] - triangle)**2, axis=1)
    return max(range(3), key=lambda e: (lengths[e], -e))


def aggregate(entries, q, n):
    values = [m for _, m in entries.values()]
    area = math.fsum(v["area"] for v in values)
    if len(values) != n or not math.isclose(area, 10000, rel_tol=0, abs_tol=1e-7):
        raise RuntimeError("triangle count or domain area changed")
    e1 = math.fsum(v["l1"] for v in values)
    e2 = math.sqrt(math.fsum(v["l2_squared"] for v in values))
    local = np.sqrt([v["l2_squared"] for v in values])
    rho, sigma = ([v[key] for v in values] for key in ("rho", "sigma"))
    return {"triangles": n, "area_m2": area, "e1_m3": e1, "e2_m2": e2,
            "linf_m": max(v["linf"] for v in values), "mae_m": e1/area,
            "rms_m": e2/math.sqrt(area), "n_e2_m2": n*e2,
            "rho_median": float(np.median(rho)), "rho_p95": float(np.percentile(rho, 95)),
            "sigma_median": float(np.median(sigma)), "sigma_max": max(sigma),
            "local_l2_cv": float(np.std(local)/np.mean(local)),
            "hessian_det": float(np.median([v['hessian_det'] for v in values])) if isinstance(q,dict) else float(np.linalg.det(2*q))}


def run(q, method, budgets=BUDGETS):
    if method not in METHODS or not budgets or tuple(sorted(set(budgets))) != tuple(budgets) or min(budgets) < 2:
        raise ValueError("ordered unique triangle budgets >= 2 required")
    initial = (np.array([[-50., -50.], [50., -50.], [50., 50.]]),
               np.array([[-50., -50.], [50., 50.], [-50., 50.]]))
    heap, entries, next_id = [], {}, 0

    def insert(triangle):
        nonlocal next_id
        m = metrics(triangle, q)
        priority = m["area"] if method == "uniform_euclidean" else m["l2_squared"]
        entries[next_id] = (triangle, m)
        heapq.heappush(heap, (-priority, next_id))
        next_id += 1

    for triangle in initial:
        insert(triangle)
    rows = []
    for n in budgets:
        while len(entries) < n:
            _, key = heapq.heappop(heap)
            triangle, _ = entries.pop(key)
            for child in bisect(triangle, choose_edge(triangle, q, method)):
                insert(child)
        rows.append(aggregate(entries, q, n))
    # OLS log-log slope on the last four published budgets; observed, not asymptotic proof.
    tail = rows[-4:]
    slope = float(np.polyfit(np.log([r["triangles"] for r in tail]), np.log([r["e2_m2"] for r in tail]), 1)[0]) if len(tail) >= 2 else None
    return rows, slope, [triangle.tolist() for triangle, _ in entries.values()]


def source_hash():
    return hashlib.sha256(Path(__file__).read_bytes().replace(b"\r\n", b"\n")).hexdigest()


def build(output):
    output.mkdir(parents=True, exist_ok=True)
    report = {"schema": "gugis-paper-metrics-v1", "paper": "https://arxiv.org/abs/1101.1452",
              "source_sha256": source_hash(), "domain_m": [-50, -50, 50, 50], "budgets": BUDGETS,
              "scope": "Finite strict-convex polynomial vertex-interpolation study; no ArcGIS software run, no new optimality proof. Closed-form quadratic / exact-degree Gauss quartic integrals in float64. Nonconforming bisection; no C0 closure. Variable-curvature shape uses Q=Hessian/2 at triangle centroid.",
              "selection_p": 2, "edge_decision_p": 1, "slope_last_budgets": BUDGETS[-4:], "cases": []}
    flat = []
    for case_id, label, q in all_cases():
        field=q if isinstance(q,dict) else None
        matrix=None if field else q.tolist()
        case = {"id": case_id, "name": label, "q_matrix": matrix, "polynomial":field, "methods": []}
        for method, name in zip(METHODS, METHOD_LABELS):
            rows, slope, triangles = run(q, method)
            mesh = {"case": case_id, "method": method, "q_matrix": matrix, "polynomial":field, "triangles": triangles}
            mesh_bytes = (json.dumps(mesh, separators=(",", ":"), allow_nan=False) + "\n").encode()
            filename = f"{case_id}-{method}-2048.json"
            (output/filename).write_bytes(mesh_bytes)
            case["methods"].append({"id": method, "name": name, "observed_e2_slope": slope,
                                    "mesh_filename": filename, "mesh_sha256": hashlib.sha256(mesh_bytes).hexdigest(), "rows": rows})
            flat.extend({"case": case_id, "method": method, **row} for row in rows)
        report["cases"].append(case)
    data = (json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False) + "\n").encode()
    (output/"results.json").write_bytes(data)
    with (output/"results.csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(flat[0]))
        writer.writeheader()
        writer.writerows(flat)
    (ROOT/"shared/paper-terrain-metrics.json").write_bytes(data)
    print(json.dumps({"rows": len(flat), "report_sha256": hashlib.sha256(data).hexdigest(),
                      "anisotropic_2048": [{"method": m["id"], **m["rows"][-1], "slope": m["observed_e2_slope"]} for m in report["cases"][1]["methods"]]}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=ROOT/"frontend/public/research/paper-metrics")
    build(parser.parse_args().output)
