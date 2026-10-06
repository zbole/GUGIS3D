"""Full saved-function replay, independent GL5/Galerkin/native audit and immutable release."""
import argparse,csv,html,io,json,math,shutil,zipfile
from pathlib import Path
import numpy as np
import source_fit_benchmark as producer
from source_fit_metrics import measure
from source_global_fit_math import fit
from diagonal_hybrid_audit import audit as integral
from source_fit_galerkin_audit import audit as galerkin
ROOT=producer.ROOT;sha=producer.sha;packed=producer.packed
DEST=ROOT/'frontend/public/research/source-global-fit-v1';SUMMARY=ROOT/'shared/source-global-fit-display-v1.json'

def checked(path,digest,size=None):
    raw=path.read_bytes()
    if sha(raw)!=digest or size is not None and len(raw)!=size:raise ValueError('Evidence changed: '+str(path))
    return raw

def verify(folder):
    raw=(folder/'results.json').read_bytes();r=json.loads(raw);pr=checked(folder/'protocol.json',r['protocol_sha256']);p=json.loads(pr)
    if pr!=producer.PROTOCOL.read_bytes():raise ValueError('Frozen full-study protocol changed')
    inputs={}
    for key in ['source_report','diagonal_report','prior_hybrid_report']:
        content=checked(folder/(key.replace('_','-')+'.json'),p[key+'_sha256'])
        if content!=(ROOT/p[key]).read_bytes() or r[key+'_sha256']!=sha(content):raise ValueError('Original complete report changed')
        inputs[key]=json.loads(content)
    for path,digest in r['scripts'].items():
        checked(folder/'code'/path,digest)
        if sha((ROOT/path).read_bytes().replace(b'\r\n',b'\n'))!=digest:raise ValueError('Frozen full-study code changed: '+path)
    native=json.loads((folder/'native-audit.json').read_bytes())
    if native['report_sha256']!=sha(raw) or native['native_models']!=2940 or native['queries']!=2940*5249:raise ValueError('Incomplete native full-model audit')
    rows={(x['case_id'],x['filename']):x for x in native['models']};expected=set();audited=[];cross_cache={};galerkin_cache={};validated=set();seam_pairs=0
    if len(r['cases'])!=20 or [c['id'] for c in r['cases']]!=[c['id'] for c in inputs['source_report']['cases']]:raise ValueError('Fixed source windows incomplete')
    for c,s,d,o in zip(r['cases'],inputs['source_report']['cases'],inputs['diagonal_report']['cases'],inputs['prior_hybrid_report']['cases']):
        ref,refraw=producer.load_reference(s,validated);checked(folder/c['id']/'reference.json',s['reference_sha256']);checked(folder/c['id']/'source-window.tif',c['source_geotiff']['sha256'],c['source_geotiff']['bytes'])
        if c['source_identity']!=s['source_identity'] or c['origin_bng']!=s['origin_bng'] or c['source_window']!=s['source_window']:raise ValueError('Original geoframe identity changed')
        names=[f'{method}-{nx}x{ny}' for nx in p['axis_cells'] for ny in p['axis_cells'] for method in p['methods']]
        if [e['id'] for e in c['candidates']]!=names:raise ValueError('Missing fixed candidate or fitted control')
        for e in c['candidates']:
            method=e['method'];oldsite=o if method=='ruled-fit' else d;oldmethod={'ruled-fit':'ruled','p1-fit':'p1-local','hybrid-fit':'hybrid-local'}[method];old=next(x for x in oldsite['candidates'] if x['method']==oldmethod and x['nx']==e['nx'] and x['ny']==e['ny']);public=ROOT/'frontend/public/research'/('hybrid-source-v1' if method=='ruled-fit' else 'diagonal-hybrid-v1')/c['id'];original=json.loads(checked(public/old['filename'],old['sha256']));oldbinary=checked(public/old['binary_filename'],old['binary_sha256'],old['binary_bytes']);jr=checked(folder/c['id']/e['filename'],e['sha256'],e['bytes']);br=checked(folder/c['id']/e['binary_filename'],e['binary_sha256'],e['binary_bytes']);model=json.loads(jr)
            if e['families']!=old['families'] or model['patches']!=original['patches'] or len(model['points'])!=len(original['points']) or any(a[:2]!=b[:2] for a,b in zip(model['points'],original['points'])) or len(br)!=len(oldbinary) or br!=producer.binary(model):raise ValueError('Fixed space topology XY or complete native bytes changed')
            # Fixed solver replay checks actual serialized output, rather than trusting solver labels.
            replay,solver=fit(ref,e['nx'],e['ny'],e['families'],cross_cache)
            if e['solver']['status']=='fallback_original':
                if model!=original:raise ValueError('Fallback differs from complete original model')
            elif jr!=packed(replay) or solver!=e['solver']:raise ValueError('Frozen fitting replay differs')
            a=integral(ref,model,e['nx'],e['ny'],e['families']);b=measure(ref,original,e['nx'],e['ny'],e['families'])
            for key in ['e2_m2','continuous_maximum_m','integrated_area_m2']:
                if abs(a[key]-e[key])>1e-8*max(1,abs(e[key])):raise ValueError('Independent saved-source integral/maximum differs')
            if e['e2_m2']>b['e2_m2']+1e-9*max(1,b['e2_m2']) or e['continuous_bound_m']!=e['continuous_maximum_m']+e['float64_guard_m']:raise ValueError('Energy monotonicity or declared maximum guard failed')
            g=galerkin(ref,original,model,e['nx'],e['ny'],e['families'],galerkin_cache) if e['solver']['status']!='fallback_original' else {'status':'explicit_original_fallback'}
            key=(c['id'],e['filename']);expected.add(key);n=rows[key];seams=7*((e['nx']-1)*e['ny']+(e['ny']-1)*e['nx']);seam_pairs+=seams
            if n['binary_sha256']!=e['binary_sha256'] or n['queries']!=5249 or any(not math.isfinite(n[k]) or n[k]<0 or n[k]>=1e-8 for k in ['independent_height_difference_m','independent_gradient_difference','frame_difference_m','seam_height_difference_m']) or n['seam_height_pairs']!=seams or not n['maximum_witness_verified'] or not n['outside_rejected']:raise ValueError('Native saved model audit incomplete')
            audited.append({'case_id':c['id'],'filename':e['filename'],'e2_m2':a['e2_m2'],'continuous_maximum_m':a['continuous_maximum_m'],'integral_difference_m2':abs(a['e2_m2']-e['e2_m2']),'maximum_difference_m':abs(a['continuous_maximum_m']-e['continuous_maximum_m']),**g})
        pairs,targets=producer.choices(c['candidates'],p)
        for group,key,drows,orows,stored in [(pairs,'byte_ceiling',d['byte_pairs'],o['byte_pairs'],c['byte_pairs']),(targets,'height_target_m',d['target_pairs'],o['target_pairs'],c['target_pairs'])]:
            for row in group:
                dr=next(x for x in drows if x[key]==row[key]);rr=next(x for x in orows if x[key]==row[key]);row['unfitted']={'p1-local':dr['p1-local'],'hybrid-local':dr['hybrid-local'],'ruled':rr['ruled']}
            if group!=stored:raise ValueError('Budget/maximum target selection or missing result changed')
        print(c['id']+': all 147 saved models independently integrated, Galerkin checked and replayed',flush=True)
    if set(rows)!=expected or len(rows)!=2940 or native['seam_height_pairs']!=seam_pairs:raise ValueError('Audit has missing or extra models/seams')
    independent={'schema':'gugis-source-global-fit-integral-audit-v1','report_sha256':sha(raw),'model_count':len(audited),'models':audited,'method':'Independent GL5 source-cell/clipped saved-function integrals and extrema, numerical GL5 mass/source loads for global Galerkin residual, exact frozen solver replay. No shared producer analytic mass/load imports in the numerical Galerkin auditor.','scripts':{path:sha((ROOT/path).read_bytes().replace(b'\r\n',b'\n')) for path in ['data-pipeline/publish_source_fit.py','data-pipeline/source_fit_galerkin_audit.py','data-pipeline/diagonal_hybrid_audit.py','data-pipeline/hybrid_source_audit.py']}}
    return r,native,independent

