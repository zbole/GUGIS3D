"""Licensed ArcGIS Pro run for the six immutable Bristol triangle-strip models.

No third-party Python dependency beyond arcpy. Run only from an extracted,
reviewed package. Writes new temporary FGDBs and a NEW result, never a city.
Source integrity, geometry checks and FGDB creation are outside timed operations.
"""
import argparse
import datetime
import hashlib
import json
import math
import platform
import statistics
import struct
import sys
import tempfile
import time
from pathlib import Path

SCHEMA = 'gugis-bristol-arcgis-run-v1'
REPEATS = 5
OPERATIONS = ['SearchCursor-SHAPE@-and-SAMPLE_ID', 'CopyFeatures-to-new-FGDB']
CACHE = 'one-process-one-warmup-per-operation-five-repeats-no-cold-cache-guarantee'


def sha(content):
    return hashlib.sha256(content).hexdigest()


def coordinate_digest(points):
    return sha(b''.join(struct.pack('<ddd', *p) for p in sorted(points)))


def verified_manifest(root):
    root = root.resolve()  # Windows temporary directories may use 8.3 aliases.
    content = (root / 'manifest.json').read_bytes()
    manifest = json.loads(content)
    if manifest.get('schema') != 'gugis-bristol-arcgis-package-v1':
        raise ValueError('Unsupported real-terrain package')
    expected_ids = {f'{case}-{target}' for case in ('bristol-harbour', 'bristol-brandon-hill')
                    for target in ('0.1m', '0.25m', '0.5m')}
    records = manifest['models']
    if len(records) != 6 or {m['id'] for m in records} != expected_ids:
        raise ValueError('Six fixed real-terrain variants required')
    runner = Path(__file__).read_bytes().replace(b'\r\n', b'\n')
    if sha(runner) != manifest['runner_sha256']:
        raise ValueError('Runner changed after package creation')
    for model in records:
        expected = {f"{model['id']}/terrain{ext}" for ext in ('.shp', '.shx', '.dbf', '.prj', '.cpg')}
        expected.add(f"{model['id']}/native.json")
        if {f['path'] for f in model['files']} != expected or len(model['files']) != 6:
            raise ValueError('Unexpected file paths')
        for file in model['files']:
            path = (root / file['path']).resolve()
            if not path.is_relative_to(root):
                raise ValueError('Dataset escaped package')
            value = path.read_bytes()
            if len(value) != file['bytes'] or sha(value) != file['sha256']:
                raise ValueError(f"Changed dataset: {file['path']}")
    return manifest, sha(content)


def describe(arcpy, source):
    description = arcpy.Describe(str(source))
    if (description.shapeType != 'MultiPatch' or not description.hasZ
            or description.spatialReference.factoryCode != 27700):
        raise ValueError('Expected Z-enabled EPSG:27700 MultiPatch')


def cursor_read(arcpy, source, model, coordinates=False):
    count = vertices = 0
    points = []
    with arcpy.da.SearchCursor(str(source), ['SHAPE@', 'SAMPLE_ID']) as cursor:
        for geometry, identity in cursor:
            if geometry is None or identity != model['id']:
                raise ValueError('Missing geometry or changed sample identity')
            count += 1
            vertices += geometry.pointCount
            if coordinates:
                for part in geometry:
                    for point in part:
                        if point is not None:
                            p = (float(point.X), float(point.Y), float(point.Z))
                            if not all(math.isfinite(v) for v in p):
                                raise ValueError('Non-finite ArcGIS coordinates')
                            points.append(p)
    if count != 1 or vertices != model['multipatch_vertices']:
        raise ValueError('ArcGIS feature/vertex count differs from input')
    if coordinates and (len(points) != vertices or coordinate_digest(points) != model['coordinate_sha256']):
        raise ValueError('ArcGIS coordinate multiset differs from the Shapefile; no valid timing result')
    return count, vertices


