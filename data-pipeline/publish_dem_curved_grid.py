"""Release the complete fixed real-DTM control, including adverse outcomes."""
import argparse
import csv
import io
import json
import math
from pathlib import Path
import shutil
import zipfile
import numpy as np
from dem_curved_grid_benchmark import ROOT, GROUPS, DENSITIES, TARGETS, sha, packed, checked, make_model, metrics, common_triangles
from raster_l2_audit import integrate_model
from plot_dem_curve_control import plot
DEST=ROOT/'frontend/public/research/dem-curved-grid-v1'
SUMMARY=ROOT/'shared/dem-curved-grid-control-v1.json'

def verify(folder):
    raw=(folder/'results.json').read_bytes();r=json.loads(raw);ar=(folder/'native-audit.json').read_bytes();audit=json.loads(ar)
    if r['schema']!='gugis-dem-curved-grid-v1' or r['groups']!=list(GROUPS) or r['densities']!=list(DENSITIES) or r['targets_m']!=list(TARGETS) or r['candidates_per_site']!=98:raise ValueError('Changed fixed experiment')
    bindings={'data-pipeline/dem_curved_grid_benchmark.py':r['source_sha256'],'frontend/scripts/audit-dem-curved-grid.mjs':audit['auditor_sha256'],'frontend/src/compare/curvedRuledMath.ts':audit['kernel_sha256']}
    if audit['report_sha256']!=sha(raw) or sha((ROOT/'shared/public-terrain-sources-v8.json').read_bytes())!=r['source_catalogue_sha256']:raise ValueError('Parent changed')
    for p,h in bindings.items():
        if sha((ROOT/p).read_bytes().replace(b'\r\n',b'\n'))!=h:raise ValueError('Bound implementation changed')
    parents={}
    for group in GROUPS:
        pr=(ROOT/f'shared/{group}-terrain-benchmark.json').read_bytes()
        if sha(pr)!=r['parents'][group]:raise ValueError('Frozen reference report changed')
        parent=json.loads(pr);base=ROOT/f'frontend/public/research/{group}-terrain-benchmark' if group!='multicity' else ROOT/'frontend/public/research/multicity-terrain'
        for c in parent['cases']:parents[c['id']]=(c,base)
    if len(r['cases'])!=20 or [c['id'] for c in r['cases']]!=list(parents):raise ValueError('Selected or missing real windows')
    expected_audits=set()
    for c in r['cases']:
        parent,base=parents[c['id']];out=folder/c['id'];ref_raw=checked(out/'reference.json',c['reference_sha256'])
        if ref_raw!=checked(base/c['id']/'reference.json',parent['reference_sha256']) or c['source_raster_sha256']!=parent['source_raster_sha256'] or c['source_window']!=parent['source_window']:raise ValueError('Changed fixed source window')
        reference=json.loads(ref_raw);expected=[f'{axis}-{nx}x{ny}' for axis in ('x','y') for nx in DENSITIES for ny in DENSITIES]
        if [e['id'] for e in c['candidates']]!=expected:raise ValueError('Incomplete candidate pool')
        for e in c['candidates']:
            model=make_model(reference,e['nx'],e['ny'],e['axis']);b=packed(model)
            if len(b)!=e['bytes'] or sha(b)!=e['sha256']:raise ValueError('Candidate encoding changed')
            measured=metrics(reference,model,e['nx'],e['ny'],e['axis'],nodes=5)
            for key in ['e2_m2','maximum_residual_m','continuous_bound_m']:
                if abs(measured[key]-e[key])>1e-9*max(1,e[key]):raise ValueError('Whole-domain curve metric changed')
        if [p['target_m'] for p in c['pairs']]!=list(TARGETS):raise ValueError('Incomplete ceiling set')
        for p in c['pairs']:
            b=p['baseline'];old=next(m for m in parent['models'] if m['family']=='local_triangles' and m['target_m']==p['target_m'])
            old_raw=checked(base/c['id']/old['filename'],old['sha256'],old['bytes']);body=common_triangles(json.loads(old_raw));br=checked(out/b['filename'],b['sha256'],b['bytes'])
            if br!=packed(body) or b['parent_sha256']!=old['sha256'] or b['e2_m2']!=old['e2_m2'] or b['continuous_bound_m']!=old['continuous_bound_m']:raise ValueError('Baseline geometry or accuracy changed')
            area=integrate_model(reference,body)
            if abs(area['e2_m2']-b['e2_m2'])>1e-8 or area['native_triangles']!=b['native_triangles']:raise ValueError('P1 integral does not reproduce retained E2')
            expected_audits.add((c['id'],b['filename']))
            eligible=[e for e in c['candidates'] if e['bytes']<=b['bytes']]
            joint=[e for e in eligible if e['continuous_bound_m']<=b['continuous_bound_m']+1e-10]
            for key,pool,percent in [('best_e2_at_file_ceiling',eligible,'e2_reduction_percent'),('best_e2_with_maximum_gate',joint,'joint_e2_reduction_percent')]:
                selected=min(pool,key=lambda e:(e['e2_m2'],e['bytes'],e['id'])) if pool else None
                if p[key]!=(selected['id'] if selected else None) or p[percent]!=(100*(1-selected['e2_m2']/b['e2_m2']) if selected else None):raise ValueError('Changed finite-pool selection or verdict')
                if selected:
                    checked(out/(selected['id']+'.json'),selected['sha256'],selected['bytes']);expected_audits.add((c['id'],selected['id']+'.json'))
        print(c['id']+' all 98 candidates and three full P1 integrals verified',flush=True)
    if len(audit['rows'])!=len(expected_audits) or {(v['case_id'],v['filename']) for v in audit['rows']}!=expected_audits:raise ValueError('Incomplete native audit')
    for v in audit['rows']:
        checked(folder/v['case_id']/v['filename'],v['sha256'],v['bytes'])
        if v['requested']!=512 or v['hits']!=512 or not math.isfinite(v['sampled_maximum_m']) or not math.isfinite(v['sampled_rmse_m']) or (v['kind']=='P2xP1' and not v['maximum_witness_checked']):raise ValueError('Invalid native query proof')
    return r,raw,audit,ar,bindings

