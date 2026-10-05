"""Repackage existing exact-geometry MultiPatch fixtures; no remeshing or city writes."""
import hashlib
import io
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo
import shapefile
from benchmark_research_joined_strips import triangles_digest
from run_bristol_arcgis import coordinate_digest

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT/'frontend/public/research/bristol-arcgis'


def sha(content):
    return hashlib.sha256(content).hexdigest()


def packed(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False)+'\n').encode()


def main():
    parent_bytes = (ROOT/'shared/bristol-certified-terrain.json').read_bytes()
    parent = json.loads(parent_bytes)
    l2_bytes = (ROOT/'shared/bristol-global-l2.json').read_bytes()
    l2 = json.loads(l2_bytes)
    runner = (ROOT/'data-pipeline/run_bristol_arcgis.py').read_bytes().replace(b'\r\n',b'\n')
    contents = {'run_bristol_arcgis.py': runner}
    records = []
    for case in parent['cases']:
        package = ROOT/'frontend/public/research/bristol-certified'/case['download']['filename']
        archive_bytes = package.read_bytes()
        if sha(archive_bytes) != case['download']['sha256']:
            raise ValueError('Parent package changed')
        with ZipFile(io.BytesIO(archive_bytes)) as archive:
            for pair in case['variants']:
                target = pair['target_m']
                identity = f"{case['id']}-{target:g}m"
                files = []
                native = archive.read(pair['local_triangles']['filename'])
                if sha(native) != pair['local_triangles']['sha256']:
                    raise ValueError('Native archive changed')
                for component in pair['multipatch']['components']:
                    filename = component['filename']
                    content = archive.read(f'multipatch-{target:g}m/{filename}')
                    if sha(content) != component['sha256'] or len(content) != component['bytes']:
                        raise ValueError('MultiPatch component changed')
                    path = f'{identity}/{filename}'
                    contents[path] = content
                    files.append({'path': path, 'bytes': len(content), 'sha256': sha(content)})
                contents[f'{identity}/native.json'] = native
                files.append({'path': f'{identity}/native.json', 'bytes': len(native), 'sha256': sha(native)})
                reader = shapefile.Reader(shp=io.BytesIO(contents[f'{identity}/terrain.shp']),
                    shx=io.BytesIO(contents[f'{identity}/terrain.shx']), dbf=io.BytesIO(contents[f'{identity}/terrain.dbf']))
                if len(reader)!=1 or reader.record(0)['SAMPLE_ID']!=identity:
                    raise ValueError('Wrong feature identity')
                shape = reader.shape(0)
                if shape.shapeType!=shapefile.MULTIPATCH or any(t!=shapefile.TRIANGLE_STRIP for t in shape.partTypes):
                    raise ValueError('Expected TriangleStrip-only MultiPatch')
                points = [(*xy,z) for xy,z in zip(shape.points,shape.z)]
                breaks = [*shape.parts,len(points)]
                parts = [points[a:b] for a,b in zip(breaks,breaks[1:])]
                geometry = triangles_digest(parts)
                reader.close()
                if geometry != pair['multipatch']['geometry']:
                    raise ValueError('Directed triangle geometry changed')
                integral = next(m for m in l2['models'] if m['case_id']==case['id'] and m['family']=='local_triangles' and m['target_m']==target)
                if integral['sha256']!=sha(native):
                    raise ValueError('Integral refers to another native file')
                records.append({'id':identity, 'case_id':case['id'], 'case_name':case['name'], 'target_m':target,
                    'native_bytes':len(native), 'native_sha256':sha(native), 'native_points':len(json.loads(native)['points']),
                    'multipatch_core_bytes':pair['multipatch']['core_bytes'],
                    'native_recoverable_bytes':pair['multipatch']['recoverable_bytes'],
                    'multipatch_vertices':len(points), 'multipatch_parts':len(parts),
                    'triangles':geometry['triangles'], 'geometry_sha256':geometry['oriented_triangle_multiset_sha256'],
                    'coordinate_sha256':coordinate_digest(points), 'e2_m2':integral['e2_m2'],
                    'continuous_bound_m':integral['continuous_bound_m'], 'files':files})
    manifest = {'schema':'gugis-bristol-arcgis-package-v1', 'parent_report_sha256':sha(parent_bytes),
        'integral_report_sha256':sha(l2_bytes), 'runner_sha256':sha(runner),
        'packager_sha256':sha(Path(__file__).read_bytes().replace(b'\r\n',b'\n')),
        'source':'EA 2022 DTM; 1m; EPSG:27700; ODN metres; fixed two 64x64m sites',
        'status':'awaiting-licensed-ArcGIS-Pro-run',
        'scope':'Six existing identical-geometry GUGIS local-triangle / MultiPatch pairs. File costs measured, ArcGIS software times not measured. Native recovery sidecars remain in parent experiment packages.',
        'models':records}
    manifest_bytes = packed(manifest)
    contents['manifest.json'] = manifest_bytes
    contents['DATA_LICENSE.md'] = (ROOT/'backend/data/terrain/DATA_LICENSE.md').read_bytes().replace(b'\r\n',b'\n')
    contents['README.txt'] = (
        'Bristol real-terrain ArcGIS Pro protocol\n'
        'Extract this ZIP to a new folder. Open ArcGIS Pro Python Command Prompt.\n'
        'python run_bristol_arcgis.py --directory . --output arcgis-result.json\n'
        'Result must not already exist. Only new temporary FGDBs and this result are written.\n'
        'Upload result JSON to /compare#bristol-arcgis-run. Import is session-only, never a city save.\n'
        'Source/native SHA256 and all XYZ vertices checked. FGDB coordinate multiset must be identical.\n'
        'FGDB patch topology is not verified by coordinate multiset checks.\n'
        'One warmup, five repeats, medians; no cold-cache guarantee or FPS/memory claim.\n'
        'ArcGIS read/copy and GUGIS native terrain query are DIFFERENT tasks; do not compute speedup.\n'
        'Only triangle-strip models included. No flattening of mixed bilinear ruled surfaces.\n'
        'File-size comparisons are uncompressed five-component SHP/SHX/DBF/PRJ/CPG vs native JSON.\n'
        'EPSG:27700 local fixtures; ODN heights; not scene ENU. Do not replace your city with native.json.\n'
    ).encode()
    PUBLIC.mkdir(exist_ok=True)
    archive = PUBLIC/'bristol-arcgis-protocol.zip'
    with ZipFile(archive,'w',compression=ZIP_DEFLATED) as output:
        for name,content in sorted(contents.items()):
            info = ZipInfo(name,date_time=(2026,10,5,0,0,0));info.compress_type=ZIP_DEFLATED
            output.writestr(info,content)
    (PUBLIC/'manifest.json').write_bytes(manifest_bytes)
    summary = {**manifest, 'manifest_sha256':sha(manifest_bytes),
        'download':{'filename':archive.name,'bytes':archive.stat().st_size,'sha256':sha(archive.read_bytes())}}
    (ROOT/'shared/bristol-arcgis-protocol.json').write_bytes(packed(summary))
    print(json.dumps({'models':len(records),'package_bytes':archive.stat().st_size,'sha256':sha(archive.read_bytes())}))


if __name__=='__main__':
    main()