def compact_entry(e):
    if e is None:return None
    fields=['id','method','filename','binary_filename','binary_bytes','binary_sha256','e2_m2','continuous_maximum_m','continuous_bound_m','nx','ny','stored_points','stored_patches','ruled_cells','p1_triangles']
    out={k:e[k] for k in fields}
    if 'solver' in e:out|={'fit_status':e['solver']['status'],'original_e2_m2':e['original']['e2_m2'],'original_maximum_m':e['original']['continuous_maximum_m']}
    return out

def aggregate(r):
    allpairs=[p for c in r['cases'] for p in c['byte_pairs']];fixed=[next(p for p in c['byte_pairs'] if p['byte_ceiling']==8192) for c in r['cases']];allmodels=[e for c in r['cases'] for e in c['candidates']]
    comparisons={}
    for key,other in [('hybrid_vs_fitted_p1','p1-fit'),('hybrid_vs_fitted_ruled','ruled-fit')]:
        ratios=[p['hybrid-fit']['e2_m2']/p[other]['e2_m2'] if p[other]['e2_m2'] else 1 for p in fixed]
        comparisons[key]={'fixed_budget_wins':sum(v<1 for v in ratios),'fixed_budget_ties':sum(v==1 for v in ratios),'fixed_budget_losses':sum(v>1 for v in ratios),'minimum_reduction_percent':100*(1-max(ratios)),'maximum_reduction_percent':100*(1-min(ratios)),'all_budget_wins':sum(p['hybrid-fit']['e2_m2']<p[other]['e2_m2'] for p in allpairs),'all_budget_count':len(allpairs)}
    comparisons['fitting']={'model_count':len(allmodels),'fallbacks':sum(e['solver']['status']=='fallback_original' for e in allmodels),'e2_strict_improvements':sum(e['e2_m2']<e['original']['e2_m2'] for e in allmodels),'maximum_increases':sum(e['continuous_maximum_m']>e['original']['continuous_maximum_m']+e['float64_guard_m'] for e in allmodels),'exact_identities':sum(e['solver']['status']=='exact_source_space_identity' for e in allmodels)}
    return comparisons

