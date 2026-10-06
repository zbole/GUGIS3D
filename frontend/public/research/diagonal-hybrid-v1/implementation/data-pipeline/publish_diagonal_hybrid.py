"""Independently verify every stronger real-DTM triangle control before publication."""
import argparse,csv,html,io,json,math,shutil,zipfile
from pathlib import Path
import numpy as np
import diagonal_hybrid_benchmark as producer
import diagonal_hybrid_math as geometry
import diagonal_hybrid_audit as independent
ROOT=producer.ROOT;sha=producer.sha;packed=producer.packed
DEST=ROOT/'frontend/public/research/diagonal-hybrid-v1';SUMMARY=ROOT/'shared/diagonal-hybrid-display-v1.json'
def checked(p,h,size=None):
    raw=p.read_bytes()
    if sha(raw)!=h or size is not None and len(raw)!=size:raise ValueError('Evidence changed: '+str(p))
    return raw
def verify(folder):
    raw=(folder/'results.json').read_bytes();r=json.loads(raw);protocol_raw=checked(folder/'protocol.json',r['protocol_sha256']);protocol=json.loads(protocol_raw);source_raw=checked(folder/'source-report.json',protocol['source_report_sha256']);parent=json.loads(source_raw);prior_raw=checked(folder/'prior-hybrid-report.json',protocol['prior_hybrid_report_sha256']);prior=json.loads(prior_raw);audit_raw=(folder/'native-audit.json').read_bytes();audit=json.loads(audit_raw)
    if protocol_raw!=producer.PROTOCOL.read_bytes() or source_raw!=(ROOT/protocol['source_report']).read_bytes() or prior_raw!=(ROOT/protocol['prior_hybrid_report']).read_bytes():raise ValueError('Fixed input/protocol changed')
    if r['source_report_sha256']!=sha(source_raw) or r['prior_hybrid_report_sha256']!=sha(prior_raw) or audit['report_sha256']!=sha(raw):raise ValueError('Input/audit identity changed')
    scripts={**r['scripts'],**audit['scripts']}
    for p,h in scripts.items():
        if sha((ROOT/p).read_bytes().replace(b'\r\n',b'\n'))!=h:raise ValueError('Bound source changed')
    if [c['id'] for c in r['cases']]!=[c['id'] for c in parent['cases']] or len(r['cases'])!=20:raise ValueError('Incomplete fixed source sites')
    rows={(a['case_id'],a['filename']):a for a in audit['models']};expected=set();integrals=[];validated=set();total_seams=0
    for c,p,old in zip(r['cases'],parent['cases'],prior['cases']):
        ref,refraw=producer.load_reference(p,validated);directory=folder/c['id'];checked(directory/'reference.json',p['reference_sha256']);checked(directory/'source-window.tif',c['source_geotiff']['sha256'],c['source_geotiff']['bytes'])
        if refraw!=(directory/'reference.json').read_bytes() or c['origin_bng']!=p['origin_bng'] or c['source_identity']!=p['source_identity'] or c['source_geotiff']!=old['source_geotiff']:raise ValueError('Original source metadata/window changed')
        names=[f'{family}-{nx}x{ny}' for nx in protocol['axis_cells'] for ny in protocol['axis_cells'] for family in protocol['methods']]
        if [e['id'] for e in c['candidates']]!=names:raise ValueError('Missing grids/strong controls')
        cache={};mirror_cache={};cursor=0
        for nx in protocol['axis_cells']:
            for ny in protocol['axis_cells']:
                # Exact fixed-protocol replay checks numerical tie handling and costs.
                reproduced=geometry.grid(ref,nx,ny,cache,mirror_cache)
                for method in protocol['methods']:
                    entry=c['candidates'][cursor];cursor+=1;model,metrics=reproduced[method];jr=checked(directory/entry['filename'],entry['sha256'],entry['bytes']);br=checked(directory/entry['binary_filename'],entry['binary_sha256'],entry['binary_bytes'])
                    if jr!=packed(model) or br!=producer.binary(model) or any(entry[k]!=v for k,v in metrics.items()):raise ValueError('Saved native model / numerical choice / complete bytes differ')
                    values=independent.audit(ref,json.loads(jr),nx,ny,entry['families'])
                    for key in ['e2_m2','continuous_maximum_m','integrated_area_m2']:
                        if abs(values[key]-entry[key])>1e-8*max(1,abs(entry[key])):raise ValueError('Independent saved-function measurement differs')
                    if entry['continuous_bound_m']!=entry['continuous_maximum_m']+entry['float64_guard_m']:raise ValueError('Maximum-error guard differs')
                    key=(c['id'],entry['filename']);expected.add(key);native=rows[key];seams=7*((nx-1)*ny+(ny-1)*nx);total_seams+=seams
                    if any(not math.isfinite(native[k]) or native[k]<0 for k in ['independent_height_difference_m','independent_gradient_difference','frame_difference_m','seam_height_difference_m']):raise ValueError('Native audit has non-finite/negative differences')
                    if native['binary_sha256']!=entry['binary_sha256'] or native['queries']!=5249 or native['independent_height_difference_m']>=1e-8 or native['independent_gradient_difference']>=1e-8 or native['frame_difference_m']>=1e-8 or native['seam_height_pairs']!=seams or native['seam_height_difference_m']>=1e-8 or not native['maximum_witness_verified'] or not native['outside_rejected']:raise ValueError('Incomplete native/continuity checks')
                    integrals.append({'case_id':c['id'],'filename':entry['filename'],**{k:v for k,v in values.items() if k!='cell_l2_squared'},'producer_e2_difference_m2':abs(values['e2_m2']-entry['e2_m2']),'producer_maximum_difference_m':abs(values['continuous_maximum_m']-entry['continuous_maximum_m'])})
        pairs,targets=producer.choices(c['candidates'],protocol)
        for calculated,stored,key,originals in [(pairs,c['byte_pairs'],'byte_ceiling',old['byte_pairs']),(targets,c['target_pairs'],'height_target_m',old['target_pairs'])]:
            for row in calculated:row['prior']={k:v for k,v in next(x for x in originals if x[key]==row[key]).items() if k in ['p1','ruled','hybrid']}
            if calculated!=stored:raise ValueError('Selection / missing target / prior control changed')
        print(c['id']+': exact replay and independent saved-function integrals verified',flush=True)
    if set(rows)!=expected or len(rows)!=len(audit['models']) or audit['native_models']!=1960 or audit['queries']!=10288040 or audit['seam_height_pairs']!=total_seams:raise ValueError('Audit coverage incomplete')
    independent_report={'schema':'gugis-diagonal-hybrid-integral-audit-v1','report_sha256':sha(raw),'models':integrals,'independent_integration':'Five-node source-cell tensor / clipped Gauss-Duffy integration of actual saved corner heights; both oblique diagonals and source-cell corner maxima. Numerically independent of producer mass matrices / three-node quadrature.','script_sha256':{p:sha((ROOT/p).read_bytes().replace(b'\r\n',b'\n')) for p in ['data-pipeline/diagonal_hybrid_audit.py','data-pipeline/hybrid_source_audit.py']}}
    return r,audit,independent_report
