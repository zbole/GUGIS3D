"""Validate and publish a complete additive two-site Oxford research bundle. No city writes."""
import argparse
import csv
import hashlib
import io
import json
from pathlib import Path
import shutil
import zipfile

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import shapefile

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'frontend/public/research/oxford-terrain-benchmark'
SUMMARY = ROOT / 'shared/oxford-terrain-benchmark.json'
SHA = lambda b: hashlib.sha256(b).hexdigest()


def checked(folder, name, digest, size=None):
    path = (folder / name).resolve()
    if not path.is_relative_to(folder.resolve()) or path.name != name:
        raise ValueError('Unsafe artifact name')
    content = path.read_bytes()
    if SHA(content) != digest or (size is not None and len(content) != size):
        raise ValueError(f'Artifact fingerprint mismatch: {name}')
    return content


def verify(folder):
    report_bytes = (folder / 'results.json').read_bytes()
    report = json.loads(report_bytes)
    audit_bytes = (folder / 'native-query-audit.json').read_bytes()
    audit = json.loads(audit_bytes)
    if report.get('schema') != 'gugis-oxford-certified-terrain-v1' or audit.get('schema') != 'gugis-oxford-native-query-audit-v1':
        raise ValueError('Expected versioned Oxford experiment and native audit')
    expected = {f'{city}-{site}' for city in ('oxford',) for site in ('centre', 'north-quarter')}
    if {c['id'] for c in report['cases']} != expected or len(report['cases']) != 2:
        raise ValueError('Publish every fixed site exactly once')
    if audit['parent_report_sha256'] != SHA(report_bytes) or len(audit['rows']) != 12:
        raise ValueError('Query audit parent or count mismatch')
    for name, digest in {**report['scripts'],
        'frontend/scripts/audit-oxford-terrain-benchmark.mjs': audit['auditor_sha256'],
        'frontend/src/studio/terrainMath.ts': audit['native_kernel_sha256']}.items():
        if SHA((ROOT / name).read_text(encoding='utf8').replace('\r\n', '\n').encode()) != digest:
            raise ValueError(f'Bound script changed: {name}')
    if SHA((ROOT / 'shared/public-terrain-sources-v2.json').read_bytes()) != report['source_catalogue_sha256']:
        raise ValueError('Source catalogue changed')
    for case in report['cases']:
        base = folder / case['id']
        checked(base, 'reference.json', case['reference_sha256'])
        checked(base, 'query-fixture.json', case['fixture_sha256'])
        if len(case['models']) != 6 or {(m['family'], m['target_m']) for m in case['models']} != {
            (f, t) for f in ('hybrid', 'local_triangles') for t in (.1, .25, .5)}:
            raise ValueError('Incomplete model grid')
        for m in case['models']:
            model = json.loads(checked(base, m['filename'], m['sha256'], m['bytes']))
            rows = [a for a in audit['rows'] if (a['case_id'], a['family'], a['target_m']) == (case['id'], m['family'], m['target_m'])]
            if len(rows) != 1:
                raise ValueError('Query row missing or duplicated')
            a = rows[0]
            if a['model_sha256'] != m['sha256'] or a['fixture_sha256'] != case['fixture_sha256'] or a['hits'] != 4096 or a['requested'] != 4096:
                raise ValueError('Query bindings or coverage mismatch')
            checked(base, **dict(name=a['queries_csv']['filename'], digest=a['queries_csv']['sha256'], size=a['queries_csv']['bytes']))
            if m['integrated_area_m2'] != 4096 or abs(m['rms_integral_m'] - m['e2_m2']/64) > 1e-12:
                raise ValueError('Whole domain integral mismatch')
            if 'multipatch' not in m:
                continue
            mp = m['multipatch']
            if len(mp['files']) != 5 or sum(f['bytes'] for f in mp['files']) != mp['five_component_bytes']:
                raise ValueError('MultiPatch full cost mismatch')
            for f in mp['files']:
                checked(base, f['filename'], f['sha256'], f['bytes'])
            shp = next(f for f in mp['files'] if f['filename'].endswith('.shp'))
            with shapefile.Reader(str(base / shp['filename'])) as reader:
                if reader.shapeType != shapefile.MULTIPATCH or len(reader) != 1:
                    raise ValueError('Expected one MultiPatch feature')
                shape = reader.shape(0)
                expected_parts = [[(model['points'][i][0]+case['origin_bng'][0], model['points'][i][1]+case['origin_bng'][1], model['points'][i][2]) for i in p['indices']] for p in model['patches']]
                ends = list(shape.parts[1:]) + [len(shape.points)]
                actual_parts = [[(*shape.points[i], shape.z[i]) for i in range(start, end)] for start, end in zip(shape.parts, ends)]
                if actual_parts != expected_parts or list(shape.partTypes) != [shapefile.TRIANGLE_STRIP]*len(expected_parts):
                    raise ValueError('Same geometry claim failed')
                record = reader.record(0).as_dict()
                if record['SRC_SHA'] != case['source_raster_sha256'] or record['VERT_DAT'] != 'ODN' or record['TOL_M'] != m['target_m']:
                    raise ValueError('Source attributes mismatch')
    return report, report_bytes, audit, audit_bytes


