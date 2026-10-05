"""Export reproducible scientific curves and actual terminal mesh comparisons."""
import hashlib
import json
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.collections import LineCollection
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT/"frontend/public/research/paper-metrics"
report_bytes = (OUT/"results.json").read_bytes()
report = json.loads(report_bytes)
plt.rcParams.update({"font.family": "DejaVu Sans", "svg.fonttype": "none", "axes.spines.top": False, "axes.spines.right": False})
colors = ["#087f79", "#d18432", "#72869c"]
names = ["L2 greedy / L1 edge", "L2 greedy / Euclidean", "Uniform / Euclidean"]
receipts = {}
for case in report["cases"]:
    fig, axes = plt.subplots(1, 2, figsize=(12, 4.8), layout="constrained")
    for method, color, name in zip(case["methods"], colors, names):
        rows = method["rows"]
        n = [r["triangles"] for r in rows]
        axes[0].loglog(n, [r["e2_m2"] for r in rows], "o-", color=color, label=name, markersize=4)
        axes[1].semilogx(n, [r["rho_median"] for r in rows], "o-", color=color, label=name, markersize=4)
    # Anchored guide, not a fitted theorem or oracle lower bound.
    first = case["methods"][0]["rows"][0]
    axes[0].loglog(n, [first["e2_m2"]*n[0]/x for x in n], "k:", alpha=.55, label="N^-1 guide (anchored)")
    axes[0].set(xlabel="Number of triangles N", ylabel="Global E2 (m²)", title="Approximation error / smaller is better")
    axes[1].set(xlabel="Number of triangles N", ylabel="Median rho_Q (dimensionless)", title="Hessian-metric mesh shape / smaller is better")
    for ax in axes:
        ax.grid(alpha=.16)
        ax.legend(fontsize=8)
    kind='quartic' if case.get('polynomial') else 'quadratic'
    fig.suptitle(f"{case['id'].replace('_',' ').title()} {kind} / exact-degree integrals / 100 m × 100 m", fontsize=13)
    for extension in ("png", "svg"):
        name = f"{case['id']}-curves.{extension}"
        fig.savefig(OUT/name, dpi=150, metadata={"Date": None} if extension == "svg" else {})
        if extension == "svg":
            (OUT/name).write_text("\n".join(line.rstrip() for line in (OUT/name).read_text(encoding="utf-8").splitlines())+"\n",encoding="utf-8",newline="\n")
        receipts[name] = hashlib.sha256((OUT/name).read_bytes()).hexdigest()
    plt.close(fig)
    fig, axes = plt.subplots(1, 3, figsize=(12, 4.5), layout="constrained")
    for ax, method, color, name in zip(axes, case["methods"], colors, names):
        mesh = json.loads((OUT/method["mesh_filename"]).read_bytes())
        triangles = np.array(mesh["triangles"])
        segments = triangles[:, [[0,1],[1,2],[2,0]], :].reshape(-1,2,2)
        ax.add_collection(LineCollection(segments, colors=color, linewidths=.3))
        ax.set(xlim=(-50,50), ylim=(-50,50), aspect="equal", xlabel="x (m)", ylabel="y (m)", title=name)
    fig.suptitle(f"{case['id'].title()} / actual meshes / N = 2048 / nonconforming bisection", fontsize=12)
    for extension in ("png", "svg"):
        name = f"{case['id']}-meshes.{extension}"
        fig.savefig(OUT/name, dpi=150, metadata={"Date": None} if extension == "svg" else {})
        if extension == "svg":
            (OUT/name).write_text("\n".join(line.rstrip() for line in (OUT/name).read_text(encoding="utf-8").splitlines())+"\n",encoding="utf-8",newline="\n")
        receipts[name] = hashlib.sha256((OUT/name).read_bytes()).hexdigest()
    plt.close(fig)
(OUT/"figures.json").write_text(json.dumps({"report_sha256": hashlib.sha256(report_bytes).hexdigest(), "plot_script_sha256": hashlib.sha256(Path(__file__).read_bytes().replace(b"\r\n",b"\n")).hexdigest(), "files": receipts},indent=2)+"\n",encoding="utf-8")
print("Exported",len(receipts),"scientific figures")