def publish(folder):
    if DEST.exists() or SUMMARY.exists():raise FileExistsError('Evidence releases cannot be replaced')
    r,raw,audit,ar,bindings=verify(folder);DEST.mkdir(parents=True);(DEST/'results.json').write_bytes(raw);(DEST/'native-audit.json').write_bytes(ar)
    summaries=[];rows=[]
    for c in r['cases']:
        out=DEST/c['id'];out.mkdir();retained=[]
        for path in sorted((folder/c['id']).glob('*.json')):shutil.copyfile(path,out/path.name)
        pairs=[]
        for p in c['pairs']:
            selected=next((e for e in c['candidates'] if e['id']==p['best_e2_at_file_ceiling']),None)
            pairs.append({**p,'selected':selected})
            rows.append({'site':c['id'],'target_m':p['target_m'],'p1_bytes':p['baseline']['bytes'],'ruled_bytes':selected['bytes'] if selected else '',
              'p1_e2_m2':p['baseline']['e2_m2'],'ruled_e2_m2':selected['e2_m2'] if selected else '', 'e2_reduction_percent':p['e2_reduction_percent'] if selected else '',
              'p1_continuous_bound_m':p['baseline']['continuous_bound_m'],'ruled_continuous_bound_m':selected['continuous_bound_m'] if selected else '',
              'joint_candidate':p['best_e2_with_maximum_gate'] or 'none'})
        summaries.append({k:v for k,v in c.items() if k not in ('candidates','pairs')}|{'pairs':pairs})
    csv_io=io.StringIO(newline='');w=csv.DictWriter(csv_io,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows);(DEST/'pairs.csv').write_bytes(csv_io.getvalue().encode())
    name='real-dtm-control.svg';plot(r,DEST/name);figures={name:sha((DEST/name).read_bytes())}
    (DEST/'README.txt').write_text('Complete adverse real-DTM control: 20 frozen 65x65 windows, ten cities, 98 fixed P2xP1 grids each.\nSame minimal native JSON envelope; retained P1 geometry and heights unchanged, curved grids keep unrounded source Float64.\nWhole-domain E2 per original bilinear source cell; all quadratic stationary residual extrema included with Float64 guard. Not ground-truth/interval proof/ArcGIS/paper-author software.\n56/60 byte ceilings have a candidate; no candidate has lower E2, and no candidate fits both the byte ceiling and retained P1 maximum-error bound. This does not invalidate the separate analytic structural results; it rules out generalizing them directly to these real DEM windows.\nSelected models, source grids, all 1960 metrics and all native checks retained. Source: Environment Agency 2022, OGL v3.0.\n',encoding='utf8',newline='\n')
    impl=DEST/'implementations';impl.mkdir()
    for name in list(bindings)+['data-pipeline/publish_dem_curved_grid.py','data-pipeline/raster_l2_audit.py','data-pipeline/plot_dem_curve_control.py']:(impl/Path(name).name).write_bytes((ROOT/name).read_bytes().replace(b'\r\n',b'\n'))
    with zipfile.ZipFile(DEST/'dem-curved-grid-evidence.zip','x',compression=zipfile.ZIP_DEFLATED) as z:
        for path in sorted(DEST.rglob('*')):
            if path.is_file() and path.suffix!='.zip':
                info=zipfile.ZipInfo('dem-curved-grid-v1/'+path.relative_to(DEST).as_posix(),date_time=(2026,10,6,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,path.read_bytes(),compresslevel=9)
    b=(DEST/'dem-curved-grid-evidence.zip').read_bytes();summary={k:v for k,v in r.items() if k!='cases'}
    summary.update(report_sha256=sha(raw),native_audit_sha256=sha(ar),publisher_sha256=sha(Path(__file__).read_bytes().replace(b'\r\n',b'\n')),figures=figures,
      pairs_csv_sha256=sha((DEST/'pairs.csv').read_bytes()),package={'filename':'dem-curved-grid-evidence.zip','bytes':len(b),'sha256':sha(b)},cases=summaries)
    out=(json.dumps(summary,ensure_ascii=False,indent=2,allow_nan=False)+'\n').encode();SUMMARY.write_bytes(out);(DEST/'publication.json').write_bytes(out)
    print('Published full 20-site, 1960-candidate, 60-ceiling negative control; no omitted outcomes.')

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('folder',type=Path);publish(p.parse_args().folder)
