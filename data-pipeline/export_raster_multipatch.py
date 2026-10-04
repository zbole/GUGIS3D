"""Export certified local triangles to identical XYZ MultiPatch geometry.

Research-only files. Reads the actual Swiss raster georeferencing, tests saved
geometry against the website kernel, and offers byte-identical native recovery.
No ArcGIS software is executed and no formal city dataset is modified.
"""
import argparse
import csv
import io
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import numpy as np
import rasterio
import shapefile
from pyproj import CRS
from build_strip_compaction_research import ROOT, digest, independent_heights
from benchmark_research_packing import omit_absent_measures, SPEC
from benchmark_research_joined_strips import join_strips, triangles_digest


def packed(value):
    return json.dumps(value, separators=(',', ':')).encode('utf-8')


def read_parts(base):
    with shapefile.Reader(str(base)) as reader:
        if reader.shapeType != shapefile.MULTIPATCH or len(reader) != 1:
            raise ValueError('Expected one MultiPatch feature')
        shape = reader.shape(0)
        if any(kind != shapefile.TRIANGLE_STRIP for kind in shape.partTypes):
            raise ValueError('Expected triangle strips only')
        return [[[float(x), float(y), float(z)] for (x, y), z in
                 zip(shape.points[start:end], shape.z[start:end])]
                for start, end in zip(shape.parts, [*shape.parts[1:], len(shape.points)])]


