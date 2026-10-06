"""Independent saved-model integration, source pixels and Galerkin on new sites."""
import argparse,json,math
from pathlib import Path
import numpy as np
import rasterio
from rasterio.windows import Window
from source_band_benchmark import ROOT,sha,binary
from diagonal_hybrid_audit import audit as integral
from source_fit_galerkin_audit import audit as galerkin

def verify(folder):
    raw=(folder/'results.json').read_bytes();r=json.loads(raw);pr=(folder/'protocol.json').read_bytes();p=json.loads(pr)
    if sha(pr)!=r['protocol_sha256'] or r['inputs']!=p['inputs'] or r['code']!=p['code']:raise ValueError('Protocol identity changed')
    for path,digest in p['inputs'].items():
        if sha((ROOT/path).read_bytes())!=digest:raise ValueError('Frozen source changed')
    for path,digest in p['code'].items():
        if sha((ROOT/path).read_bytes().replace(b'\r\n',b'\n'))!=digest:raise ValueError('Frozen implementation changed')
    if [c['source_window'] for c in r['cases']]!=p['windows']:raise ValueError('Incomplete or changed site selection')
    rows=[];cache={};decisions=0
    with rasterio.open(ROOT/p['raster']) as src:
        for c in r['cases']:
            out=folder/c['id'];refraw=(out/'reference.json').read_bytes();ref=json.loads(refraw);s=c['source_window'];w=Window(s['left'],s['top'],65,65);values=src.read(1,window=w)
            if sha(refraw)!=c['reference_sha256'] or not np.array_equal(values[::-1].astype(float),ref['height']) or list(src.xy(s['top']+32,s['left']+32))!=ref['origin_bng'] or ref['origin_bng']!=c['origin_bng']:raise ValueError('Original Float32 source nodes or frame changed')
            with rasterio.open(out/'source-window.tif') as crop:
                if not np.array_equal(crop.read(1),values) or crop.transform!=src.window_transform(w) or crop.crs!=src.crs:raise ValueError('Source crop differs')
            e=c['source_geotiff'];b=(out/e['filename']).read_bytes()
            if len(b)!=e['bytes'] or sha(b)!=e['sha256']:raise ValueError('Source crop receipt changed')
            expected={(nx,ny,m) for nx in p['axis_cells'] for ny in p['axis_cells'] for m in p['methods']}
            if {(e['nx'],e['ny'],e['method']) for e in c['candidates']}!=expected or len(c['candidates'])!=len(expected):raise ValueError('Incomplete or duplicate candidate cohort')
            for e in c['candidates']:
                models=[]
                for entry in [e['original'],e]:
                    rawmodel=(out/entry['filename']).read_bytes();blob=(out/entry['binary_filename']).read_bytes();model=json.loads(rawmodel)
                    if len(rawmodel)!=entry['bytes'] or sha(rawmodel)!=entry['sha256'] or len(blob)!=entry['binary_bytes'] or sha(blob)!=entry['binary_sha256'] or binary(model)!=blob:raise ValueError('Actual native model differs')
                    a=integral(ref,model,e['nx'],e['ny'],e['families'])
                    if abs(a['e2_m2']-entry['e2_m2'])>1e-8*max(1,a['e2_m2']) or abs(a['continuous_maximum_m']-entry['continuous_maximum_m'])>1e-8:raise ValueError('Independent whole-domain metrics differ')
                    models.append(model)
                before,saved=models
                if before['patches']!=saved['patches'] or any(a[:2]!=b[:2] for a,b in zip(before['points'],saved['points'])) or e['binary_bytes']!=e['original']['binary_bytes']:raise ValueError('Fitting changed the fixed space or complete cost')
                if e['solver']['status']=='fallback_original':
                    if before!=saved:raise ValueError('Fallback differs from original')
                    residual=None
                else:residual=galerkin(ref,before,saved,e['nx'],e['ny'],e['families'],cache)
                if e['e2_m2']>e['original']['e2_m2']+1e-9*max(1,e['original']['e2_m2']):raise ValueError('Error monotonicity violated')
                rows.append({'case_id':c['id'],'id':e['id'],'binary_sha256':e['binary_sha256'],'whole_domain_integral_verified':True,'unfitted_integral_verified':True,'galerkin':residual})
            for name,axis,threshold,objective in [('byte_pairs','byte_ceilings','byte_ceiling','e2_m2'),('target_pairs','height_targets_m','height_target_m','binary_bytes')]:
                if [row[threshold] for row in c[name]]!=p[axis]:raise ValueError('Frozen thresholds changed')
                for row in c[name]:
                    for method in p['methods']:
                        feasible=[e for e in c['candidates'] if e['method']==method and e['binary_bytes' if name=='byte_pairs' else 'continuous_bound_m']<=row[threshold]]
                        key=(lambda e:(e['e2_m2'],e['binary_bytes'],e['nx'],e['ny'])) if name=='byte_pairs' else (lambda e:(e['binary_bytes'],e['e2_m2'],e['nx'],e['ny']))
                        winner=min(feasible,key=key,default=None)
                        if row[method]!=winner:raise ValueError('Nonminimal or fabricated missing candidate')
                        decisions+=1
            print(c['id']+': original pixels, all integrals, fixed costs and Galerkin verified',flush=True)
    return {'schema':'gugis-exeter-source-fit-independent-audit-v1','report_sha256':sha(raw),'protocol_sha256':sha(pr),'models':rows,'fitted_models':len(rows),'unfitted_models':len(rows),'independent_decisions':decisions,'auditor_sha256':sha(Path(__file__).read_bytes().replace(b'\r\n',b'\n'))}
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('folder',type=Path);folder=parser.parse_args().folder;result=verify(folder)
    with (folder/'integral-audit.json').open('x',encoding='utf8') as out:json.dump(result,out,ensure_ascii=False,indent=2);out.write('\n')
    print('Independently verified',result['fitted_models'],'new fitted models')