def plot(r):
    rows=[next(p for p in c['byte_pairs'] if p['byte_ceiling']==8192) for c in r['cases']];maximum=max(1.2,*[p['hybrid-local']['e2_m2']/p['p1-local']['e2_m2'] for p in rows],*[p['prior']['hybrid']['e2_m2']/p['p1-local']['e2_m2'] for p in rows]);upper=math.ceil(maximum*4)/4;left=320;width=590;x=lambda v:left+width*v/upper
    parts=['<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="915" viewBox="0 0 1100 915"><rect width="1100" height="915" fill="white"/>','<g font-family="Arial,sans-serif" fill="#294d42"><text x="26" y="34" font-size="19">Real source DTM: stronger two-diagonal P1 controls and C0 mixtures</text><text x="26" y="60" font-size="13">All twenty original 65x65 windows / complete native file ceiling 8192 B / whole-domain E2 relative to selected local-diagonal P1.</text>']
    for v in np.arange(0,upper+.01,.25):parts.append(f'<path d="M{x(v):.2f} 100 V758" stroke="#e1e8e3"/><text x="{x(v):.2f}" y="781" font-size="12" text-anchor="middle">{v:.2f}</text>')
    for i,(c,p) in enumerate(zip(r['cases'],rows)):
        y=116+31*i;parts.append(f'<text x="26" y="{y+4}" font-size="12">{html.escape(c["id"])}</text><circle cx="{x(1):.2f}" cy="{y}" r="3" fill="#6d8a9b"/><circle cx="{x(p["prior"]["hybrid"]["e2_m2"]/p["p1-local"]["e2_m2"]):.2f}" cy="{y-5}" r="4" fill="#b58d52"/><circle cx="{x(p["hybrid-local"]["e2_m2"]/p["p1-local"]["e2_m2"]):.2f}" cy="{y+5}" r="4" fill="#248d74"/>')
    parts+=['<circle cx="26" cy="815" r="4" fill="#6d8a9b"/><text x="38" y="819" font-size="12">P1 choosing either diagonal</text><circle cx="330" cy="815" r="4" fill="#b58d52"/><text x="342" y="819" font-size="12">Prior fixed-diagonal mixture</text><circle cx="660" cy="815" r="4" fill="#248d74"/><text x="672" y="819" font-size="12">New three-way local mixture</text>','<text x="26" y="849" font-size="12">Every orientation/type run and index byte counts. Shared linear boundary functions preserve C0; gradients may jump.</text>','<text x="26" y="874" font-size="12">All 1960 new candidates and all byte/target comparisons retained, including losses and missing models.</text>','<text x="26" y="899" font-size="12">Fixed tensor-grid source-function comparison; not adaptive paper P1, measured ground accuracy or ArcGIS software.</text></g></svg>']
    return ('\n'.join(parts)+'\n').encode('utf8')
