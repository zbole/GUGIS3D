"""Reproducible MultiPatch triangle-strip baseline for a GUGIS terrain.

This exports a file that ArcGIS Pro can open; it does not benchmark ArcGIS Pro's
renderer, memory manager, or TIN implementation. Ruled cells are tessellated at
a configurable number of intervals per axis; planar triangle strips retain their
vertices. All Z values remain in the source datum.
"""
import json
import math
import tempfile
from functools import lru_cache
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

import shapefile
from pyproj import CRS, Transformer

from ..environment_models import Terrain
from .terrain_builder import upgrade_legacy_fans


SUBDIVISIONS = 2


def terrain_json_bytes(terrain: Terrain) -> int:
    """Size of the standalone compact GUGIS terrain payload, including metadata."""
    return len(json.dumps(terrain.model_dump(mode='json', exclude_none=True),
                          ensure_ascii=False, separators=(',', ':')).encode('utf-8'))


def bng_projector(terrain: Terrain):
    """The shared horizontal ENU -> British National Grid export transform."""
    origin_to_ecef = Transformer.from_crs(4979, 4978, always_xy=True)
    ecef_to_geo = Transformer.from_crs(4978, 4326, always_xy=True)
    geo_to_bng = Transformer.from_crs(4326, 27700, always_xy=True)
    ox, oy, oz = origin_to_ecef.transform(terrain.longitude, terrain.latitude, 0)
    lon, lat = math.radians(terrain.longitude), math.radians(terrain.latitude)
    east = (-math.sin(lon), math.cos(lon), 0)
    north = (-math.sin(lat) * math.cos(lon), -math.sin(lat) * math.sin(lon), math.cos(lat))

    @lru_cache(maxsize=200000)
    def project(x, y):
        ex = ox + east[0] * x + north[0] * y
        ey = oy + east[1] * x + north[1] * y
        ez = oz + east[2] * x + north[2] * y
        longitude, latitude, _ = ecef_to_geo.transform(ex, ey, ez)
        return geo_to_bng.transform(longitude, latitude)
    return project


