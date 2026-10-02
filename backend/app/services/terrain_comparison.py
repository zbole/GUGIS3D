"""Same-query accuracy audits of real, read-back MultiPatch triangle strips.

Native elevations come from the website's native kernel. The mesh evaluator here
is an independent barycentric reference implementation, not an ArcGIS engine.
"""
import csv
import hashlib
import json
import math
import tempfile
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

import shapefile

from ..environment_models import Terrain
from .terrain_multipatch import bng_projector, export_multipatch

RESOLUTIONS = (1, 2, 4, 8)


class TriangleSurface:
    def __init__(self, base: Path):
        self.bins = {}
        self.triangles = 0
        with shapefile.Reader(str(base)) as reader:
            if reader.shapeType != shapefile.MULTIPATCH:
                raise ValueError('Reference surface must be MultiPatch')
            for item in reader.iterShapeRecords():
                shape = item.shape
                patch = item.record['PATCH_ID']
                ends = list(shape.parts)[1:] + [len(shape.points)]
                for start, end, kind in zip(shape.parts, ends, shape.partTypes):
                    if kind != shapefile.TRIANGLE_STRIP:
                        raise ValueError('Reference surface requires Triangle Strip parts')
                    vertices = [[*shape.points[i], shape.z[i]] for i in range(start, end)]
                    for i in range(len(vertices) - 2):
                        a, b, c = vertices[i:i + 3]
                        if i % 2:
                            b, c = c, b
                        dx1, dy1, dz1 = [b[j] - a[j] for j in range(3)]
                        dx2, dy2, dz2 = [c[j] - a[j] for j in range(3)]
                        det = dx1 * dy2 - dy1 * dx2
                        if det <= 1e-10:
                            raise ValueError('Projected reference triangle is folded or degenerate')
                        bounds = (min(a[0], b[0], c[0]), min(a[1], b[1], c[1]),
                                  max(a[0], b[0], c[0]), max(a[1], b[1], c[1]))
                        triangle = (a, dx1, dy1, dz1, dx2, dy2, dz2, det, patch, bounds)
                        self.triangles += 1
                        for x in range(math.floor(bounds[0] / 64), math.floor(bounds[2] / 64) + 1):
                            for y in range(math.floor(bounds[1] / 64), math.floor(bounds[3] / 64) + 1):
                                self.bins.setdefault((x, y), []).append(triangle)

    def query(self, x, y):
        for a, dx1, dy1, dz1, dx2, dy2, dz2, det, patch, bounds in self.bins.get(
                (math.floor(x / 64), math.floor(y / 64)), []):
            if not bounds[0] - 1e-7 <= x <= bounds[2] + 1e-7 or not bounds[1] - 1e-7 <= y <= bounds[3] + 1e-7:
                continue
            u = ((x - a[0]) * dy2 - (y - a[1]) * dx2) / det
            v = (dx1 * (y - a[1]) - dy1 * (x - a[0])) / det
            if u >= -1e-8 and v >= -1e-8 and u + v <= 1 + 1e-8:
                return {'height': a[2] + u * dz1 + v * dz2, 'patch': patch,
                        'gx': (dz1 * dy2 - dy1 * dz2) / det,
                        'gy': (dx1 * dz2 - dz1 * dx2) / det,
                        'onEdge': min(u, v, 1 - u - v) < 1e-7}
        return None


def circular_difference(actual, expected):
    """Signed shortest turn; 359 -> 1 is +2 degrees, never -358."""
    return (actual - expected + 180) % 360 - 180


def local_derivatives(hit, x, y, project):
    """Pull the BNG facet gradient back to the native local ENU plane.

    A central 0.5 m horizontal Jacobian includes grid convergence and scale.
    Comparing raw BNG aspect with local ENU aspect would confound these.
    """
    h = .5
    xp, xm = project(x + h, y), project(x - h, y)
    yp, ym = project(x, y + h), project(x, y - h)
    gx = sum(hit[key] * (xp[i] - xm[i]) / (2 * h) for i, key in enumerate(('gx', 'gy')))
    gy = sum(hit[key] * (yp[i] - ym[i]) / (2 * h) for i, key in enumerate(('gx', 'gy')))
    magnitude = math.hypot(gx, gy)
    return math.degrees(math.atan(magnitude)), (math.degrees(math.atan2(-gx, -gy)) + 360) % 360 if magnitude >= 1e-10 else None


def error_stats(values):
    return {'maxAbsDegrees': max(map(abs, values)) if values else None,
            'rmsDegrees': math.sqrt(sum(v * v for v in values) / len(values)) if values else None}