def plot(r):
    rows=[next(p for p in c['byte_pairs'] if p['byte_ceiling']==8192) for c in r['cases']];ratios=[p['hybrid-fit']['e2_m2']/p['p1-fit']['e2_m2'] for p in rows];upper=max(1.05,math.ceil(max(ratios)*20)/20);left,width=315,650;x=lambda v:left+width*v/upper;parts=['<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="865" viewBox="0 0 1100 865"><rect width="1100" height="865" fill="white"/><g font-family="Arial,sans-serif" fill="#294d42"><text x="25" y="33" font-size="20">Real DTM: shared-C0 fitted mixture / equally fitted two-diagonal P1</text><text x="25" y="60" font-size="13">All twenty original 64x64 m windows / complete native ceiling 8192 B / whole-domain E2 ratio (lower is better).</text>']
    for v in np.arange(0,upper+.001,.25):parts.append(f'<path d="M{x(v):.2f} 90 V735" stroke="#e1e8e3"/><text x="{x(v):.2f}" y="759" font-size="12" text-anchor="middle">{v:.2f}</text>')
    parts.append(f'<path d="M{x(1):.2f} 90 V735" stroke="#b2916c" stroke-dasharray="4 4"/>')
    for k,(c,ratio) in enumerate(zip(r['cases'],ratios)):
        y=110+31*k;parts.append(f'<text x="25" y="{y+4}" font-size="12">{html.escape(c["id"])}</text><path d="M{x(0):.2f} {y} H{x(ratio):.2f}" stroke="#d8e8e1" stroke-width="8"/><circle cx="{x(ratio):.2f}" cy="{y}" r="4" fill="{ "#288b73" if ratio<1 else "#bb7851"}"/><text x="990" y="{y+4}" font-size="12">{ratio:.6f}</text>')
    parts+=['<text x="25" y="796" font-size="13">Equal fitting opportunity: original shared-node topology and complete byte cost stay fixed for every method.</text><text x="25" y="821" font-size="13">All 2940 models, maximum-error increases, missing targets and negative comparisons retained.</text><text x="25" y="846" font-size="13">Source-relative fixed-space study, not survey accuracy, adaptive paper data or ArcGIS software.</text></g></svg>'];return ('\n'.join(parts)+'\n').encode()