def export_multipatch(terrain: Terrain, destination: Path, *, city_revision: str = '',
                      subdivisions: int = SUBDIVISIONS) -> dict:
    """Write a ZIP with a 3D MultiPatch shapefile and return audited metrics."""
    if isinstance(subdivisions, bool) or not isinstance(subdivisions, int) or not 1 <= subdivisions <= 8:
        raise ValueError('Subdivision count must be an integer from 1 to 8')
    terrain = upgrade_legacy_fans(terrain)
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    project = bng_projector(terrain)

    def xyz(point):
        x, y = project(point[0], point[1])
        return [x, y, point[2]]

    def ruled(a, b, c, d, u, v):
        return [(1 - v) * ((1 - u) * a[i] + u * c[i]) +
                v * ((1 - u) * b[i] + u * d[i]) for i in range(3)]

    part_count = 0
    vertex_entries = 0
    mesh_triangles = 0
    native_triangles = 0
    max_error = 0.0
    squared_error_area = 0.0
    surface_area = 0.0
    points = terrain.points
    with tempfile.TemporaryDirectory(prefix='gugis-terrain-') as temp:
        base = Path(temp) / 'terrain'
        with shapefile.Writer(str(base), shapeType=shapefile.MULTIPATCH, encoding='utf-8') as writer:
            writer.field('PATCH_ID', 'C', size=64)
            writer.field('SURFACE', 'C', size=16)
            for patch in terrain.patches:
                parts = []
                if patch.kind == 'triangle-strip':
                    parts.append([xyz(points[index]) for index in patch.indices])
                    native_triangles += len(patch.indices) - 2
                else:
                    for ia, ib, ic, id_ in zip(patch.left, patch.right,
                                               patch.left[1:], patch.right[1:]):
                        a, b, c, d = [points[index] for index in (ia, ib, ic, id_)]
                        native_triangles += 2
                        delta = a[2] - b[2] - c[2] + d[2]
                        max_error = max(max_error, abs(delta) / (4 * subdivisions**2))
                        area = (abs((c[0]-a[0])*(b[1]-a[1])-(c[1]-a[1])*(b[0]-a[0])) +
                                abs((d[0]-c[0])*(b[1]-c[1])-(d[1]-c[1])*(b[0]-c[0]))) / 2
                        squared_error_area += area * (delta / (subdivisions**2 * math.sqrt(90)))**2
                        surface_area += area
                        for v in range(subdivisions):
                            # Upper/lower ordering gives an upward-facing strip.
                            part = []
                            for u in range(subdivisions + 1):
                                part.append(xyz(ruled(a, b, c, d, u / subdivisions,
                                                       (v + 1) / subdivisions)))
                                part.append(xyz(ruled(a, b, c, d, u / subdivisions,
                                                       v / subdivisions)))
                            parts.append(part)
                writer.multipatch(parts, partTypes=[shapefile.TRIANGLE_STRIP] * len(parts))
                writer.record(patch.id, patch.kind)
                part_count += len(parts)
                vertex_entries += sum(len(part) for part in parts)
                mesh_triangles += sum(len(part) - 2 for part in parts)
        base.with_suffix('.prj').write_text(CRS.from_epsg(27700).to_wkt('WKT1_ESRI'), encoding='utf-8')
        base.with_suffix('.cpg').write_text('UTF-8\n', encoding='ascii')
        with shapefile.Reader(str(base)) as reader:
            if reader.shapeType != shapefile.MULTIPATCH or len(reader) != len(terrain.patches):
                raise ValueError('MultiPatch readback did not preserve terrain patch count')
            read_parts = read_vertices = 0
            for shape in reader.iterShapes():
                if any(kind != shapefile.TRIANGLE_STRIP for kind in shape.partTypes):
                    raise ValueError('MultiPatch readback contains a non-strip part')
                read_parts += len(shape.parts)
                read_vertices += len(shape.points)
            if read_parts != part_count or read_vertices != vertex_entries:
                raise ValueError('MultiPatch readback lost strip parts or vertices')
        components = [base.with_suffix(ext) for ext in ('.shp', '.shx', '.dbf', '.prj', '.cpg')]
        file_bytes = sum(path.stat().st_size for path in components)
        with ZipFile(destination, 'w', compression=ZIP_DEFLATED) as archive:
            for path in components:
                archive.write(path, arcname=path.name)
    native_bytes = terrain_json_bytes(terrain)
    return {
        'method': 'gugis-terrain-json-vs-esri-multipatch-triangle-strip',
        'cityRevision': city_revision,
        'terrainName': terrain.name,
        'demonstration': terrain.demonstration,
        'terrainSource': terrain.source.get('文件', terrain.source.get('来源', '')),
        'horizontalCrs': 'EPSG:27700',
        'verticalDatum': terrain.vertical_datum,
        'ruledSubdivisions': subdivisions,
        'controlPoints': len(points),
        'nativePatches': len(terrain.patches),
        'ruledPatches': sum(p.kind == 'ruled-strip' for p in terrain.patches),
        'triangleStrips': sum(p.kind == 'triangle-strip' for p in terrain.patches),
        'nativeTriangles': native_triangles,
        'multipatchParts': part_count,
        'multipatchVertexEntries': vertex_entries,
        'multipatchTriangles': mesh_triangles,
        'gugisTerrainBytes': native_bytes,
        'multipatchFilesBytes': file_bytes,
        'storageSavingPercent': (1 - native_bytes / file_bytes) * 100,
        'maxRuledHeightErrorMetres': max_error,
        'rmsRuledHeightErrorMetres': math.sqrt(squared_error_area / surface_area) if surface_area else 0.0,
        'packageBytes': destination.stat().st_size,
        'readBackVerified': True,
        'note': '磁盘格式比较；MultiPatch 在此由同一 GUGIS 控制网导出。未运行 ArcGIS Pro，不能推断其内存或帧率。误差为直纹曲面相对三角带离散的参数域高程误差。',
    }
