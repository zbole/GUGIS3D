"""Run inside ArcGIS Pro's Python environment after extracting the suite ZIP.

Measures full geometry cursor reads and Shapefile -> new FGDB CopyFeatures.
Warm, repeated operations in one process; no UI/FPS/memory/query-speed claim.
The script only writes its own temporary geodatabases and a result JSON.
"""
import argparse
import datetime
import hashlib
import json
import platform
import statistics
import sys
import tempfile
import time
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    root = args.directory.resolve()
    manifest = json.loads((root / 'comparison-report.json').read_text(encoding='utf-8'))
    if manifest.get('schema') != 'gugis-terrain-comparison-suite-v1':
        raise ValueError('Unsupported comparison package')
    variants = manifest['variants']
    if [v['ruledSubdivisions'] for v in variants] != [1, 2, 4, 8]:
        raise ValueError('Unexpected resolution variants')
    # Verify only the five expected files, before starting ArcGIS operations.
    for variant in variants:
        n = variant['ruledSubdivisions']
        expected = {f'n{n}/terrain{ext}' for ext in ('.shp', '.shx', '.dbf', '.prj', '.cpg')}
        if {f['path'] for f in variant['files']} != expected:
            raise ValueError('Unexpected dataset paths')
        for file in variant['files']:
            content = (root / file['path']).read_bytes()
            if len(content) != file['bytes'] or hashlib.sha256(content).hexdigest() != file['sha256']:
                raise ValueError(f"Changed dataset: {file['path']}")
    try:
        import arcpy
    except ImportError as error:
        raise SystemExit('Use ArcGIS Pro Python Command Prompt / its licensed Python environment.') from error
    install = arcpy.GetInstallInfo()
    results = []
    with tempfile.TemporaryDirectory(prefix='gugis-arcgis-', dir=root) as scratch:
        scratch = Path(scratch).resolve()
        if not scratch.is_relative_to(root):
            raise ValueError('Scratch folder escaped the extracted package')
        for variant in variants:
            n = variant['ruledSubdivisions']
            source = str(root / f'n{n}' / 'terrain.shp')
            description = arcpy.Describe(source)
            if description.shapeType != 'MultiPatch' or not description.hasZ or description.spatialReference.factoryCode != 27700:
                raise ValueError('ArcGIS did not recognize a Z-enabled EPSG:27700 MultiPatch')
            reads, copies, output_sizes = [], [], []
            feature_count = vertex_count = None
            for run in range(3):
                start = time.perf_counter()
                rows = vertices = 0
                with arcpy.da.SearchCursor(source, ['SHAPE@', 'PATCH_ID']) as cursor:
                    for geometry, patch_id in cursor:
                        if geometry is None or not patch_id:
                            raise ValueError('ArcGIS cursor lost geometry or patch identity')
                        rows += 1
                        vertices += geometry.pointCount
                reads.append((time.perf_counter() - start) * 1000)
                if rows != variant['nativePatches']:
                    raise ValueError('ArcGIS cursor feature count differs from the package')
                if feature_count is not None and (rows != feature_count or vertices != vertex_count):
                    raise ValueError('Repeated ArcGIS reads produced inconsistent counts')
                feature_count, vertex_count = rows, vertices
                gdb = scratch / f'copy_n{n}_r{run}.gdb'
                arcpy.management.CreateFileGDB(str(scratch), gdb.name)
                output = str(gdb / 'terrain')
                start = time.perf_counter()
                arcpy.management.CopyFeatures(source, output)
                copies.append((time.perf_counter() - start) * 1000)
                if int(arcpy.management.GetCount(output)[0]) != rows:
                    raise ValueError('FGDB copy lost features')
                output_sizes.append(sum(p.stat().st_size for p in gdb.rglob('*') if p.is_file() and not p.name.endswith('.lock')))
                arcpy.management.ClearWorkspaceCache(str(gdb))
            results.append({'subdivisions': n, 'datasetSha256': variant['datasetSha256'],
                'shapeType': 'MultiPatch', 'hasZ': True, 'horizontalWkid': 27700,
                'featureCount': feature_count, 'vertexCount': vertex_count,
                'readMs': reads, 'copyMs': copies, 'copyOutputBytes': output_sizes,
                'medianReadMs': statistics.median(reads), 'medianCopyMs': statistics.median(copies)})
    report = {'schema': 'gugis-arcgis-pro-run-v1', 'cityRevision': manifest['cityRevision'],
        'bundleId': manifest['bundleId'], 'repeats': 3,
        'measuredAtUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'runtime': {'product': install.get('ProductName', ''), 'version': install.get('Version', ''),
                    'python': sys.version.split()[0], 'os': platform.system(), 'processor': platform.processor()},
        'cachePolicy': 'one-process-repeated-no-cold-cache-guarantee',
        'operations': ['SearchCursor-SHAPE@-and-PATCH_ID', 'CopyFeatures-to-new-FGDB'],
        'results': results}
    output = args.output or root / f"arcgis-pro-results-{datetime.datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(output)


if __name__ == '__main__':
    main()
