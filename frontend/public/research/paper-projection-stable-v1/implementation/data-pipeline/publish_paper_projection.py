"""Verify fixed-space fitting, including its failed prototype, before publication."""
import argparse,csv,html,io,json,math,shutil,zipfile
from pathlib import Path
import numpy as np
import paper_projection_stable_benchmark as producer
import paper_projection_math as original_projection
import paper_projection_stable_math as stable
import paper_projection_audit as independent
import variable_curvature_ruled as frozen
ROOT=producer.ROOT;sha=producer.sha;packed=producer.packed;DEST=ROOT/'frontend/public/research/paper-projection-stable-v1';SUMMARY=ROOT/'shared/paper-projection-display-v1.json'
def checked(p,h,size=None):
    raw=p.read_bytes()
    if sha(raw)!=h or size is not None and len(raw)!=size:raise ValueError('Evidence bytes changed: '+str(p))
    return raw
def verify(folder):
    raw=(folder/'results.json').read_bytes();r=json.loads(raw);protocolraw=checked(folder/'protocol.json',r['protocol_sha256']);p=json.loads(protocolraw);source_raw=checked(folder/'source-report.json',p['input_sha256']);source=json.loads(source_raw);proto_raw=checked(folder/'prototype-report.json',p['prototype_report_sha256']);prototype=json.loads(proto_raw);audit_raw=(folder/'native-audit.json').read_bytes();audit=json.loads(audit_raw)
    if protocolraw!=producer.PROTOCOL.read_bytes() or source_raw!=(ROOT/p['input']).read_bytes() or audit['report_sha256']!=sha(raw):raise ValueError('Protocol / source / audit identity changed')
    for file,h in {**r['scripts'],**audit['scripts']}.items():
        if sha((ROOT/file).read_bytes().replace(b'\r\n',b'\n'))!=h:raise ValueError('Bound implementation changed')
    if [c['id'] for c in r['cases']]!=[c['id'] for c in source['cases']] or len(r['cases'])!=14 or sum(len(c['pairs']) for c in r['cases'])!=126:raise ValueError('Missing fixed pairs')
    native={(a['case_id'],a['filename']):a for a in audit['models']};done=set();rows=[];prototype_failures=[]
    for c,prior,proto in zip(r['cases'],source['cases'],prototype['cases']):
        if any(c[k]!=prior[k] for k in ['field','angle_degrees','source_frame']):raise ValueError('Field/rotation changed')
        frame=np.asarray(c['source_frame']);fn=lambda xy:frozen.value(xy,c['field'],frame)
        if [e['budget'] for e in c['pairs']]!=[e['budget'] for e in prior['pairs']]:raise ValueError('Missing budgets')
        for row,old,failed in zip(c['pairs'],prior['pairs'],proto['pairs']):
            if row['prior']!={k:old[k] for k in ['p1','mean_hessian','p2']} or row['prototype']!={k:failed[k] for k in ['pt','c0-l2']}:raise ValueError('Original/prototype controls changed')
            for family,key in [('pt','p1'),('c0-stable','mean_hessian')]:
                e=row[family];original=json.loads(checked(ROOT/'frontend/public/research/variable-curvature-v1'/c['id']/old[key]['filename'],old[key]['sha256']));binding=(c['id'],e['filename'])
                if binding in done:continue
                done.add(binding);jr=checked(folder/c['id']/e['filename'],e['sha256'],e['bytes']);br=checked(folder/c['id']/e['binary_filename'],e['binary_sha256'],e['binary_bytes']);model=json.loads(jr);replayed,solver=(original_projection.project_p1(original,fn) if family=='pt' else stable.project_c0_ruled(original,fn))
                if packed(replayed)!=jr or frozen.binary(replayed)!=br or solver!=e['solver']:raise ValueError('Exact native fit / gate replay differs')
                if family=='pt' and (e['sha256']!=failed['pt']['sha256'] or e['binary_sha256']!=failed['pt']['binary_sha256']):raise ValueError('PT control changed')
                if family=='c0-stable' and (e['binary_bytes']!=old[key]['binary_bytes'] or model['patches']!=original['patches'] or [v[:2] for v in model['points']]!=[v[:2] for v in original['points']]):raise ValueError('Fitted topology/cost changed')
                measured=independent.integral(model,c['field'],frame);orthogonal=independent.orthogonality(model,original,c['field'],frame) if family=='pt' or solver['accepted'] else {'fallback_recorded':True}
                if abs(measured['e2_m2']-e['e2_m2'])>1e-8*max(1,e['e2_m2']):raise ValueError('Independent saved-function E2 differs')
                if family=='c0-stable' and measured['e2_m2']>old[key]['e2_m2']+1e-8*max(1,old[key]['e2_m2']):raise ValueError('Accepted native fit worsens measured source error')
                n=native[binding]
                if n['binary_sha256']!=e['binary_sha256'] or n['queries']!=1028 or not n['outside_rejected'] or any(not math.isfinite(n[k]) or n[k]<0 or n[k]>=1e-8 for k in ['height_difference_m','gradient_difference','seam_difference_m']):raise ValueError('Native/continuity audit failed')
                rows.append({'case_id':c['id'],'filename':e['filename'],'e2_m2':measured['e2_m2'],'producer_difference_m2':abs(measured['e2_m2']-e['e2_m2']),**orthogonal})
            proto_e=failed['c0-l2']
            if proto_e['e2_m2']>old['mean_hessian']['e2_m2']:prototype_failures.append({'case_id':c['id'],'budget':row['budget'],'filename':proto_e['filename'],'e2_m2':proto_e['e2_m2'],'old_e2_m2':old['mean_hessian']['e2_m2'],'classification':'unstable prototype retained; not a valid native published model'})
        print(c['id']+': original PT bytes, constrained fit, saved orthogonality and independent integrals checked',flush=True)
    if set(native)!=done or len(native)!=len(audit['models']) or audit['native_models']!=len(done) or audit['queries']!=1028*len(done):raise ValueError('Native model coverage differs')
    return r,audit,{'schema':'gugis-paper-projection-independent-audit-v1','report_sha256':sha(raw),'models':rows,'prototype_failures':prototype_failures,'implementation':{file:sha((ROOT/file).read_bytes().replace(b'\r\n',b'\n')) for file in ['data-pipeline/paper_projection_audit.py','data-pipeline/publish_variable_curvature.py']}}
