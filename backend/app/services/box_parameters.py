"""Lossless conversion of recognized box assemblies; arbitrary meshes stay intact."""
import json
from pathlib import Path

TOPOLOGY = json.loads((Path(__file__).resolve().parents[3] / "shared/box-topology.json").read_text())


def box_set_mesh(bounds):
    vertices = [[bound[i] for i in corner] for bound in bounds for corner in TOPOLOGY["corners"]]
    triangles = [[index + part*8 for index in face] for part in range(len(bounds)) for face in TOPOLOGY["triangles"]]
    return vertices, triangles


def identify_box_set(vertices, triangles):
    if len(vertices) % 8:
        return None
    bounds = []
    for start in range(0, len(vertices), 8):
        block = vertices[start:start+8]
        bound = [min(v[k] for v in block) for k in range(3)] + [max(v[k] for v in block) for k in range(3)]
        expected = [[bound[i] for i in corner] for corner in TOPOLOGY["corners"]]
        if [list(v) for v in block] != expected:
            return None
        bounds.append(bound)
    # Exact topology and coordinate comparison is essential. Never approximate
    # an arbitrary mesh by its bounding box just to increase reuse statistics.
    _, expected = box_set_mesh(bounds)
    return bounds if [list(f) for f in triangles] == expected else None
