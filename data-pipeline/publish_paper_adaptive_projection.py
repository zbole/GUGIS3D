"""Replay the full PT-priority paper study and independently audit before publication."""
import argparse,csv,io,json,math,shutil,zipfile
from pathlib import Path
import paper_adaptive_projection_benchmark as producer
import paper_adaptive_projection_math as adaptive
import paper_adaptive_projection_audit as independent
ROOT=producer.ROOT;sha=producer.sha;packed=producer.packed
DEST=ROOT/'frontend/public/research/paper-adaptive-projection-v1';SUMMARY=ROOT/'shared/paper-adaptive-projection-display-v1.json'
def checked(p,h,size=None):
    b=p.read_bytes()
    if sha(b)!=h or size is not None and len(b)!=size:raise ValueError('Bound evidence changed: '+str(p))
    return b
def verify(folder):
    raw=(folder/'results.json').read_bytes();r=json.loads(raw);pr=checked(folder/'protocol.json',r['protocol_sha256']);protocol=json.loads(pr);source_raw=checked(folder/'source-report.json',protocol['source_report_sha256']);old_raw=checked(folder/'fitted-report.json',protocol['fitted_report_sha256']);source=json.loads(source_raw);prior=json.loads(old_raw)
    if pr!=producer.PROTOCOL.read_bytes() or source_raw!=(ROOT/protocol['source_report']).read_bytes() or old_raw!=(ROOT/protocol['fitted_report']).read_bytes() or r['source_report_sha256']!=sha(source_raw) or r['fitted_report_sha256']!=sha(old_raw):raise ValueError('Fixed inputs/protocol changed')
    nr=(folder/'native-audit.json').read_bytes();native=json.loads(nr)
    if native['report_sha256']!=sha(raw):raise ValueError('Native report changed')
    scripts={**r['scripts'],**native['scripts']}
    for p,h in scripts.items():
        if sha((ROOT/p).read_bytes().replace(b'\r\n',b'\n'))!=h:raise ValueError('Frozen implementation changed')
    if len(r['cases'])!=14 or [c['id'] for c in r['cases']]!=[c['id'] for c in source['cases']]:raise ValueError('Complete original fields/angles required')
    native_rows={(a['case_id'],a['filename']):a for a in native['models']};expected=set();rows=[];traces=[]
    for c,old,fit in zip(r['cases'],source['cases'],prior['cases']):
        if c['id']!=fit['id'] or any(c[k]!=old[k] for k in ['field','angle_degrees','source_frame']) or [p['budget'] for p in c['pairs']]!=protocol['budgets']:raise ValueError('Original source/order changed')
        regenerated,trace=adaptive.meshes(c['field'],c['source_frame'],protocol['budgets']);traw=checked(folder/c['id']/'refinement-trace.json',c['trace_sha256'])
        if traw!=packed(trace) or c['refinements']!=2046:raise ValueError('Exact greedy trace changed')
        trace_receipt,snapshots=independent.trace_audit(json.loads(traw),c['field'],c['source_frame']);traces.append({'case_id':c['id'],**trace_receipt})
        for p,again,previous,previous_fit in zip(c['pairs'],regenerated,old['pairs'],fit['pairs']):
            for key,entry in [('p1',previous['p1']),('fixed_pt',previous_fit['pt']),('before',previous['mean_hessian']),('fitted',previous_fit['c0-stable']),('p2',previous['p2'])]:
                if p[key]!=entry:raise ValueError('Previous stronger/higher-order control changed')
            e=p['adaptive_pt'];jr=checked(folder/c['id']/e['filename'],e['sha256'],e['bytes']);br=checked(folder/c['id']/e['binary_filename'],e['binary_sha256'],e['binary_bytes']);model=json.loads(jr)
            if jr!=packed(again['model']) or br!=producer.original.binary(again['model']) or e['e2_m2']!=again['e2_m2'] or e['native_triangles']!=p['budget']:raise ValueError('Replayed saved model changed')
            faces=[[[model['points'][i][0],model['points'][i][1]] for i in patch['indices']] for patch in model['patches']]
            if faces!=snapshots[p['budget']]:raise ValueError('Independent greedy geometry differs from saved model')
            v=independent.integral(model,c['field'],c['source_frame'])
            if not math.isfinite(v['e2_m2']) or abs(v['e2_m2']-e['e2_m2'])>1e-8*max(1,e['e2_m2']) or abs(v['integrated_area_m2']-10000)>1e-8:raise ValueError('Independent saved PT integral differs')
            key=(c['id'],e['filename']);expected.add(key);a=native_rows[key]
            if a['binary_sha256']!=e['binary_sha256'] or a['queries']!=1028 or not a['outside_rejected'] or any(not math.isfinite(a[k]) or not 0<=a[k]<1e-8 for k in ['height_difference_m','gradient_difference']):raise ValueError('Native audit incomplete')
            rows.append({'case_id':c['id'],'filename':e['filename'],'producer_difference_m2':abs(v['e2_m2']-e['e2_m2']),**v})
        print(c['id']+': exact PT greedy replay and independent saved-plane/trace audit complete',flush=True)
    if expected!=set(native_rows) or len(native_rows)!=len(native['models']) or native['native_models']!=126 or native['queries']!=129528:raise ValueError('All native models required')
    audit={'schema':'gugis-paper-adaptive-projection-independent-audit-v1','report_sha256':sha(raw),'models':rows,'traces':traces,'independent_script_sha256':sha((ROOT/'data-pipeline/paper_adaptive_projection_audit.py').read_bytes().replace(b'\r\n',b'\n'))}
    return r,native,audit