def plot(r):
    parts=['<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="620" viewBox="0 0 1100 620"><rect width="1100" height="620" fill="white"/><g font-family="Arial,sans-serif" fill="#294d42"><text x="26" y="32" font-size="19">Shared-space L2 fitting: stronger paper-permitted P_T control on a fixed mesh</text><text x="26" y="58" font-size="12">Every original field/rotation/budget stays. Main improvement changes only shared Bezier Z, preserving C0 and native bytes.</text>']
    for idx,field in enumerate(['anisotropic-quartic','published-quartic']):
        rows=[(c,p) for c in r['cases'] if c['id'].startswith(field) for p in c['pairs']];vals=[100*(1-p['c0-stable']['e2_m2']/p['pt']['e2_m2']) for _,p in rows];low=min(-10,math.floor(min(vals)/20)*20);high=max(100,math.ceil(max(vals)/20)*20);left=70+idx*535;x=lambda v:left+470*(v-low)/(high-low);wins=sum(v>0 for v in vals)
        parts.append(f'<text x="{left}" y="97" font-size="14">{field}: {wins}/63 below the P_T control</text>')
        for v in np.arange(low,high+.1,20):parts.append(f'<path d="M{x(v):.2f} 113 V400" stroke="#e1e8e3"/><text x="{x(v):.2f}" y="421" text-anchor="middle" font-size="11">{v:g}%</text>')
        for i,((c,p),v) in enumerate(zip(rows,vals)):parts.append(f'<circle cx="{x(v):.2f}" cy="{123+4.25*i:.2f}" r="2.7" fill="{"#288c76" if v>0 else "#bd8853"}"><title>{html.escape(c["id"])} N={p["budget"]}: E2 reduction vs fixed-mesh PT {v:.6f}%</title></circle>')
    parts+=['<text x="26" y="466" font-size="12">P_T uses each original interpolation-greedy triangle; it is not a newly projection-driven greedy adaptive mesh.</text><text x="26" y="492" font-size="12">Higher-order P2 controls remain; identical-space fitting gains are separate from degree/encoding differences.</text><text x="26" y="518" font-size="12">The complete unstable prototype is retained; weak-support controls stay at original Z under a fixed numerical rule.</text><text x="26" y="544" font-size="12">All 126 outcomes retained. Finite source-function results, not a new P1 theorem or ground-truth/ArcGIS/CPU/GPU claims.</text></g></svg>'];return ('\n'.join(parts)+'\n').encode()