def publish(folder):
    if DEST.exists() or SUMMARY.exists():
        raise FileExistsError('Refuse to overwrite published evidence')
    report, report_bytes, audit, audit_bytes = verify(folder)
    DEST.mkdir(parents=True)
    (DEST/'results.json').write_bytes(report_bytes)
    (DEST/'native-query-audit.json').write_bytes(audit_bytes)
    summary = dict(report, parent_report_sha256=SHA(report_bytes), query_audit_sha256=SHA(audit_bytes),
        publisher_sha256=SHA(Path(__file__).read_text(encoding='utf8').replace('\r\n', '\n').encode()), packages={}, figures={})
    license_text = ('EA 2022 LiDAR composite DTM, Open Government Licence v3.0.\n'
        '© Environment Agency copyright and/or database right 2022. All rights reserved.\n'
        'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/\n'
        'Source-relative research fixtures, NOT independent ground accuracy.\n'
        'XY: local BNG offsets in native JSON; absolute EPSG:27700 in MultiPatch. Z: unchanged ODN metres.\n'
        'Geometry differs between hybrid and triangle models. Only each triangle/MultiPatch pair is identical.\n'
        'No ArcGIS software execution or timing. ZIP bytes are not the five-component cost baseline.\n')
    columns = ['case_id','family','target_m','bytes','native_triangles','ruled_quads','e2_m2','rms_integral_m','continuous_bound_m','target_met','multipatch_five_component_bytes']
    csv_text=io.StringIO(newline=''); writer=csv.DictWriter(csv_text,fieldnames=columns); writer.writeheader()
    for case in report['cases']:
        destination=DEST/case['id']; destination.mkdir()
        names={'reference.json','query-fixture.json'}
        for m in case['models']:
            names.add(m['filename'])
            names.update(f['filename'] for f in m.get('multipatch',{}).get('files',[]))
            names.add(next(a['queries_csv']['filename'] for a in audit['rows'] if (a['case_id'],a['family'],a['target_m'])==(case['id'],m['family'],m['target_m'])))
            writer.writerow(dict(case_id=case['id'], **{k:m[k] for k in columns[1:-1]}, multipatch_five_component_bytes=m.get('multipatch',{}).get('five_component_bytes','')))
        for name in sorted(names): shutil.copyfile(folder/case['id']/name,destination/name)
        (destination/'README.txt').write_text(license_text,encoding='utf8')
        (destination/'case.json').write_text(json.dumps(case,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
        zipname=case['id']+'.zip'
        with zipfile.ZipFile(DEST/zipname,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
            for path in sorted(destination.iterdir()):
                info=zipfile.ZipInfo(case['id']+'/'+path.name,date_time=(2026,10,5,0,0,0)); info.compress_type=zipfile.ZIP_DEFLATED; info.external_attr=0o644<<16
                archive.writestr(info,path.read_bytes(),compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
        zipbytes=(DEST/zipname).read_bytes()
        summary['packages'][case['id']]={'filename':zipname,'bytes':len(zipbytes),'sha256':SHA(zipbytes),'scope':'Complete downloadable recovery package, not a representation-cost baseline.'}
        fig, ax=plt.subplots(figsize=(7.2,4.1),layout='constrained')
        for family,label,color in [('hybrid','Local partition (ruled allowed)','#bd7626'),('local_triangles','Native triangle strips','#087f79')]:
            values=[m for m in case['models'] if m['family']==family]
            ax.plot([m['bytes']/1000 for m in values],[m['e2_m2'] for m in values],'o-',label=label,color=color)
            if family=='local_triangles':
                for m in values: ax.annotate(f"{m['target_m']*100:g} cm",(m['bytes']/1000,m['e2_m2']),xytext=(-5,-14),ha='right',textcoords='offset points',fontsize=8)
        values=[m for m in case['models'] if m['family']=='local_triangles']
        ax.plot([m['multipatch']['five_component_bytes']/1000 for m in values],[m['e2_m2'] for m in values],'s--',label='MultiPatch, same triangle geometry',color='#71839a')
        ax.set(xlabel='Uncompressed representation / kB',ylabel='Whole-domain E2 / m²',title=case['id']+' · fixed 64 × 64 m source crop')
        ax.grid(alpha=.2); ax.legend(fontsize=8); ax.set_xscale('log'); ax.set_yscale('log'); ax.margins(x=.15,y=.16)
        for extension in ('png','svg'):
            name=case['id']+'-error-cost.'+extension; fig.savefig(DEST/name,dpi=180,metadata={'Date':None} if extension=='svg' else None); summary['figures'][name]=SHA((DEST/name).read_bytes())
        plt.close(fig)
    (DEST/'results.csv').write_text(csv_text.getvalue(),encoding='utf8',newline='')
    summary['results_csv_sha256']=SHA((DEST/'results.csv').read_bytes())
    content=(json.dumps(summary,ensure_ascii=False,indent=2,allow_nan=False)+'\n').encode()
    SUMMARY.write_bytes(content); (DEST/'publication.json').write_bytes(content)
    print('Published all 2 Oxford sites, 12 models, 6 identical MultiPatch pairs and 49152 native queries.')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__); parser.add_argument('folder',type=Path)
    publish(parser.parse_args().folder)
