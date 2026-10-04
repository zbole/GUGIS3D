"""Fixed real Bristol raster samples: continuously certified hybrid/triangle costs.

Separate from the coarse city preview and all historical Swiss experiments.
Local X/Y are British National Grid offsets, not ENU city coordinates.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import time

import numpy as np
from pyproj import Transformer
import rasterio

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from app.environment_models import Terrain
from app.services.terrain_hybrid import adaptive_grid
from app.services.terrain_triangles import local_triangles
from app.services.terrain_compaction import compact_strips, primitive_sha256
from app.services.terrain_raster_reference import RasterReference

SITES = [('bristol-harbour', '布里斯托港区', -2.5985, 51.4501),
         ('bristol-brandon-hill', '布兰登山坡', -2.6078, 51.4524)]
TARGETS = (.1, .25, .5)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def packed(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    if (args.output / 'results.json').exists():
        raise ValueError('Use a fresh output directory; published experiments are immutable')
    manifest = json.loads((ROOT / 'shared/public-terrain-sources.json').read_bytes())['sources'][0]
    raster_path = ROOT / 'backend/data/terrain/bristol-ea-dtm-1m.tif'
    if digest(raster_path.read_bytes()) != manifest['raster_sha256']:
        raise ValueError('Reviewed public EA raster changed')
    report = {
        'schema': 'gugis-bristol-certified-terrain-v1', 'generated_at': '2026-10-05',
        'raster_sha256': manifest['raster_sha256'], 'source_url': manifest['dataset_url'],
        'reference_definition': 'Continuous piecewise-bilinear interpolation of each original 65x65 EA DTM crop, 1m pixel centres, 64x64m. Relative source-raster bound, not unmeasured ground accuracy.',
        'coordinate_scope': 'Exact British National Grid offsets from the centre pixel; ODN Z unchanged. Research-only local coordinates, not converted to city ENU. Do not insert these numeric fixtures into the city scene.',
        'method': 'Fixed two named sites before fitting; same targets and source for every family. Finite-scale certified tensor hybrid versus conforming longest-edge local triangles, plus geometry-identical hybrid strip compaction. No optimality theorem or actual ArcGIS execution.',
        'certificate_limits': 'Cell extrema of the piecewise-bilinear reference; source-cell vertices, triangle-edge grid crossings and quadratic stationary points. Five-decimal saved-height rounding and floating guard included, not interval-verified arithmetic.',
        'scripts': {}, 'cases': []}
    for name in ['data-pipeline/build_bristol_terrain_benchmark.py',
                 'backend/app/services/terrain_hybrid.py', 'backend/app/services/terrain_triangles.py',
                 'backend/app/services/terrain_compaction.py', 'backend/app/services/terrain_raster_reference.py']:
        report['scripts'][name] = digest((ROOT / name).read_bytes().replace(b'\r\n', b'\n'))
    projection = Transformer.from_crs(4326, 27700, always_xy=True)
    with rasterio.open(raster_path) as raster:
        if raster.crs.to_epsg() != 27700 or raster.res != (1., 1.):
            raise ValueError('Unexpected raster CRS or resolution')
        for case_id, name, longitude, latitude in SITES:
            east, north = projection.transform(longitude, latitude)
            row, col = raster.index(east, north)
            window = rasterio.windows.Window(col - 32, row - 32, 65, 65)
            height = raster.read(1, window=window, masked=True)
            if height.shape != (65, 65) or np.ma.getmaskarray(height).any():
                raise ValueError('A named sample contains NoData or is outside coverage')
            z = np.asarray(height, dtype=float)[::-1]
            axis = np.arange(65, dtype=float) - 32
            ref = RasterReference(axis, axis, z)
            folder = args.output / case_id
            folder.mkdir(exist_ok=False)
            origin = list(raster.xy(row, col))
            reference = {'x': axis.tolist(), 'y': axis.tolist(), 'height': z.tolist(),
                         'origin_bng': origin, 'source_window': [row-32, col-32, 65, 65]}
            reference_bytes = packed(reference)
            (folder / 'reference.json').write_bytes(reference_bytes)
            rng = np.random.default_rng(20261005)
            xy = rng.uniform([-32, -32], [32, 32], (4096, 2))
            fixture = {'seed': 20261005, 'xy': xy.tolist(),
                       'reference': ref(xy[:, 0], xy[:, 1]).tolist()}
            fixture_bytes = packed(fixture)
            (folder / 'query-fixture.json').write_bytes(fixture_bytes)
            case = {'id': case_id, 'name': name, 'requested_centre_wgs84': [longitude, latitude],
                    'origin_bng': origin, 'source_window': reference['source_window'],
                    'shape': [65, 65], 'span_m': [64, 64], 'nodata': 0,
                    'source_min_m': float(z.min()), 'source_max_m': float(z.max()),
                    'reference_sha256': digest(reference_bytes), 'fixture_sha256': digest(fixture_bytes),
                    'variants': []}
            for target in TARGETS:
                print(json.dumps({'case': case_id, 'target': target, 'phase': 'build'}), flush=True)
                start = time.perf_counter()
                hybrid, hs, _ = adaptive_grid(axis, axis, z, tolerance=target, cell_certificate=ref.cell_certificate,
                                              name=name, demonstration=False)
                hs['build_validate_ms'] = (time.perf_counter()-start)*1000
                start = time.perf_counter()
                local, ls = local_triangles([-32, -32, 32, 32], ref, ref.triangle_error,
                                            tolerance=target, name=name, edge_decision='longest-edge')
                ls['build_validate_ms'] = (time.perf_counter()-start)*1000
                metadata = {'version': '1.0', 'name': name, 'longitude': longitude, 'latitude': latitude,
                            'reference_height': float(np.median(z)), 'vertical_datum': 'ODN', 'demonstration': False,
                            'source': {'资料': 'EA 2022 LIDAR Composite DTM 1m', '研究坐标': report['coordinate_scope'],
                                       '源SHA256': manifest['raster_sha256'], '参考定义': report['reference_definition']}}
                models, stats = {}, {}
                for family, model, receipt in [('hybrid', hybrid, hs), ('local_triangles', local, ls)]:
                    body = model.model_dump(exclude_none=True)
                    models[family] = Terrain.model_validate({**metadata, 'points': body['points'], 'patches': body['patches']})
                    certificate = ref.model_error(models[family].model_dump(exclude_none=True))
                    stats[family] = {'build_validate_ms': receipt['build_validate_ms'], 'status': receipt['status'],
                                     'continuous_bound_m': certificate['max_error_bound_m'],
                                     'target_met': receipt['target_met'] and certificate['max_error_bound_m'] <= target}
                start = time.perf_counter()
                models['compact_hybrid'], _ = compact_strips(models['hybrid'])
                stats['compact_hybrid'] = {**stats['hybrid'], 'compaction_validate_ms': (time.perf_counter()-start)*1000}
                if primitive_sha256(models['hybrid']) != primitive_sha256(models['compact_hybrid']):
                    raise ValueError('Compaction changed directed primitives')
                pair = {'target_m': target, 'primitive_sha256': primitive_sha256(models['hybrid'])}
                for family, model in models.items():
                    content = packed(model.model_dump(exclude_none=True))
                    filename = f'{family}-{target:g}m.json'
                    (folder / filename).write_bytes(content)
                    pair[family] = {**stats[family], 'filename': filename, 'bytes': len(content), 'sha256': digest(content),
                                    'points': len(model.points), 'patches': len(model.patches),
                                    'ruled_patches': sum(p.kind == 'ruled-strip' for p in model.patches),
                                    'triangle_patches': sum(p.kind == 'triangle-strip' for p in model.patches)}
                case['variants'].append(pair)
                print(json.dumps({'case': case_id, 'target': target,
                                  'bytes': {m: pair[m]['bytes'] for m in models},
                                  'bounds': {m: pair[m]['continuous_bound_m'] for m in models}}), flush=True)
            report['cases'].append(case)
    (args.output / 'results.json').write_bytes((json.dumps(report, ensure_ascii=False, indent=2)+'\n').encode())


if __name__ == '__main__':
    main()