def plot(r):
    groups=[[c for c in r['cases'] if c['field']['id']==field] for field in ['anisotropic-quartic','published-quartic']]
    drops=[[100*(1-p['fitted']['e2_m2']/p['adaptive_pt']['e2_m2']) for c in group for p in c['pairs']] for group in groups]
    parts=['<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="670" viewBox="0 0 1100 670"><rect width="1100" height="670" fill="white"/><g font-family="Arial,sans-serif" fill="#294d42"><text x="26" y="33" font-size="19">Full paper-greedy PT priority / IT-L1 edge decision versus existing fitted ruled models</text><text x="26" y="58" font-size="12">All original fourteen fields/angles and nine budgets; no ruled-model reselection after observing stronger controls.</text>']
    for k,(values,title) in enumerate(zip(drops,['Strong anisotropic quartic','Original published quartic'])):
        left=65+k*545;low=50*math.floor(min(-10,*values)/50);high=50*math.ceil(max(100,*values)/50);y=lambda v:105+405*(high-v)/(high-low)
        parts.append(f'<text x="{left}" y="88" font-size="16">{title}</text>')
        for v in range(int(low),int(high)+1,50):parts.append(f'<path d="M{left} {y(v):.2f} H{left+450}" stroke="#e0e8e2"/><text x="{left-8}" y="{y(v)+4:.2f}" font-size="11" text-anchor="end">{v}%</text>')
        for i,v in enumerate(values):parts.append(f'<circle cx="{left+9+(i%9)*52}" cy="{y(v):.2f}" r="3.6" fill="{"#278d74" if v>0 else "#b88d52"}" fill-opacity=".72"/>')
        for i,n in enumerate([8,16,32,64,128,256,512,1024,2048]):parts.append(f'<text x="{left+9+i*52}" y="535" font-size="10" text-anchor="middle">{n}</text>')
    parts+=['<text x="26" y="569" font-size="12">Vertical: whole-domain E2 reduction relative to newly adaptive PT. Negative observations remain visible. Horizontal: actual PT triangles N.</text>','<text x="26" y="596" font-size="12">PT and IT share the paper equation (2.18) edge decision; the new PT region priority generates its own full mesh.</text>','<text x="26" y="622" font-size="12">Stored XYZ/records count; independent PT planes need not be C0. Existing ruled models preserve C0 and their old topology and bytes.</text>','<text x="26" y="647" font-size="12">A finite local implementation, not author software, an optimality theorem, ground accuracy, RAM/GPU or ArcGIS software timing.</text></g></svg>']
    return ('\n'.join(parts)+'\n').encode('utf8')