def run(root, arcpy):
    root = root.resolve()
    manifest, manifest_sha = verified_manifest(root)
    install = arcpy.GetInstallInfo()
    product = arcpy.ProductInfo()
    if (product in ('NotInitialized', 'Unavailable') or not install.get('Version')
            or install.get('ProductName') != 'ArcGISPro'):
        raise ValueError('An initialized licensed ArcGIS Pro runtime is required')
    results = []
    # Reset inherited geoprocessing environment so extent, output CRS, masks,
    # tolerances or output Z settings cannot silently change the copy operation.
    with arcpy.EnvManager(extent=None, outputCoordinateSystem=None, geographicTransformations=None,
                          outputZFlag='Enabled', outputMFlag='Disabled',
                          XYResolution=None, XYTolerance=None, ZResolution=None, ZTolerance=None):
        with tempfile.TemporaryDirectory(prefix='gugis-bristol-arcgis-') as directory:
            scratch = Path(directory)
            try:
                for model in manifest['models']:
                    source = root / model['id'] / 'terrain.shp'
                    describe(arcpy, source)
                    cursor_read(arcpy, source, model, coordinates=True)  # warm-up + source geometry check
                    reads, copies, sizes = [], [], []
                    for repeat in range(REPEATS+1):
                        # New FGDB creation excluded; first copy excluded as warm-up.
                        gdb = scratch / f"copy_{model['id'].replace('-', '_').replace('.', '_')}_{repeat}.gdb"
                        arcpy.management.CreateFileGDB(str(scratch), gdb.name)
                        target = gdb / 'terrain'
                        if repeat:
                            start = time.perf_counter()
                            cursor_read(arcpy, source, model)
                            reads.append((time.perf_counter()-start)*1000)
                        start = time.perf_counter()
                        arcpy.management.CopyFeatures(str(source), str(target))
                        elapsed = (time.perf_counter()-start)*1000
                        describe(arcpy, target)
                        cursor_read(arcpy, target, model, coordinates=True)
                        arcpy.management.ClearWorkspaceCache(str(gdb))
                        if repeat:
                            copies.append(elapsed)
                            sizes.append(sum(p.stat().st_size for p in gdb.rglob('*')
                                             if p.is_file() and not p.name.endswith('.lock')))
                    results.append({'id': model['id'], 'native_sha256': model['native_sha256'],
                        'geometry_sha256': model['geometry_sha256'], 'coordinate_sha256': model['coordinate_sha256'],
                        'feature_count': 1, 'vertex_count': model['multipatch_vertices'],
                        'horizontal_wkid': 27700, 'has_z': True, 'source_coordinates_identical': True,
                        'copy_coordinates_identical': True, 'read_ms': reads, 'copy_ms': copies,
                        'copy_output_bytes': sizes, 'median_read_ms': statistics.median(reads),
                        'median_copy_ms': statistics.median(copies)})
                    print(model['id'], flush=True)
            finally:
                arcpy.management.ClearWorkspaceCache()
    return {'schema': SCHEMA, 'manifest_sha256': manifest_sha, 'runner_sha256': manifest['runner_sha256'],
        'measured_at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'repeats': REPEATS, 'cache_policy': CACHE, 'operations': OPERATIONS,
        'runtime': {'product': install.get('ProductName', ''), 'version': install['Version'],
                    'license': product, 'python': sys.version.split()[0], 'os': platform.platform(),
                    'processor': platform.processor()},
        'scope': 'ArcGIS full SHAPE@ reads and FGDB copies only; no FPS, memory, terrain-query or cross-product speedup claim. Coordinate multiset checks do not prove FGDB patch topology.',
        'results': results}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    root = args.directory.resolve()
    verified_manifest(root)  # Fail before importing ArcGIS or creating any scratch.
    if args.output.exists():
        raise FileExistsError('Result exists; choose a new output file')
    try:
        import arcpy
    except ImportError as error:
        raise SystemExit('Use the licensed ArcGIS Pro Python environment. No result was produced.') from error
    report = run(root, arcpy)
    # Exclusive creation prevents a late-arriving file from being overwritten.
    with args.output.open('x', encoding='utf-8') as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2, allow_nan=False)
        handle.write('\n')
    print(args.output)


if __name__ == '__main__':
    main()
