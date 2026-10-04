"""Publish fixed Bristol experiments and exact-geometry MultiPatch round trips."""
import argparse
import csv
import io
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

import numpy as np
import shapefile
from pyproj import CRS
from build_bristol_terrain_benchmark import ROOT, digest, packed
from benchmark_research_joined_strips import join_strips, triangles_digest
from benchmark_research_packing import omit_absent_measures, SPEC
from export_raster_multipatch import read_parts, readback_heights, recover_native, fingerprint


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    args = parser.parse_args()
    parent_bytes = (args.input / 'results.json').read_bytes()
    report = json.loads(parent_bytes)
    audit_bytes = (args.input / 'native-audit.json').read_bytes()
    audit = json.loads(audit_bytes)
    if audit['parent_sha256'] != digest(parent_bytes):
        raise ValueError('Native audit refers to a different build')
    report.update(build_receipt_sha256=digest(parent_bytes), native_audit_sha256=digest(audit_bytes),
                  native_kernel_sha256=audit['native_kernel_sha256'], native_runner_sha256=audit['runner_sha256'],
                  native_query_scope=audit['scope'], multipatch_specification=SPEC,
                  multipatch_scope='Identical oriented local-triangle geometry in EPSG:27700, ODN Z. One feature, triangle strips, absent optional M omitted. Five-component cost and native recovery cost separate; no actual ArcGIS execution.',
                  arcgis_execution=None)
    for name in ['data-pipeline/publish_bristol_terrain_benchmark.py',
                 'data-pipeline/benchmark_research_joined_strips.py', 'data-pipeline/benchmark_research_packing.py',
                 'data-pipeline/export_raster_multipatch.py']:
        report['scripts'][name] = digest((ROOT / name).read_bytes().replace(b'\r\n', b'\n'))
    public = ROOT / 'frontend/public/research/bristol-certified'
    public.mkdir(parents=True, exist_ok=True)
    rows = []
    for case in report['cases']:
        folder = args.input / case['id']
        fixture = json.loads((folder / 'query-fixture.json').read_bytes())
        for pair in case['variants']:
            target = pair['target_m']
            for family in ('hybrid', 'compact_hybrid', 'local_triangles'):
                matches = [r for r in audit['records'] if r['case_id'] == case['id'] and r['target_m'] == target and r['family'] == family]
                if len(matches) != 1 or matches[0]['archive_sha256'] != pair[family]['sha256']:
                    raise ValueError('Audit/model mismatch')
                pair[family]['query_audit'] = matches[0]
            native = pair['local_triangles']
            content = (folder / native['filename']).read_bytes()
            if digest(content) != native['sha256']:
                raise ValueError('Native triangles changed')
            terrain = json.loads(content)
            if any(p['kind'] != 'triangle-strip' for p in terrain['patches']):
                raise ValueError('Do not flatten certified bilinear patches')
            origin = np.asarray([*case['origin_bng'], 0])
            points = np.asarray(terrain['points'])
            world = points + origin
            if not np.array_equal(world-origin, points):
                raise ValueError('BNG translation rounded local controls')
            original = [world[p['indices']].tolist() for p in terrain['patches']]
            parts, mapping = join_strips(original)
            geometry = triangles_digest(original)
            if triangles_digest(parts) != geometry:
                raise ValueError('Joining changed directed triangles')
            exports = folder / f'multipatch-{target:g}m'
            exports.mkdir(exist_ok=True)
            base = exports / 'terrain'
            with shapefile.Writer(str(base), shapeType=shapefile.MULTIPATCH) as writer:
                writer.field('SAMPLE_ID', 'C', size=32)
                writer.multipatch(parts, partTypes=[shapefile.TRIANGLE_STRIP]*len(parts))
                writer.record(f"{case['id']}-{target:g}m")
            removed, records = omit_absent_measures(base)
            if records != 1:
                raise ValueError('Expected one feature')
            base.with_suffix('.prj').write_bytes(CRS.from_epsg(27700).to_wkt(version='WKT1_ESRI').encode())
            base.with_suffix('.cpg').write_bytes(b'UTF-8\n')
            saved = read_parts(base)
            if triangles_digest(saved) != geometry:
                raise ValueError('Readback geometry changed')
            locations = [None]*len(points)
            for patch, (group, offset, length) in zip(terrain['patches'], mapping):
                if length != len(patch['indices']):
                    raise ValueError('Patch mapping changed')
                for i, index in enumerate(patch['indices']):
                    if locations[index] is None:
                        locations[index] = [group, offset+i]
            if any(p is None for p in locations):
                raise ValueError('Unrecoverable control')
            recovery = {'origin_xy': case['origin_bng'], 'metadata': {k:v for k,v in terrain.items() if k not in ('points', 'patches')},
                        'point_locations': locations, 'patches': terrain['patches']}
            recovery_path = exports / 'native-recovery.json'
            recovery_path.write_bytes(packed(recovery))
            if packed(recover_native(saved, json.loads(recovery_path.read_bytes()))) != content:
                raise ValueError('Native archive did not recover byte-identically')
            queries = np.genfromtxt(folder / native['query_audit']['csv']['filename'], delimiter=',', skip_header=1)
            native_values = queries[:, 3]
            measured = readback_heights(saved, np.asarray(fixture['xy']), case['origin_bng'])
            difference = float(np.max(np.abs(measured-native_values)))
            if difference > 1e-8:
                raise ValueError('MultiPatch/native height mismatch')
            components = [fingerprint(base.with_suffix(ext)) for ext in ('.shp', '.shx', '.dbf', '.prj', '.cpg')]
            core = sum(c['bytes'] for c in components)
            pair['multipatch'] = {'components': components, 'core_bytes': core,
                                 'native_recovery': fingerprint(recovery_path), 'recoverable_bytes': core+recovery_path.stat().st_size,
                                 'native_vs_core_saving_percent': 100*(1-native['bytes']/core),
                                 'native_vs_recoverable_saving_percent': 100*(1-native['bytes']/(core+recovery_path.stat().st_size)),
                                 'original_parts': len(original), 'saved_parts': len(parts), 'geometry': geometry,
                                 'native_height_max_difference_m': difference, 'queries': len(measured),
                                 'native_recovery_byte_identical': True, 'removed_absent_m_bytes': removed,
                                 'arcgis_execution': None}
            pair['compact_vs_local_saving_percent'] = 100*(1-pair['compact_hybrid']['bytes']/native['bytes'])
            for family in ('hybrid', 'compact_hybrid', 'local_triangles'):
                model = pair[family]; q = model['query_audit']
                rows.append([case['id'], target, family, model['bytes'], model['points'], model['continuous_bound_m'],
                             q['rmse_m'], q['max_sampled_m'], model['build_validate_ms'], q['index_ms'], q['query_batch_median_ms']])
            (exports / 'comparison.json').write_bytes(packed(pair))
            print(json.dumps({'case': case['id'], 'target': target, 'native_bytes': native['bytes'], 'core_bytes': core,
                              'recoverable_bytes': pair['multipatch']['recoverable_bytes'],
                              'native_vs_core_saving_percent': pair['multipatch']['native_vs_core_saving_percent']}), flush=True)
        package = public / f"{case['id']}-experiment.zip"
        with ZipFile(package, 'w', compression=ZIP_DEFLATED) as archive:
            for path in sorted(folder.rglob('*')):
                if path.is_file():
                    archive.write(path, path.relative_to(folder).as_posix())
            archive.writestr('build-receipt.json', parent_bytes)
            archive.writestr('native-audit.json', audit_bytes)
            archive.write(ROOT / 'backend/data/terrain/DATA_LICENSE.md', 'DATA_LICENSE.md')
            archive.writestr('README.txt',
                'Fixed EA 2022 1m DTM source crop, British National Grid EPSG:27700, ODN heights.\n'
                'Research models use local BNG offsets: NOT city ENU coordinates. Do not directly insert into city scenes.\n'
                'Open multipatch-*/terrain.shp with SHX/DBF/PRJ/CPG in compatible software. No ArcGIS application was executed.\n'
                'Native JSON includes shared control IDs and metadata; MultiPatch core does not preserve these.\n'
                'Native recovery sidecar cost is reported separately and recovers byte-identical JSON.\n'
                'Continuous certificate is relative to interpolated source raster, not unknown ground truth.\n')
        case['download'] = fingerprint(package)
    content = (json.dumps(report, ensure_ascii=False, indent=2)+'\n').encode()
    (ROOT / 'shared/bristol-certified-terrain.json').write_bytes(content)
    (public / 'results.json').write_bytes(content)
    stream = io.StringIO()
    writer = csv.writer(stream, lineterminator='\n')
    writer.writerow(['case', 'target_m', 'family', 'native_bytes', 'points', 'continuous_bound_m', 'rmse_m',
                     'max_sampled_m', 'build_validate_ms', 'index_ms', '4096_query_median_ms'])
    writer.writerows(rows)
    (public / 'results.csv').write_bytes(stream.getvalue().encode())


if __name__ == '__main__':
    main()