def compare_queries(surface, points, project):
    rows = []
    for point in points:
        x, y = project(point['x'], point['y'])
        hit = surface.query(x, y)
        mesh = hit['height'] if hit else None
        native = point['height']
        error = mesh - native if native is not None and mesh is not None else None
        slope, aspect = local_derivatives(hit, point['x'], point['y'], project) if hit else (None, None)
        native_slope, native_aspect = point.get('slope'), point.get('aspect')
        slope_error = slope - native_slope if slope is not None and native_slope is not None else None
        stable_direction = (slope is not None and native_slope is not None and min(slope, native_slope) >= .1
                            and aspect is not None and native_aspect is not None)
        aspect_error = circular_difference(aspect, native_aspect) if stable_direction else None
        interior = slope_error is not None and point.get('nativeOnEdge') is False and not hit['onEdge']
        rows.append({**point, 'easting': x, 'northing': y, 'multipatchHeight': mesh,
                     'multipatchPatch': hit['patch'] if hit else None, 'errorMetres': error,
                     'multipatchSlope': slope, 'multipatchAspect': aspect,
                     'multipatchOnEdge': hit['onEdge'] if hit else None,
                     'slopeErrorDegrees': slope_error, 'aspectErrorDegrees': aspect_error,
                     'derivativeInterior': interior})
    errors = [row['errorMetres'] for row in rows if row['errorMetres'] is not None]
    interiors = [row for row in rows if row['derivativeInterior']]
    aspects = [row['aspectErrorDegrees'] for row in interiors if row['aspectErrorDegrees'] is not None]
    return rows, {
        'queryCount': len(rows), 'matchedCount': len(errors),
        'nativeValidCount': sum(row['height'] is not None for row in rows),
        'multipatchValidCount': sum(row['multipatchHeight'] is not None for row in rows),
        'coverageMismatchCount': sum((row['height'] is None) != (row['multipatchHeight'] is None) for row in rows),
        'sampledMaxAbsHeightErrorMetres': max(map(abs, errors), default=0),
        'sampledRmsHeightErrorMetres': math.sqrt(sum(e * e for e in errors) / len(errors)) if errors else None,
        'derivatives': {
            'slopeMatchedCount': len(interiors),
            'boundaryExcludedCount': sum(row['slopeErrorDegrees'] is not None and
                (row.get('nativeOnEdge') is True or row['multipatchOnEdge'] is True) for row in rows),
            'slope': error_stats([row['slopeErrorDegrees'] for row in interiors]),
            'aspectMatchedCount': len(aspects), 'nearFlatExcludedCount': len(interiors) - len(aspects),
            'aspect': error_stats(aspects),
        },
    }