def publish(folder):
    r,audit,integral=verify(folder)
    if DEST.exists() or SUMMARY.exists():raise FileExistsError('Immutable diagonal-control release exists')
    DEST.mkdir();source_publication=json.loads((ROOT/'shared/source-native-bands-v1.json').read_bytes());cases=[]
    for c in r['cases']:
        src=folder/c['id'];out=DEST/c['id'];out.mkdir()
        for e in c['candidates']:
            for key in ['filename','binary_filename']:shutil.copyfile(src/e[key],out/e[key])
        for file in ['reference.json','source-window.tif']:shutil.copyfile(src/file,out/file)
        original=next(x for x in source_publication['cases'] if x['id']==c['id']);site={k:v for k,v in c.items() if k!='candidates'}
        site['regular_grid']=original['regular_grid'];site['full_source_ruled_bytes']=135528
        # Keep family counts in selected rows; per-cell lists stay in the full report.
        for group in ['byte_pairs','target_pairs']:
            site[group]=[{k:({m:{a:b for a,b in e.items() if a!='families'} if e else None for m,e in v.items()} if k=='prior' else {a:b for a,b in v.items() if a!='families'} if k in ['p1-local','hybrid-local'] and v else v) for k,v in row.items()} for row in c[group]]
        cases.append(site)
    for name in ['protocol.json','source-report.json','prior-hybrid-report.json','results.json','native-audit.json']:shutil.copyfile(folder/name,DEST/name)
    integral_raw=packed(integral);(DEST/'integral-audit.json').write_bytes(integral_raw);figure=plot(r);(DEST/'diagonal-hybrid-results.svg').write_bytes(figure)
    fields=['case_id','condition','constraint','method','complete_bytes','e2_m2','continuous_bound_m','ruled_cells','minus_cells','plus_cells'];stream=io.StringIO(newline='');writer=csv.DictWriter(stream,fieldnames=fields,lineterminator='\n');writer.writeheader()
    for c in r['cases']:
        for condition,group,key in [('bytes','byte_pairs','byte_ceiling'),('maximum_error','target_pairs','height_target_m')]:
            for row in c[group]:
                for family in ['p1-local','hybrid-local']:
                    e=row[family];v={'case_id':c['id'],'condition':condition,'constraint':row[key],'method':family}
                    if e:v.update(complete_bytes=e['binary_bytes'],**{k:e[k] for k in ['e2_m2','continuous_bound_m','ruled_cells','minus_cells','plus_cells']})
                    writer.writerow(v)
    csvraw=stream.getvalue().encode('utf8');(DEST/'selections.csv').write_bytes(csvraw)
    scripts={**r['scripts'],**audit['scripts'],**integral['script_sha256']};scripts['data-pipeline/publish_diagonal_hybrid.py']=sha(Path(__file__).read_bytes().replace(b'\r\n',b'\n'))
    for p,h in scripts.items():
        target=DEST/'implementation'/p;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/p,target)
    previous=json.loads((ROOT/'shared/hybrid-source-display-v1.json').read_bytes());prior=ROOT/'frontend/public/research/hybrid-source-v1'/previous['package']['filename'];checked(prior,previous['package']['sha256'],previous['package']['bytes']);shutil.copyfile(prior,DEST/'prior-hybrid-source-evidence.zip')
    (DEST/'README.txt').write_text('Stronger fixed-grid control: P1 chooses either rectangle diagonal, with all native orientation-run costs. Three-way C0 mixture chooses ruled/minus/plus. Fixed 20 original Float32 source windows, complete native bytes, whole-source integrals and both diagonal extrema. All failures, ties and missing models retained. Source-function error, not surveyed ground truth, adaptive paper-P1, GPU timing or ArcGIS software. Original source metadata conventions, OGL attribution and unit warnings preserved. Prior immutable experiment is included in its entirety.\n',encoding='utf8')
    package=DEST/'diagonal-hybrid-evidence.zip'
    with zipfile.ZipFile(package,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        for p in sorted(DEST.rglob('*')):
            if p.is_file() and p!=package:
                info=zipfile.ZipInfo(p.relative_to(DEST).as_posix(),date_time=(2026,10,6,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,p.read_bytes(),compresslevel=9)
    publication={k:v for k,v in r.items() if k!='cases'}|{'cases':cases,'scripts':scripts,'report_sha256':sha((DEST/'results.json').read_bytes()),'native_audit_sha256':sha((DEST/'native-audit.json').read_bytes()),'integral_audit_sha256':sha(integral_raw),'figure_sha256':sha(figure),'selections_csv_sha256':sha(csvraw),'native_models':audit['native_models'],'native_queries':audit['queries'],'seam_height_pairs':audit['seam_height_pairs'],'package':{'filename':package.name,'bytes':package.stat().st_size,'sha256':sha(package.read_bytes())}}
    summary=packed(publication);(DEST/'publication.json').write_bytes(summary);SUMMARY.write_bytes(summary);print(json.dumps({'models':audit['native_models'],'package':publication['package']},ensure_ascii=False))
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('folder',type=Path);parser.add_argument('--verify-only',action='store_true');args=parser.parse_args()
    if args.verify_only:verify(args.folder)
    else:publish(args.folder)
