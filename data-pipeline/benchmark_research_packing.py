"""Audit MultiPatch storage against a compact single-feature XYZ baseline.

Keeps identical triangle-strip parts, removes absent optional measures, and
independently reads back geometry. Does not execute ArcGIS. Derived files only.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct
from zipfile import ZipFile, ZIP_DEFLATED
import numpy as np
import shapefile
from export_research_multipatch import rasterize, ROOT

SPEC = 'https://www.esri.com/library/whitepapers/pdfs/shapefile.pdf'


def digest_parts(reader):
    """Record grouping and optional M excluded; ordered XYZ/part types retained."""
    digest = hashlib.sha256()
    parts = vertices = records = 0
    for shape in reader.iterShapes():
        records += 1
        for start, end, kind in zip(shape.parts, [*shape.parts[1:], len(shape.points)], shape.partTypes):
            if kind != shapefile.TRIANGLE_STRIP:
                raise ValueError('Unexpected non-strip geometry')
            digest.update(struct.pack('<II', kind, end-start))
            for xy, z in zip(shape.points[start:end], shape.z[start:end]):
                digest.update(struct.pack('<ddd', *xy, z))
            parts += 1
            vertices += end-start
    return {'parts': parts, 'vertices': vertices, 'records': records, 'xyz_parts_sha256': digest.hexdigest()}


def omit_absent_measures(base):
    """Esri Table 16: M range/array optional. Rewrite our own generated files."""
    content = base.with_suffix('.shp').read_bytes()
    output = bytearray(content[:100])
    index = bytearray(base.with_suffix('.shx').read_bytes()[:100])
    cursor = 100
    records = removed = 0
    while cursor < len(content):
        number, words = struct.unpack_from('>II', content, cursor)
        body = content[cursor+8:cursor+8+words*2]
        if len(body) != words*2 or struct.unpack_from('<I', body)[0] != 31:
            raise ValueError('Malformed generated MultiPatch record')
        n_parts, n_points = struct.unpack_from('<II', body, 36)
        xyz_length = 60 + 8*n_parts + 24*n_points
        if len(body) != xyz_length+16+8*n_points:
            raise ValueError('Unexpected XYZ/M record size')
        measures = struct.unpack_from(f'<{n_points+2}d', body, xyz_length)
        if any(not math.isfinite(value) or value >= -1e38 for value in measures):
            raise ValueError('Cannot omit real measures')
        index.extend(struct.pack('>II', len(output)//2, xyz_length//2))
        output.extend(struct.pack('>II', number, xyz_length//2))
        output.extend(body[:xyz_length])
        removed += len(body)-xyz_length
        cursor += 8+words*2
        records += 1
    if cursor != len(content):
        raise ValueError('Record stream is truncated')
    struct.pack_into('>I', output, 24, len(output)//2)
    struct.pack_into('>I', index, 24, len(index)//2)
    # Our original header has only NoData measures; optional ranges are unused.
    output[84:100] = b'\0'*16
    index[84:100] = b'\0'*16
    base.with_suffix('.shp').write_bytes(output)
    base.with_suffix('.shx').write_bytes(index)
    return removed, records


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    args = parser.parse_args()
    precision_bytes = (ROOT/'shared/implicit-terrain-benchmark.json').read_bytes()
    precision = json.loads(precision_bytes)
    reports = []
    for variant in precision['variants']:
        stride = variant['stride_m']
        native_bytes = (args.input/f'gugis-{stride}m.json').read_bytes()
        if hashlib.sha256(native_bytes).hexdigest() != variant['sha256']:
            raise ValueError('Native archive differs from precision experiment')
        original = args.input/f'multipatch-{stride}m'/'terrain'
        for component in variant['multipatch']['components']:
            raw = (original.parent/component['filename']).read_bytes()
            if len(raw) != component['bytes'] or hashlib.sha256(raw).hexdigest() != component['sha256']:
                raise ValueError('Original per-patch baseline has changed')
        terrain = json.loads(native_bytes)
        output = args.input/f'packed-{stride}m'
        output.mkdir(exist_ok=True)
        base = output/'terrain'
        ordered_parts = []
        with shapefile.Reader(str(original)) as reader:
            original_digest = digest_parts(reader)
            for shape in reader.iterShapes():
                for start, end in zip(shape.parts, [*shape.parts[1:], len(shape.points)]):
                    ordered_parts.append([[*xy,z] for xy,z in zip(shape.points[start:end],shape.z[start:end])])
        with shapefile.Writer(str(base), shapeType=shapefile.MULTIPATCH, encoding='utf-8') as writer:
            writer.field('TERRAIN_ID','C',size=16)
            writer.multipatch(ordered_parts,partTypes=[shapefile.TRIANGLE_STRIP]*len(ordered_parts))
            writer.record(f'swiss-{stride}m')
        del ordered_parts
        removed, count = omit_absent_measures(base)
        if count != 1:
            raise ValueError('Expected one compact terrain feature')
        for suffix in ('.prj','.cpg'):
            base.with_suffix(suffix).write_bytes(original.with_suffix(suffix).read_bytes())
        mapping, offset = [], 0
        for patch in terrain['patches']:
            n = 1 if patch['kind']=='triangle-strip' else len(patch['left'])-1
            mapping.append([patch['id'],patch['kind'],offset,n])
            offset += n
        sidecar = {'schema':'gugis-multipatch-patch-map-v1',
            'columns':['patch_id','native_kind','first_part_zero_based','part_count'],
            'metadata':{k:v for k,v in terrain.items() if k not in ('points','patches')},
            'coordinate_origin_epsg2056':[2494500,1141500], 'patches':mapping,
            'limit':'Identifies source patches and metadata; does not restore shared control-point IDs or exact ruled surfaces from tessellated XYZ.'}
        sidecar_path = output/'patch-map.json'
        sidecar_path.write_bytes((json.dumps(sidecar,separators=(',',':'))+'\n').encode())
        with shapefile.Reader(str(base)) as reader:
            compact_digest = digest_parts(reader)
            if compact_digest['records'] != 1 or any(compact_digest[k]!=original_digest[k]
                for k in ('parts','vertices','xyz_parts_sha256')):
                raise ValueError('Packed geometry changed')
            if offset != compact_digest['parts']:
                raise ValueError('Patch sidecar does not cover the parts')
            if stride in (8,16):
                grid, parts, triangles = rasterize(reader)
                previous = np.load(args.input/f'multipatch-{stride}m.npy')
                if not np.array_equal(grid,previous):
                    raise ValueError('Independent packed readback changed reconstructed heights')
                readback_difference = float(np.abs(grid-previous).max())
            else:
                readback_difference = None
        components = [{'filename':p.name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
            for p in [base.with_suffix(ext) for ext in ('.shp','.shx','.dbf','.prj','.cpg')]]
        geometry_bytes = sum(p['bytes'] for p in components)
        total_bytes = geometry_bytes + sidecar_path.stat().st_size
        row = {'id':variant['id'],'stride_m':stride,'native_sha256':variant['sha256'],
            'native_bytes':variant['bytes'],'per_patch_bytes':variant['multipatch']['bytes'],
            'geometry_only_bytes':geometry_bytes,'patch_metadata_bytes':sidecar_path.stat().st_size,
            'with_patch_metadata_bytes':total_bytes,'geometry_only_native_saving_percent':100*(1-variant['bytes']/geometry_bytes),
            'with_patch_metadata_native_saving_percent':100*(1-variant['bytes']/total_bytes),
            'absent_measure_bytes_removed':removed,'original':original_digest,'packed':compact_digest,
            'readback_vs_per_patch_max_m':readback_difference,'components':components,
            'sidecar_sha256':hashlib.sha256(sidecar_path.read_bytes()).hexdigest(),
            'arcgis_execution':None}
        reports.append(row)
        print(json.dumps({k:row[k] for k in ['id','per_patch_bytes','geometry_only_bytes','with_patch_metadata_bytes',
            'geometry_only_native_saving_percent','with_patch_metadata_native_saving_percent']}),flush=True)
        if stride in (8,16):
            package = ROOT/f'frontend/public/research/implicit-terrain/terrain-{stride}m-packed.zip'
            with ZipFile(package,'w',compression=ZIP_DEFLATED) as archive:
                for item in components: archive.write(output/item['filename'],item['filename'])
                archive.write(sidecar_path,sidecar_path.name)
                archive.write(args.input/f'gugis-{stride}m.json','gugis-terrain.json')
                archive.writestr('readme.txt',f'Compact one-feature MultiPatch XYZ, EPSG:2056, {stride} m Swiss research sample.\n'
                    'All triangle-strip parts retain exact original XYZ/order. Optional absent measures omitted per Esri Table 16.\n'
                    'patch-map.json maps original patch IDs and kinds; not a lossless native terrain restoration.\n'
                    'GUGIS and Shapefile file sizes are compared separately, not using ZIP bytes. ArcGIS software not executed.\n'
                    'Source DEM: ImplicitTerrain authors / swissALTI3D, Federal Office of Topography swisstopo.\n'
                    'https://fengyee.github.io/implicit-terrain/\nhttps://www.swisstopo.admin.ch/en/terms-of-use-free-geodata-and-geoservices\n'
                    'No author weights or code. Not UK city terrain. Vertical datum unknown.\n')
    report = {'schema':'gugis-multipatch-packing-benchmark-v1','parent_report_sha256':hashlib.sha256(precision_bytes).hexdigest(),
        'source_sha256':precision['dataset']['source_sha256'],'specification':SPEC,
        'method':'Same ordered Triangle Strip XYZ parts. Compare per-patch records (original) vs one terrain feature with absent optional M removed. Report five file components separately from an optional patch-ID/kind/metadata sidecar. Exact ordered geometry hashes all variants; independent million-pixel raster readback at 8m/16m. No ArcGIS execution.',
        'variants':reports}
    content = (json.dumps(report,indent=2)+'\n').encode()
    (ROOT/'shared/implicit-terrain-packing.json').write_bytes(content)
    (ROOT/'frontend/public/research/implicit-terrain/packing-results.json').write_bytes(content)


if __name__=='__main__':main()