def write_query_csv(path, rows):
    fields = ['id', 'x', 'y', 'easting', 'northing', 'distance', 'height',
              'multipatchHeight', 'errorMetres', 'patch', 'multipatchPatch', 'kind',
              'slope', 'multipatchSlope', 'slopeErrorDegrees', 'aspect', 'multipatchAspect',
              'aspectErrorDegrees', 'nativeOnEdge', 'multipatchOnEdge', 'derivativeInterior']
    with path.open('w', encoding='utf-8-sig', newline='') as file:
        writer = csv.DictWriter(file, fieldnames=fields, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(rows)


def export_comparison_suite(terrain: Terrain, fixture: dict, destination: Path,
                            *, arcgis_script: Path) -> dict:
    if fixture.get('schema') != 'gugis-terrain-query-fixture-v1':
        raise ValueError('Unsupported native query fixture')
    project = bng_projector(terrain)
    revision = fixture['cityRevision']
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    variants = []
    with tempfile.TemporaryDirectory(prefix='gugis-comparison-') as temp:
        root = Path(temp)
        for divisions in RESOLUTIONS:
            nested = root / f'n{divisions}.zip'
            metrics = export_multipatch(terrain, nested, city_revision=revision, subdivisions=divisions)
            directory = root / f'n{divisions}'
            with ZipFile(nested) as package:
                package.extractall(directory)
            nested.unlink()
            files = [{'path': f'n{divisions}/{p.name}', 'bytes': p.stat().st_size,
                      'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}
                     for p in sorted(directory.glob('terrain.*'))]
            dataset_hash = hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest()
            surface = TriangleSurface(directory / 'terrain')
            if surface.triangles != metrics['multipatchTriangles']:
                raise ValueError('Read-back triangle count differs from export')
            rows, queries = compare_queries(surface, fixture['points'], project)
            write_query_csv(directory / 'point-results.csv', rows)
            profiles = []
            for profile in fixture['profiles']:
                samples, summary = compare_queries(surface, profile['points'], project)
                write_query_csv(directory / f"profile-{profile['id']}.csv", samples)
                profiles.append({'id': profile['id'], 'name': profile['name'], 'summary': summary,
                                 'samples': [{k: s.get(k) for k in ('distance', 'height', 'multipatchHeight',
                                     'errorMetres', 'patch', 'kind', 'slope', 'multipatchSlope', 'slopeErrorDegrees',
                                     'aspect', 'multipatchAspect', 'aspectErrorDegrees', 'nativeOnEdge',
                                     'multipatchOnEdge', 'derivativeInterior')} for s in samples]})
            variants.append({**metrics, 'files': files, 'datasetSha256': dataset_hash,
                             'queries': queries, 'profiles': profiles})
        script_bytes = arcgis_script.read_bytes()
        bundle_id = hashlib.sha256(json.dumps({'revision': revision, 'results': variants,
            'fixture': fixture, 'protocol': 'native-enu-derivatives-v1',
            'arcgisScriptSha256': hashlib.sha256(script_bytes).hexdigest()}, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        report = {
            'schema': 'gugis-terrain-comparison-suite-v1', 'bundleId': bundle_id,
            'cityRevision': revision, 'terrainName': terrain.name,
            'demonstration': terrain.demonstration, 'verticalDatum': terrain.vertical_datum,
            'horizontalCrs': 'EPSG:27700', 'nativeKernel': fixture['nativeKernel'],
            'meshKernel': 'PyShp readback + independent barycentric interpolation in EPSG:27700',
            'derivativeMethod': {'frame': 'native local ENU', 'horizontalJacobianStepMetres': .5,
                'aspectMinimumSlopeDegrees': .1, 'boundaryParameterTolerance': 1e-7,
                'summaryPolicy': 'exclude native cell and mesh triangle edges; exclude near-flat directions',
                'aspectConvention': 'downslope, clockwise from local north; signed shortest angular difference'},
            'statistics': fixture['statistics'], 'queryGrid': '41×41 均匀分层点 + 4 个范围外 NoData 探针',
            'variants': variants, 'worstRuledCell': fixture['worstRuledCell'],
            'arcgisRuntimeStatus': 'not-measured',
            'note': '原生高程来自网站内核；三角带高程来自实际 Shapefile 读回的参考插值。误差包含离散与水平投影影响。非 ArcGIS 软件查询耗时；非真实 DTM 精度。',
        }
        (root / 'comparison-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        (root / 'native-terrain.gugis.json').write_text(json.dumps(terrain.model_dump(mode='json', exclude_none=True),
            ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
        native_rows = [{**p, 'easting': project(p['x'], p['y'])[0], 'northing': project(p['x'], p['y'])[1]} for p in fixture['points']]
        write_query_csv(root / 'native-queries.csv', native_rows)
        (root / 'run_arcgis_pro.py').write_bytes(script_bytes)
        (root / 'README.txt').write_text(
            'GUGIS / MultiPatch 同源实验包\n'
            'n1、n2、n4、n8：每个直纹区段沿两个参数方向分别划分 1/2/4/8 份。\n'
            '每个目录包含完整 EPSG:27700 MultiPatch Shapefile，以及相同点/剖面的 CSV。\n'
            'native-terrain.gugis.json 保留原生曲面和来源。所有 Z 保持源高程基准。\n'
            '合成方法演示地形不能视为真实 Bristol DTM。\n'
            'comparison-report.json 包含逐文件 SHA-256、全部分辨率和误差。\n'
            'CSV 另含坡度/坡向：均统一到原生局部 ENU；BNG 面梯度用 0.5 m 中央差分雅可比转换。\n'
            '统计剔除原生区段/三角面边界；坡向另剔除任一坡度小于 0.1 度的点，空值不等于零。\n'
            '剖面保留边界的先命中面单侧坡度并显式标记；这些值不进入导数汇总。\n'
            'ArcGIS Pro：解压后，用其 Python 环境运行 python run_arcgis_pro.py。\n'
            '脚本测量 SearchCursor 几何读取与 CopyFeatures 导入独立临时 FGDB，重复 3 次。\n'
            '它不测量 Scene Viewer / Pro 界面帧率、显存或高程查询工具。\n'
            '脚本完成后，把 arcgis-pro-results-*.json 导入网站对比页；数据仅在本浏览器保留。\n', encoding='utf-8')
        with ZipFile(destination, 'w', compression=ZIP_DEFLATED) as archive:
            for path in sorted(root.rglob('*')):
                if path.is_file():
                    entry = ZipInfo(path.relative_to(root).as_posix(), date_time=(1980, 1, 1, 0, 0, 0))
                    entry.compress_type = ZIP_DEFLATED
                    archive.writestr(entry, path.read_bytes())
    report['packageBytes'] = destination.stat().st_size
    report['packageSha256'] = hashlib.sha256(destination.read_bytes()).hexdigest()
    return report