def readback_heights(parts, xy, origin):
    """Independent barycentric evaluation of saved XYZ parts in local metres."""
    result = np.full(len(xy), np.nan)
    x, y = np.asarray(xy).T
    for part in parts:
        vertices = np.asarray(part) - np.asarray([*origin, 0])
        for i in range(len(vertices)-2):
            a, b, c = vertices[i:i+3]
            if i % 2:
                b, c = c, b
            determinant = (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
            if determinant <= 0:
                raise ValueError('Degenerate or reversed saved triangle')
            west, south = np.minimum(np.minimum(a[:2], b[:2]), c[:2])
            east, north = np.maximum(np.maximum(a[:2], b[:2]), c[:2])
            sites = np.flatnonzero(np.isnan(result) & (x >= west-1e-9) &
                (x <= east+1e-9) & (y >= south-1e-9) & (y <= north+1e-9))
            if not len(sites):
                continue
            dx, dy = x[sites]-a[0], y[sites]-a[1]
            u = (dx*(c[1]-a[1])-dy*(c[0]-a[0]))/determinant
            v = ((b[0]-a[0])*dy-(b[1]-a[1])*dx)/determinant
            inside = (u >= -1e-9) & (v >= -1e-9) & (u+v <= 1+1e-9)
            result[sites[inside]] = a[2]+u[inside]*(b[2]-a[2])+v[inside]*(c[2]-a[2])
    if not np.isfinite(result).all():
        raise ValueError('Saved MultiPatch missed a query site')
    return result


def recover_native(parts, recovery):
    origin = np.asarray([*recovery['origin_xy'], 0])
    points = [(np.asarray(parts[part][vertex])-origin).tolist()
              for part, vertex in recovery['point_locations']]
    return {**recovery['metadata'], 'points': points, 'patches': recovery['patches']}


def fingerprint(path):
    content = path.read_bytes()
    return {'filename': path.name, 'bytes': len(content), 'sha256': digest(content)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    parent_bytes = (ROOT/'shared/raster-triangle-benchmark.json').read_bytes()
    parent = json.loads(parent_bytes)
    case = parent['cases'][0]
    if digest(args.source.read_bytes()) != case['source_sha256']:
        raise ValueError('Swiss raster provenance changed')
    directory = args.input/case['id']
    reference_bytes = (directory/'reference.npz').read_bytes()
    if digest(reference_bytes) != case['source_reference_sha256']:
        raise ValueError('Reference grid changed')
    reference = np.load(io.BytesIO(reference_bytes))
    row, col, height, width = case['source_window']
    with rasterio.open(args.source) as source:
        if source.crs.to_epsg() != 2056:
            raise ValueError('Unexpected source CRS')
        crop = source.read(1, window=rasterio.windows.Window(col, row, width, height))
        if not np.array_equal(crop[::-1], reference['height']):
            raise ValueError('Published local heights differ from georeferenced crop')
        origin = list(source.xy(row+height//2, col+width//2))
        eastings = np.asarray([source.xy(row+height//2, col+i)[0] for i in range(width)])
        northings = np.asarray([source.xy(row+i, col+width//2)[1] for i in range(height)])[::-1]
        if not np.array_equal(eastings-origin[0], reference['x']) or not np.array_equal(northings-origin[1], reference['y']):
            raise ValueError('Local offsets do not match raster pixel centres')
        projection = CRS.from_user_input(source.crs).to_wkt(version='WKT1_ESRI').encode('utf-8')
    fixture_bytes = (directory/'query-fixture.json').read_bytes()
    fixture = json.loads(fixture_bytes)
    native_queries = json.loads((args.input/'native-query-results.json').read_bytes())
    if native_queries['source_sha256'] != parent['native_query_source_sha256']:
        raise ValueError('Native query kernel receipt differs')
    xx, yy = np.meshgrid(reference['x'], reference['y'])
    grid = np.column_stack((xx.ravel(), yy.ravel()))
    args.output.mkdir(parents=True, exist_ok=True)
    public = ROOT/'frontend/public/research/hybrid-terrain'
    results = []
    for pair in case['variants']:
        target = pair['target_m']
        receipt = pair['local_triangles']
        content = (directory/receipt['filename']).read_bytes()
        if digest(content) != receipt['sha256'] or len(content) != receipt['bytes']:
            raise ValueError('Certified native triangles changed')
        terrain = json.loads(content)
        if any(p['kind'] != 'triangle-strip' for p in terrain['patches']):
            raise ValueError('Do not flatten bilinear patches into uncertified triangles')
        points = np.asarray(terrain['points'])
        world = points+np.asarray([*origin, 0])
        coordinate_delta = float(np.abs((world-np.asarray([*origin, 0]))-points).max())
        if coordinate_delta != 0:
            raise ValueError('Georeferencing rounded local vertices')
        original_parts = [world[p['indices']].tolist() for p in terrain['patches']]
        parts, join_map = join_strips(original_parts)
        geometry = triangles_digest(original_parts)
        if triangles_digest(parts) != geometry:
            raise ValueError('Compatible joins changed oriented triangle geometry')
        folder = args.output/f'{target:g}m'
        folder.mkdir(exist_ok=True)
        base = folder/'terrain'
        with shapefile.Writer(str(base), shapeType=shapefile.MULTIPATCH, encoding='utf-8') as writer:
            writer.field('TERRAIN_ID', 'C', size=16)
            writer.multipatch(parts, partTypes=[shapefile.TRIANGLE_STRIP]*len(parts))
            writer.record(f'swiss-{target:g}m')
        removed, records = omit_absent_measures(base)
        if records != 1:
            raise ValueError('Unexpected record grouping')
        base.with_suffix('.prj').write_bytes(projection)
        base.with_suffix('.cpg').write_bytes(b'UTF-8\n')
        saved = read_parts(base)
        if triangles_digest(saved) != geometry:
            raise ValueError('Saved geometry differs')
        locations = [None]*len(points)
        for patch, (group, offset, length) in zip(terrain['patches'], join_map):
            if length != len(patch['indices']):
                raise ValueError('Source patch mapping changed')
            for i, index in enumerate(patch['indices']):
                if locations[index] is None:
                    locations[index] = [group, offset+i]
        if any(location is None for location in locations):
            raise ValueError('Unreferenced native control cannot be recovered')
        metadata = {k:v for k,v in terrain.items() if k not in ('points', 'patches')}
        recovery = {'schema':'gugis-multipatch-native-recovery-v1', 'origin_xy':origin,
            'metadata':metadata, 'point_locations':locations, 'patches':terrain['patches']}
        recovery_path = folder/'native-recovery.json'
        recovery_path.write_bytes(packed(recovery))
        restored = packed(recover_native(saved, json.loads(recovery_path.read_bytes())))
        if restored != content:
            raise ValueError('Native recovery is not byte-identical')
        native = next(q for q in native_queries['records'] if q['case']==case['id'] and q['target_m']==target and q['mode']=='local_triangles')
        if native['archive_sha256'] != receipt['sha256'] or native['fixture_sha256'] != digest(fixture_bytes):
            raise ValueError('Native queries and exported archive differ')
        measured = readback_heights(saved, np.asarray(fixture['xy']), origin)
        difference = float(np.abs(measured-native['values']).max())
        grid_difference = float(np.abs(readback_heights(saved, grid, origin)-independent_heights(terrain, grid)).max())
        if max(difference, grid_difference) > 1e-8:
            raise ValueError('Independent readback differs from native geometry')
        components = [fingerprint(base.with_suffix(ext)) for ext in ('.shp','.shx','.dbf','.prj','.cpg')]
        core_bytes = sum(item['bytes'] for item in components)
        recovery_bytes = recovery_path.stat().st_size
        result = {'target_m':target, 'native_filename':receipt['filename'], 'native_bytes':len(content),
            'native_sha256':digest(content), 'compact_hybrid_bytes':pair['compact_hybrid']['bytes'],
            'core_bytes':core_bytes, 'with_native_recovery_bytes':core_bytes+recovery_bytes,
            'components':components, 'native_recovery':fingerprint(recovery_path),
            'native_vs_core_saving_percent':100*(1-len(content)/core_bytes),
            'native_vs_recoverable_saving_percent':100*(1-len(content)/(core_bytes+recovery_bytes)),
            'hybrid_vs_core_saving_percent':100*(1-pair['compact_hybrid']['bytes']/core_bytes),
            'source_parts':len(original_parts), 'saved_parts':len(saved),
            'source_vertices':sum(map(len, original_parts)), 'saved_vertices':sum(map(len, saved)),
            **geometry, 'coordinate_translation_max_difference_m':coordinate_delta,
            'byte_identical_native_recovery':True, 'removed_absent_measure_bytes':removed,
            'continuous_certificate':receipt['continuous_certificate'],
            'offgrid':{'samples':len(measured), 'native_kernel_max_difference_m':difference,
                       'fixture_sha256':digest(fixture_bytes)},
            'source_grid':{'samples':len(grid), 'native_geometry_max_difference_m':grid_difference},
            'arcgis_execution':None}
        (folder/'native.json').write_bytes(content)
        (folder/'reference.npz').write_bytes(reference_bytes)
        (folder/'query-fixture.json').write_bytes(fixture_bytes)
        (folder/'results.json').write_bytes((json.dumps(result, indent=2)+'\n').encode())
        (folder/'README.txt').write_bytes((
            'ArcGIS-readable research MultiPatch; no ArcGIS software execution.\n'
            f'Open terrain.shp together with SHX/DBF/PRJ/CPG. EPSG:2056; origin {origin}; Z copied in metres.\n'
            'One feature, triangle-strip parts, optional absent M omitted per Esri Table 16.\n'
            'The continuous certificate is against the frozen bilinear raster reference, not unmeasured ground.\n'
            'native-recovery.json restores original point IDs, patches and common metadata byte-identically.\n'
            'Five-component cost excludes this optional recovery sidecar. Both totals are disclosed.\n'
            'Swiss source: ImplicitTerrain authors / swissALTI3D, Federal Office of Topography swisstopo.\n'
            'https://www.swisstopo.admin.ch/en/terms-of-use-free-geodata-and-geoservices\n'
            'https://fengyee.github.io/implicit-terrain/\n'
        ).encode())
        package = public/f'swiss-dem-crop-{target:g}m-multipatch.zip'
        with ZipFile(package, 'w', compression=ZIP_DEFLATED) as archive:
            for path in sorted(folder.iterdir()):
                archive.write(path, path.name)
        result['download'] = fingerprint(package)
        results.append(result)
        print(json.dumps({k:result[k] for k in ('target_m','native_bytes','core_bytes','with_native_recovery_bytes','native_vs_core_saving_percent','hybrid_vs_core_saving_percent')}), flush=True)
    source_paths = ['data-pipeline/export_raster_multipatch.py', 'data-pipeline/benchmark_research_packing.py',
        'data-pipeline/benchmark_research_joined_strips.py', 'data-pipeline/build_strip_compaction_research.py']
    report = {'schema':'gugis-raster-multipatch-comparison-v1', 'generated_at':'2026-10-04',
        'parent_sha256':digest(parent_bytes), 'source_sha256':case['source_sha256'],
        'source_reference_sha256':case['source_reference_sha256'], 'origin_xy':origin, 'crs':'EPSG:2056',
        'crs_note':'Actual Swiss source pixel centres; Z copied in metres. No British CRS or vertical datum conversion.',
        'source_fingerprints':{p:digest((ROOT/p).read_bytes().replace(b'\r\n',b'\n')) for p in source_paths},
        'specification':SPEC, 'native_query_source_sha256':parent['native_query_source_sha256'],
        'method':'Identical oriented planar triangles. One MultiPatch feature, compatible even strips joined, no artificial triangles, no M values. Own independent readback only; no ArcGIS execution.',
        'cost':'Uncompressed SHP+SHX+DBF+PRJ+CPG; optional native-recovery sidecar separately. Native JSON includes shared controls, strip indices and common metadata. Hybrid is a different certified surface; its file ratio is not exact-geometry isolation.',
        'variants':results, 'arcgis_execution':None}
    report_bytes = (json.dumps(report, indent=2)+'\n').encode()
    (ROOT/'shared/raster-multipatch-benchmark.json').write_bytes(report_bytes)
    (public/'raster-multipatch-results.json').write_bytes(report_bytes)
    stream=io.StringIO();writer=csv.writer(stream,lineterminator='\n')
    columns=['target_m','native_bytes','compact_hybrid_bytes','core_bytes','with_native_recovery_bytes','native_vs_core_saving_percent','native_vs_recoverable_saving_percent','hybrid_vs_core_saving_percent']
    writer.writerow(columns);writer.writerows([[r[c] for c in columns] for r in results])
    (public/'raster-multipatch-results.csv').write_bytes(stream.getvalue().encode())


if __name__ == '__main__':
    main()