def publish(folder):
    r,audit,integrals=verify(folder)
    if DEST.exists() or SUMMARY.exists():raise FileExistsError('Immutable fitting release exists')
    DEST.mkdir();used=set()
    for c in r['cases']:
        out=DEST/c['id'];out.mkdir()
        for p in c['pairs']:
            for family in ['pt','c0-stable']:
                for key in ['filename','binary_filename']:
                    file=p[family][key]
                    if (c['id'],file) not in used:shutil.copyfile(folder/c['id']/file,out/file);used.add((c['id'],file))
    for file in ['results.json','protocol.json','source-report.json','prototype-report.json','native-audit.json']:shutil.copyfile(folder/file,DEST/file)
    ir=packed(integrals);(DEST/'integral-audit.json').write_bytes(ir);figure=plot(r);(DEST/'paper-projection-results.svg').write_bytes(figure)
    scripts={**r['scripts'],**audit['scripts'],**integrals['implementation']};scripts['data-pipeline/publish_paper_projection.py']=sha(Path(__file__).read_bytes().replace(b'\r\n',b'\n'))
    for file,h in scripts.items():target=DEST/'implementation'/file;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/file,target)
    proto=ROOT/'.local/research/paper-projection-2026-10-06-fixed';prototype_report=json.loads((folder/'prototype-report.json').read_bytes());copy=DEST/'prototype';copy.mkdir()
    if not proto.exists():raise ValueError('Complete unchanged prototype required for first publication')
    for file in ['results.json','protocol.json','source-report.json']:shutil.copyfile(proto/file,copy/file)
    for c in prototype_report['cases']:
        target=copy/c['id'];target.mkdir();done=set()
        for p in c['pairs']:
            for family in ['pt','c0-l2']:
                for name,h,n in [('filename','sha256','bytes'),('binary_filename','binary_sha256','binary_bytes')]:
                    e=p[family];checked(proto/c['id']/e[name],e[h],e[n])
                    if e[name] not in done:shutil.copyfile(proto/c['id']/e[name],target/e[name]);done.add(e[name])
    for file,h in prototype_report['scripts'].items():
        checked(ROOT/file,h) if file.endswith('.json') else None
        target=copy/'implementation'/file;target.parent.mkdir(parents=True,exist_ok=True);raw=(ROOT/file).read_bytes()
        if sha(raw.replace(b'\r\n',b'\n'))!=h:raise ValueError('Prototype source changed')
        target.write_bytes(raw)
    old=json.loads((ROOT/'shared/variable-curvature-display-v1.json').read_bytes());previous=ROOT/'frontend/public/research/variable-curvature-v1'/old['package']['filename'];checked(previous,old['package']['sha256'],old['package']['bytes']);shutil.copyfile(previous,DEST/'prior-variable-curvature-evidence.zip')
    stream=io.StringIO(newline='');writer=csv.writer(stream,lineterminator='\n');writer.writerow(['case_id','N','prior_ruled_E2','fitted_E2','PT_E2','P2_E2','same_ruled_bytes','PT_bytes','accepted','weak_controls'])
    for c in r['cases']:
        for p in c['pairs']:writer.writerow([c['id'],p['budget'],p['prior']['mean_hessian']['e2_m2'],p['c0-stable']['e2_m2'],p['pt']['e2_m2'],p['prior']['p2']['e2_m2'],p['c0-stable']['binary_bytes'],p['pt']['binary_bytes'],p['c0-stable']['solver']['accepted'],p['c0-stable']['solver']['weak_controls_held_at_original_z']])
    cr=stream.getvalue().encode();(DEST/'pairs.csv').write_bytes(cr);(DEST/'README.txt').write_text('Rank-aware fixed-space L2 fitting. All 126 original pairs, all controls and the complete unstable prototype retained. Same ruled XY/indices/native bytes; constrained shared Z preserves C0. PT is local projection on a frozen interpolation-driven mesh, not a projection-driven adaptive algorithm. Higher-order P2 stays explicit. Finite Float64 whole-source integrals, not original-author software, best coding, continuous maximum-error, surveyed ground accuracy, CPU/GPU/RAM/ArcGIS performance. Prototype files marked invalid remain evidence only and must not be loaded as valid native models.\n',encoding='utf8')
    package=DEST/'paper-projection-evidence.zip'
    with zipfile.ZipFile(package,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        for path in sorted(DEST.rglob('*')):
            if path.is_file() and path!=package:
                info=zipfile.ZipInfo(path.relative_to(DEST).as_posix(),date_time=(2026,10,6,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,path.read_bytes(),compresslevel=9)
    publication={**r,'scripts':scripts,'native_models':audit['native_models'],'native_queries':audit['queries'],'seam_pairs':audit['seam_pairs'],'report_sha256':sha((DEST/'results.json').read_bytes()),'native_audit_sha256':sha((DEST/'native-audit.json').read_bytes()),'integral_audit_sha256':sha(ir),'figure_sha256':sha(figure),'pairs_csv_sha256':sha(cr),'package':{'filename':package.name,'bytes':package.stat().st_size,'sha256':sha(package.read_bytes())}}
    pr=packed(publication);(DEST/'publication.json').write_bytes(pr);SUMMARY.write_bytes(pr);print(json.dumps({'models':audit['native_models'],'package':publication['package']}))
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('folder',type=Path);parser.add_argument('--verify-only',action='store_true');a=parser.parse_args();verify(a.folder) if a.verify_only else publish(a.folder)
