"""Build actual validated GUGIS strips from the exact ImplicitTerrain reference grid.

Run with the backend Python environment after replay_implicit_terrain.py.
Research coordinates are a metric sample lattice, not a Bristol ENU project.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import sys
import time
import numpy as np
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from app.services.terrain_builder import from_grid
from app.environment_models import Terrain


def reconstruct(terrain, size=1000):
    """Read saved strip cells, not the original downsampled height array."""
    output = np.full((size, size), np.nan)
    points = np.asarray(terrain.points)
    cells = []
    for patch in terrain.patches:
        if patch.kind == 'ruled-strip':
            groups = zip(patch.left, patch.right, patch.left[1:], patch.right[1:])
        elif patch.kind == 'triangle-strip':
            left, right = patch.indices[1::2], patch.indices[::2]
            groups = zip(left, right, left[1:], right[1:])
        else:
            raise ValueError('Research benchmark does not accept fans')
        for ids in groups:
            a, b, c, d = points[list(ids)]  # bottom-left, top-left, bottom-right, top-right
            c0, c1 = int(round(a[0] + 499.5)), int(round(c[0] + 499.5))
            r0, r1 = int(round(a[1] + 499.5)), int(round(b[1] + 499.5))
            if not 0 <= c0 < c1 < size or not 0 <= r0 < r1 < size:
                raise ValueError('Saved patch is not an expected rectilinear research cell')
            u, v = np.meshgrid(np.arange(c0, c1 + 1), np.arange(r0, r1 + 1))
            u, v = (u - c0) / (c1 - c0), (v - r0) / (r1 - r0)
            if patch.kind == 'ruled-strip':
                z = (1-v)*((1-u)*a[2]+u*c[2]) + v*((1-u)*b[2]+u*d[2])
            else:
                z = np.where(v >= u, a[2] + (d[2]-b[2])*u + (b[2]-a[2])*v,
                             a[2] + (c[2]-a[2])*u + (d[2]-c[2])*v)
            output[r0:r1+1, c0:c1+1] = z
    if not np.isfinite(output).all():
        raise ValueError('The saved representation leaves reference samples uncovered')
    return np.flipud(output)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    args = parser.parse_args()
    replay = json.loads((args.input / 'replay.json').read_bytes())
    ref = np.load(args.input / 'replay.npz')['reference']
    low, high = replay['height_range_m']
    height = np.flipud((ref.astype(float)+1)*.5*(high-low)+low)
    longitude, latitude = Transformer.from_crs(2056, 4326, always_xy=True).transform(2494500, 1141500)
    variants = []
    for stride in (2, 4, 8, 16, 32, 64):
        axis = np.unique(np.append(np.arange(0, 1000, stride), 999))
        x, y = np.meshgrid(axis-499.5, axis-499.5)
        started = time.perf_counter()
        terrain = from_grid(x, y, height[np.ix_(axis, axis)], name=f'Swiss author sample · {stride} m',
            longitude=longitude, latitude=latitude, datum='unknown', demonstration=False,
            source={'来源': 'ImplicitTerrain public demo 2494_1141.tif', '源SHA256': replay['source_sha256'],
                    '坐标': 'Metric lattice x=column−499.5, y=499.5−source_row; EPSG:2056 sample domain',
                    '水平定位': 'Research lattice only; not a city ENU archive',
                    '高程基准': 'Source vertical datum not independently verified', '采样步长': f'{stride} m; last boundary retained',
                    '构面规则': 'Adjacent maximum slope ≤0.15 uses ruled-strip; otherwise triangle-strip'})
        build_ms = (time.perf_counter()-started)*1000
        content = json.dumps(terrain.model_dump(mode='json', exclude_none=True), ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        path = args.input / f'gugis-{stride}m.json'
        path.write_bytes(content)
        started = time.perf_counter()
        restored = Terrain.model_validate_json(path.read_bytes())
        load_ms = (time.perf_counter()-started)*1000
        started = time.perf_counter()
        reconstructed = reconstruct(restored)
        reconstruct_ms = (time.perf_counter()-started)*1000
        np.save(args.input / f'gugis-{stride}m.npy', reconstructed)
        report = {'id': f'gugis-{stride}m', 'stride_m': stride, 'bytes': len(content),
                  'sha256': hashlib.sha256(content).hexdigest(), 'points': len(terrain.points),
                  'patches': len(terrain.patches), 'kinds': dict(Counter(p.kind for p in terrain.patches)),
                  'build_ms': build_ms, 'validated_load_ms': load_ms, 'dense_readback_reconstruction_ms': reconstruct_ms}
        variants.append(report)
        print(json.dumps(report), flush=True)
    (args.input / 'native.json').write_text(json.dumps(variants, indent=2)+'\n', encoding='utf-8')


if __name__ == '__main__':
    main()