def publish(folder):
    r,native,audit=verify(folder)
    if DEST.exists() or SUMMARY.exists():raise FileExistsError('Immutable adaptive projection release exists')
    DEST.mkdir()
    for c in r['cases']:
        out=DEST/c['id'];out.mkdir()
        for p in c['pairs']:
            for key in ['filename','binary_filename']:shutil.copyfile(folder/c['id']/p['adaptive_pt'][key],out/p['adaptive_pt'][key])
        shutil.copyfile(folder/c['id']/'refinement-trace.json',out/'refinement-trace.json')
    for name in ['results.json','protocol.json','source-report.json','fitted-report.json','native-audit.json']:shutil.copyfile(folder/name,DEST/name)
    ar=packed(audit);(DEST/'independent-audit.json').write_bytes(ar);figure=plot(r);(DEST/'adaptive-projection-results.svg').write_bytes(figure)
    stream=io.StringIO(newline='');writer=csv.writer(stream,lineterminator='\n');writer.writerow(['case_id','N','method','actual_complete_bytes','E2_m2'])
    for c in r['cases']:
        for p in c['pairs']:
            for method in ['p1','fixed_pt','adaptive_pt','before','fitted','p2']:writer.writerow([c['id'],p['budget'],method,p[method]['binary_bytes'],p[method]['e2_m2']])
    csvraw=stream.getvalue().encode('utf8');(DEST/'all-methods.csv').write_bytes(csvraw)
    scripts={**r['scripts'],**native['scripts']}
    for file in ['data-pipeline/publish_paper_adaptive_projection.py','data-pipeline/paper_adaptive_projection_audit.py']:scripts[file]=sha((ROOT/file).read_bytes().replace(b'\r\n',b'\n'))
    for file in scripts:
        out=DEST/'implementation'/file;out.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/file,out)
    previous=json.loads((ROOT/'shared/paper-projection-display-v1.json').read_bytes());p=previous['package'];shutil.copyfile(ROOT/'frontend/public/research/paper-projection-stable-v1'/p['filename'],DEST/'prior-projection-evidence.zip');checked(DEST/'prior-projection-evidence.zip',p['sha256'],p['bytes'])
    package=DEST/'adaptive-projection-evidence.zip'
    with zipfile.ZipFile(package,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        for file in sorted(DEST.rglob('*')):
            if file.is_file() and file!=package:
                info=zipfile.ZipInfo(file.relative_to(DEST).as_posix(),date_time=(2026,10,6,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,file.read_bytes(),compresslevel=9)
    s={k:v for k,v in r.items() if k!='scripts'}|{'scripts':scripts,'report_sha256':sha((DEST/'results.json').read_bytes()),'native_models':native['native_models'],'native_queries':native['queries'],'native_audit_sha256':sha((DEST/'native-audit.json').read_bytes()),'independent_audit_sha256':sha(ar),'figure_sha256':sha(figure),'csv_sha256':sha(csvraw),'package':{'filename':package.name,'bytes':package.stat().st_size,'sha256':sha(package.read_bytes())}}
    sr=packed(s);SUMMARY.write_bytes(sr);(DEST/'publication.json').write_bytes(sr);print(json.dumps({'models':native['native_models'],'package':s['package']}))
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('folder',type=Path);p.add_argument('--verify-only',action='store_true');a=p.parse_args()
    if a.verify_only:verify(a.folder)
    else:publish(a.folder)
