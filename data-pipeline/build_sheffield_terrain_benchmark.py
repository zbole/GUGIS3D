"""Fixed real multi-city crops, whole-domain error, and identical MultiPatch XYZ.

Additive research artifacts only. No city/current/archive reads or writes.
Samples are source-grid centre and north-quarter, selected before fitting.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import time

import numpy as np
from pyproj import CRS, Transformer
import rasterio
import shapefile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from app.environment_models import Terrain
from app.services.terrain_triangles import local_triangles
from app.services.terrain_compaction import compact_strips, primitive_sha256
from app.services.terrain_raster_reference import RasterReference
from terrain_partition_hybrid import partition_hybrid
from raster_l2_audit import integrate_model
from benchmark_research_packing import omit_absent_measures
from benchmark_research_joined_strips import triangles_digest

CITIES = ('sheffield',)
SITES = (('centre', '源栅格中心', .5), ('north-quarter', '源栅格北侧四分位', .25))
TARGETS = (.1, .25, .5)
SCRIPT_PATHS = (
    'data-pipeline/build_sheffield_terrain_benchmark.py',
    'data-pipeline/terrain_partition_hybrid.py', 'data-pipeline/raster_l2_audit.py',
    'data-pipeline/benchmark_research_packing.py',
    'data-pipeline/benchmark_research_joined_strips.py',
    'backend/app/services/terrain_triangles.py',
    'backend/app/services/terrain_compaction.py',
    'backend/app/services/terrain_raster_reference.py',
)


def sha(value):
    return hashlib.sha256(value).hexdigest()


def packed(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()


def identical_multipatch(model, origin, folder, case_id, target, source_sha):
    if any(p.kind != 'triangle-strip' for p in model.patches):
        raise ValueError('Same-geometry export accepts native triangles only')
    # Signed floating zero has equal geometry but differs in raw digest bits.
    # Normalize its sign on both sides without rounding any nonzero coordinate.
    canonical = lambda point: [0.0 if value == 0 else value for value in point]
    parts = [[canonical(model.points[i]) for i in patch.indices] for patch in model.patches]
    world = [[[p[0] + origin[0], p[1] + origin[1], p[2]] for p in strip] for strip in parts]
    base = folder / f'local-triangles-{round(target * 100)}cm'
    if any(base.with_suffix(s).exists() for s in ('.shp', '.shx', '.dbf', '.prj', '.cpg')):
        raise FileExistsError('Never overwrite an experiment shape')
    with shapefile.Writer(str(base), shapeType=shapefile.MULTIPATCH) as writer:
        writer.field('SAMPLE_ID', 'C', size=80)
        writer.field('SRC_SHA', 'C', size=64)
        writer.field('TOL_M', 'N', size=12, decimal=5)
        writer.field('VERT_DAT', 'C', size=10)
        writer.multipatch(world, [shapefile.TRIANGLE_STRIP] * len(world))
        writer.record(case_id, source_sha, target, 'ODN')
    omit_absent_measures(base)
    Path(str(base) + '.prj').write_text(CRS.from_epsg(27700).to_wkt(version='WKT1_ESRI'), encoding='utf8')
    Path(str(base) + '.cpg').write_bytes(b'UTF-8')
    with shapefile.Reader(str(base)) as reader:
        if reader.shapeType != shapefile.MULTIPATCH or len(reader) != 1:
            raise ValueError('Unexpected exported shape')
        shape = reader.shape(0)
        if any(k != shapefile.TRIANGLE_STRIP for k in shape.partTypes):
            raise ValueError('Exported part type changed')
        restored = [[canonical([x - origin[0], y - origin[1], z])
                     for (x, y), z in zip(shape.points[a:b], shape.z[a:b])]
                    for a, b in zip(shape.parts, [*shape.parts[1:], len(shape.points)])]
        if list(reader.record(0)) != [case_id, source_sha, target, 'ODN']:
            raise ValueError('Exported source attributes changed')
    original, recovered = triangles_digest(parts), triangles_digest(restored)
    if original != recovered or parts != restored:
        raise ValueError('MultiPatch changed exact XYZ, grouping, or directed triangles')
    files = []
    for suffix in ('.shp', '.shx', '.dbf', '.prj', '.cpg'):
        path = Path(str(base) + suffix)
        content = path.read_bytes()
        files.append({'filename': path.name, 'bytes': len(content), 'sha256': sha(content)})
    return {'files': files, 'five_component_bytes': sum(f['bytes'] for f in files),
            'native_parts': len(parts), 'exact_xyz_and_parts': True, **original,
            'zero_sign_normalized_for_xyz_digest': True,
            'crs': 'EPSG:27700', 'vertical_datum': 'ODN',
            'scope': 'Same saved native triangle geometry and selected source attributes; native JSON metadata not fully reproduced. No ArcGIS execution.'}


def build(output):
    if output.exists():
        raise FileExistsError('Use a fresh experiment directory')
    output.mkdir(parents=True)
    catalog_bytes = (ROOT / 'shared/public-terrain-sources-v5.json').read_bytes()
    sources = json.loads(catalog_bytes)['sources']
    report = {
        'schema': 'gugis-sheffield-certified-terrain-v1', 'generated_at': '2026-10-05',
        'source_catalogue_sha256': sha(catalog_bytes),
        'selection': 'Sheffield independently acquired England DTM sample; fixed full-grid centre column, centre row or north-quarter row. No outcome-based site selection.',
        'targets_m': list(TARGETS),
        'reference': 'Original 65x65 1m pixel centres, continuous cellwise bilinear interpolation; whole 64x64m domain. Source-relative, not independently measured ground accuracy.',
        'coordinate_scope': 'Local BNG XY offsets from exact source centre pixel, unchanged ODN Z. Research fixture only, not city ENU or ellipsoidal height.',
        'methods': 'Locally partitioned C0 hybrid and certified conforming triangle bisection (maximum-error priority, Euclidean longest edge). Both compacted without changing native primitives; geometry differs between families.',
        'paper_alignment': 'Whole-domain L2 norm E2 and actual native triangle N; native ruled quadrilaterals counted separately. Real cellwise bilinear DTM does not satisfy the paper strict-convex-C2 assumptions. No claimed paper theorem or Hessian-shape metric on this raster.',
        'numerics': 'Saved five-decimal control heights included. Source-cell clipping with polynomial Gauss/Duffy integration in Float64. Max-reference certificate uses Float64 guards, not interval arithmetic.',
        'budgets': {'hybrid_max_steps': 2048, 'hybrid_max_points': 300000,
                    'triangle_max_steps': 30000, 'triangle_max_points': 30000},
        'scripts': {p: sha((ROOT / p).read_bytes().replace(b'\r\n', b'\n')) for p in SCRIPT_PATHS},
        'cases': [],
    }
    inverse = Transformer.from_crs(27700, 4326, always_xy=True)
    for city_id in CITIES:
        source = next(s for s in sources if s['city_id'] == city_id)
        raster_path = ROOT / f'backend/data/terrain/{city_id}-ea-dtm-1m.tif'
        if sha(raster_path.read_bytes()) != source['raster_sha256']:
            raise ValueError('Published source raster changed')
        with rasterio.open(raster_path) as raster:
            if raster.crs.to_epsg() != 27700 or raster.res != (1., 1.) or raster.count != 1:
                raise ValueError('Unexpected source grid')
            for site_id, name, fraction in SITES:
                case_id = f'{city_id}-{site_id}'
                row, col = int(raster.height * fraction), raster.width // 2
                height = raster.read(1, window=rasterio.windows.Window(col - 32, row - 32, 65, 65), masked=True)
                if height.shape != (65, 65) or np.ma.getmaskarray(height).any() or not np.isfinite(height.data).all():
                    raise ValueError('Preselected crop missing or incomplete; do not replace with a better site')
                z = np.asarray(height, dtype=float)[::-1]
                axis = np.arange(65, dtype=float) - 32
                reference = RasterReference(axis, axis, z)
                origin = list(raster.xy(row, col))
                longitude, latitude = inverse.transform(*origin)
                folder = output / case_id
                folder.mkdir()
                grid = {'x': axis.tolist(), 'y': axis.tolist(), 'height': z.tolist(),
                        'origin_bng': origin, 'source_window': [row - 32, col - 32, 65, 65]}
                ref_bytes = packed(grid)
                (folder / 'reference.json').write_bytes(ref_bytes)
                xy = np.random.default_rng(20261005).uniform([-32, -32], [32, 32], (4096, 2))
                fixture = {'seed': 20261005, 'xy': xy.tolist(), 'reference': reference(xy[:, 0], xy[:, 1]).tolist()}
                fixture_bytes = packed(fixture)
                (folder / 'query-fixture.json').write_bytes(fixture_bytes)
                case = {'id': case_id, 'city_id': city_id, 'name': f"{source['name']} · {name}",
                        'site_id': site_id, 'origin_bng': origin, 'centre_wgs84': [longitude, latitude],
                        'source_window': grid['source_window'], 'source_raster_sha256': source['raster_sha256'],
                        'source_min_m': float(z.min()), 'source_max_m': float(z.max()),
                        'reference_sha256': sha(ref_bytes), 'fixture_sha256': sha(fixture_bytes),
                        'models': []}
                for target in TARGETS:
                    print(json.dumps({'case': case_id, 'target': target, 'phase': 'hybrid'}), flush=True)
                    start = time.perf_counter()
                    hybrid, hybrid_stats = partition_hybrid(reference, tolerance=target, name=case['name'])
                    hybrid_ms = (time.perf_counter() - start) * 1000
                    print(json.dumps({'case': case_id, 'target': target, 'phase': 'triangles'}), flush=True)
                    start = time.perf_counter()
                    tri, tri_stats = local_triangles([-32, -32, 32, 32], reference, reference.triangle_error,
                        tolerance=target, name=case['name'], edge_decision='longest-edge')
                    tri_ms = (time.perf_counter() - start) * 1000
                    for family, model, stats, build_ms in [('hybrid', hybrid, hybrid_stats, hybrid_ms),
                                                           ('local_triangles', tri, tri_stats, tri_ms)]:
                        model, compact_receipt = compact_strips(model)
                        body = model.model_dump(exclude_none=True)
                        metadata = {'version': '1.0', 'name': case['name'], 'longitude': longitude,
                                    'latitude': latitude, 'reference_height': float(np.median(z)),
                                    'vertical_datum': 'ODN', 'demonstration': False,
                                    'source': {'source_raster_sha256': source['raster_sha256'],
                                               'coordinate_scope': report['coordinate_scope'],
                                               'reference_sha256': sha(ref_bytes)}}
                        model = Terrain.model_validate({**metadata, 'points': body['points'], 'patches': body['patches']})
                        native = model.model_dump(exclude_none=True)
                        certificate = reference.model_error(native)
                        integral = integrate_model(grid, native)
                        if integral['rms_integral_m'] > certificate['max_error_bound_m'] + 1e-10:
                            raise ValueError('Integral RMS exceeds maximum reference error')
                        content = packed(native)
                        filename = f'{family}-{target:g}m.json'
                        (folder / filename).write_bytes(content)
                        record = {'family': family, 'target_m': target, 'filename': filename,
                                  'bytes': len(content), 'sha256': sha(content), 'points': len(model.points),
                                  'patches': len(model.patches), 'primitive_sha256': primitive_sha256(model),
                                  'status': stats['status'], 'target_met': bool(stats['target_met'] and certificate['max_error_bound_m'] <= target),
                                  'continuous_bound_m': certificate['max_error_bound_m'],
                                  'build_validate_ms': build_ms, 'compaction': compact_receipt, **integral}
                        if family == 'local_triangles':
                            record['multipatch'] = identical_multipatch(model, origin, folder, case_id, target, source['raster_sha256'])
                        case['models'].append(record)
                        print(json.dumps({'case': case_id, 'target': target, 'family': family,
                                          'bytes': len(content), 'e2': integral['e2_m2'],
                                          'max': record['continuous_bound_m'], 'target_met': record['target_met']}), flush=True)
                report['cases'].append(case)
    (output / 'results.json').write_bytes((json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + '\n').encode())


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    build(parser.parse_args().output)