def publish(folder):
    r,native,independent=verify(folder)
    if DEST.exists() or SUMMARY.exists():raise FileExistsError('Immutable release already exists')
    (folder/'integral-audit.json').write_bytes(packed(independent));(folder/'source-fit-results.svg').write_bytes(plot(r));aggregates=aggregate(r);(folder/'aggregate.json').write_bytes(packed(aggregates));buffer=io.StringIO(newline='');writer=csv.writer(buffer);writer.writerow(['case_id','condition','value','method','id','bytes','E2_m2','continuous_bound_m','original_candidate_E2_m2','original_candidate_maximum_m','fit_status'])
    for c in r['cases']:
        for group,key in [('byte_pairs','byte_ceiling'),('target_pairs','height_target_m')]:
            for row in c[group]:
                for method in ['p1-fit','ruled-fit','hybrid-fit']:
                    e=row[method];writer.writerow([c['id'],key,row[key],method,*([e['id'],e['binary_bytes'],e['e2_m2'],e['continuous_bound_m'],e['original']['e2_m2'],e['original']['continuous_maximum_m'],e['solver']['status']] if e else ['NO_FEASIBLE_MODEL','','','','','',''])])
    (folder/'selections.csv').write_bytes(buffer.getvalue().encode());shutil.copytree(folder,DEST)
    publication='source-global-fit-evidence.zip'
    with zipfile.ZipFile(DEST/publication,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
        for path in sorted(DEST.rglob('*')):
            if path.is_file() and path.name!=publication:archive.write(path,path.relative_to(DEST).as_posix())
    package=(DEST/publication).read_bytes()
    if len(package)>95_000_000:raise ValueError('Complete evidence package exceeds public per-file guard')
    originals=json.loads((ROOT/'shared/source-native-bands-v1.json').read_bytes());cases=[]
    for c in r['cases']:
        models={};site={k:v for k,v in c.items() if k not in ['candidates','byte_pairs','target_pairs']}
        for group,key in [('byte_pairs','byte_ceiling'),('target_pairs','height_target_m')]:
            rows=[]
            for row in c[group]:
                saved={key:row[key]}
                for method in ['p1-fit','ruled-fit','hybrid-fit']:
                    e=compact_entry(row[method]);saved[method]=e['id'] if e else None
                    if e:models[e['id']]=e
                saved['unfitted']={}
                for method,entry in row['unfitted'].items():
                    e=compact_entry(entry);saved['unfitted'][method]=e['id'] if e else None
                    if e:models[e['id']]=e
                rows.append(saved)
            site[group]=rows
        site['models']=models;source=next(x for x in originals['cases'] if x['id']==c['id']);site['regular_grid']=source['regular_grid'];cases.append(site)
    summary={'schema':'gugis-source-global-fit-display-v1','report_sha256':sha((DEST/'results.json').read_bytes()),'protocol_sha256':r['protocol_sha256'],'native_models':native['native_models'],'native_queries':native['queries'],'seam_height_pairs':native['seam_height_pairs'],'aggregates':aggregates,'scope':r['scope'],'structure':r['structure'],'cases':cases,'package':{'filename':publication,'bytes':len(package),'sha256':sha(package)}};SUMMARY.write_bytes(packed(summary));index={p.relative_to(DEST).as_posix():{'bytes':p.stat().st_size,'sha256':sha(p.read_bytes())} for p in sorted(DEST.rglob('*')) if p.is_file()};(DEST/'file-index.json').write_bytes(packed(index));print(json.dumps({'package':summary['package'],'summary_bytes':SUMMARY.stat().st_size,'files':len(index),'aggregate':aggregates},indent=2));return summary
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('folder',type=Path);publish(parser.parse_args().folder.resolve())
