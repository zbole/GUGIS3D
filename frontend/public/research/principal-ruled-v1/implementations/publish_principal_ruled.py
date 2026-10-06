"""Independently verify and release the complete rotation study and P2 controls."""
import argparse
import csv
import io
import json
import math
from pathlib import Path
import shutil
import zipfile
import numpy as np
from principal_ruled_benchmark import ROOT,ANGLES,DENSITIES,DOMAIN,BUDGETS,sha,packed,binary,ruled_model,ruled_metrics,principal_frame,source_value,paper_snapshots
from principal_order_control import make_control,control_binary,control_metrics
from plot_principal_ruled import plot
DEST=ROOT/'frontend/public/research/principal-ruled-v1';SUMMARY=ROOT/'shared/principal-ruled-display-v1.json'
def checked(path,digest,size=None):
    b=path.read_bytes()
    if sha(b)!=digest or (size is not None and len(b)!=size):raise ValueError('Changed evidence '+path.name)
    return b
def integrate_p1(m,q):
    t,w=np.polynomial.legendre.leggauss(5);t=(t+1)/2;w=w/2;u,v=np.meshgrid(t,t,indexing='ij');wu,wv=np.meshgrid(w,w,indexing='ij');b=u.ravel();c=((1-u)*v).ravel();a=1-b-c;weights=(wu*wv*(1-u)).ravel();parts=[];areas=[];count=0
    for p in m['patches']:
        if p['kind']!='triangle-strip':raise ValueError('Retained P1 required')
        for j in range(len(p['indices'])-2):
            nodes=np.array([m['points'][i] for i in p['indices'][j:j+3]]);pa,pb,pc=nodes[:,:2];det=abs(float(np.linalg.det(np.column_stack((pb-pa,pc-pa)))));xy=a[:,None]*pa+b[:,None]*pb+c[:,None]*pc;residual=a*nodes[0,2]+b*nodes[1,2]+c*nodes[2,2]-source_value(xy,q)
            parts.append(float(np.dot(weights,residual**2))*det);areas.append(det/2);count+=1
    area=math.fsum(areas)
    if abs(area-10000)>1e-7:raise ValueError('P1 coverage differs from fixed domain')
    return math.sqrt(math.fsum(parts)),count
def verify(folder):
    raw=(folder/'results.json').read_bytes();r=json.loads(raw);parent_raw=(folder/'parent-results.json').read_bytes();parent=json.loads(parent_raw);ar=(folder/'native-audit.json').read_bytes();audit=json.loads(ar)
    if r['schema']!='gugis-principal-ruled-order-control-v1' or r['angles_degrees']!=list(ANGLES) or r['densities']!=list(DENSITIES) or r['budgets']!=list(BUDGETS) or r['domain_m']!=list(DOMAIN) or len(r['cases'])!=7:raise ValueError('Changed fixed experiment')
    if sha(parent_raw)!=r['parent_report_sha256'] or parent['schema']!='gugis-principal-ruled-v1':raise ValueError('Changed parent study')
    for key in parent:
        if key not in ('schema','cases') and r[key]!=parent[key]:raise ValueError('Parent metadata changed')
    scripts={**r['scripts'],'data-pipeline/principal_order_control.py':r['control_script_sha256'],'frontend/src/compare/principalRuledMath.ts':audit['kernel_sha256'],'frontend/scripts/audit-principal-ruled.mjs':audit['auditor_sha256']}
    for p,h in scripts.items():
        if sha((ROOT/p).read_bytes().replace(b'\r\n',b'\n'))!=h:raise ValueError('Bound implementation changed '+p)
    if audit['report_sha256']!=sha(raw):raise ValueError('Audit refers to a different report')
    expected=set()
    for index,c in enumerate(r['cases']):
        if c['angle_degrees']!=ANGLES[index] or {k:v for k,v in c.items() if k!='p2_control'}!=parent['cases'][index]:raise ValueError('Selected or altered rotation case')
        angle=math.radians(ANGLES[index]);rotation=np.array([[math.cos(angle),-math.sin(angle)],[math.sin(angle),math.cos(angle)]]);q=rotation@np.diag([.004,.00004])@rotation.T
        if not np.array_equal(q,np.array(c['q_matrix'])):raise ValueError('Quadratic source changed')
        frame,eigen=principal_frame(q)
        if frame.tolist()!=c['principal_frame'] or eigen!=c['eigenvalues']:raise ValueError('Changed Hessian frame')
        pool={};out=folder/c['id']
        expected_candidates=[f'{family}-{n}' for family in ('world-x','world-y','principal') for n in DENSITIES]
        if [e['id'] for e in c['candidates']]!=expected_candidates:raise ValueError('Incomplete directional pool')
        for e in c['candidates']:
            basis=frame if e['family']=='principal' else np.eye(2) if e['family']=='world-x' else np.array([[0.,-1.],[1.,0.]])
            m=ruled_model(q,basis,e['density']);jb=packed(m);bb=binary(m)
            if sha(jb)!=e['sha256'] or len(jb)!=e['bytes'] or sha(bb)!=e['binary_sha256'] or len(bb)!=e['binary_bytes']:raise ValueError('Changed candidate file accounting')
            recomputed=ruled_metrics(m,q,5)
            for k in ('e2_m2','continuous_bound_m','integrated_area_m2'):
                if abs(e[k]-recomputed[k])>1e-9*max(1,abs(e[k])):raise ValueError('Full clipped ruled integral failed')
            pool[e['id']]=(m,e)
        if [p['budget'] for p in c['pairs']]!=list(BUDGETS):raise ValueError('Incomplete N series')
        snapshots=paper_snapshots(q)
        for p,(canonical,stats) in zip(c['pairs'],snapshots):
            e=p['p1'];jb=checked(out/e['filename'],e['sha256'],e['bytes']);bb=checked(out/e['binary_filename'],e['binary_sha256'],e['binary_bytes'])
            if jb!=packed(canonical) or bb!=binary(canonical):raise ValueError('Paper-style mesh, sharing or strip packing changed')
            for key,value in stats.items():
                if e[key]!=value:raise ValueError('Paper-style closed-form metrics changed')
            integral,count=integrate_p1(json.loads(jb),q)
            if count!=p['budget'] or abs(integral-e['e2_m2'])>1e-8:raise ValueError('Independent P1 whole-square integral failed')
            expected.add((c['id'],e['filename']))
            for family in ('world','principal'):
                eligible=[a for a in c['candidates'] if (a['family']=='principal' if family=='principal' else a['family'].startswith('world-')) and a['patches']<=p['budget'] and a['binary_bytes']<=e['binary_bytes']]
                best=min(eligible,key=lambda a:(a['e2_m2'],a['binary_bytes'],a['id'])) if eligible else None
                if p[family]!=best:raise ValueError('Changed joint-ceiling selection')
                if best:
                    m,_=pool[best['id']]
                    if checked(out/best['filename'],best['sha256'],best['bytes'])!=packed(m) or checked(out/best['binary_filename'],best['binary_sha256'],best['binary_bytes'])!=binary(m):raise ValueError('Saved selection changed')
                    expected.add((c['id'],best['filename']))
        p2=c['p2_control'];m=make_control(q)
        if checked(out/p2['filename'],p2['sha256'],p2['bytes'])!=packed(m) or checked(out/p2['binary_filename'],p2['binary_sha256'],p2['binary_bytes'])!=control_binary(m):raise ValueError('P2 control altered')
        if p2['binary_bytes']!=336 or p2['controls']!=9 or p2['patches']!=2 or p2['e2_m2']>=1e-8 or control_metrics(m,q,5)['e2_m2']>=1e-8:raise ValueError('Incomplete higher-order control')
        expected.add((c['id'],p2['filename']));print(c['id']+': every candidate, P1 integral, joint selection and P2 control rechecked',flush=True)
    if len(audit['rows'])!=len(expected) or {(row['case_id'],row['filename']) for row in audit['rows']}!=expected:raise ValueError('Native audit omits a retained model')
    for row in audit['rows']:
        checked(folder/row['case_id']/row['filename'],row['sha256'],row['bytes']);checked(folder/row['case_id']/row['binary_filename'],row['binary_sha256'],row['binary_bytes'])
        if row['requested']!=4096 or row['hits']!=4096 or row['clip_corners_checked']!=4 or not row['outside_clip_rejected'] or row['independent_height_difference_m']>=1e-8 or row['independent_gradient_difference']>=1e-9:raise ValueError('Invalid native query verification')
    return r,raw,ar,scripts
def publish(folder):
    if DEST.exists() or SUMMARY.exists():raise FileExistsError('Cannot overwrite published evidence')
    r,raw,ar,scripts=verify(folder);DEST.mkdir(parents=True);(DEST/'results.json').write_bytes(raw);(DEST/'native-audit.json').write_bytes(ar);shutil.copyfile(folder/'parent-results.json',DEST/'parent-results.json');cases=[];rows=[]
    for c in r['cases']:
        out=DEST/c['id'];out.mkdir()
        for p in (folder/c['id']).iterdir():
            if p.suffix in ('.json','.bin'):shutil.copyfile(p,out/p.name)
        cases.append({k:v for k,v in c.items() if k!='candidates'})
        for p in c['pairs']:
            a=p['p1'];b=p['principal'];world=p['world'];rows.append({'angle_degrees':c['angle_degrees'],'budget_N':p['budget'],'p1_binary_bytes':a['binary_bytes'],'principal_binary_bytes':b['binary_bytes'] if b else '',
              'p1_e2_m2':a['e2_m2'],'principal_e2_m2':b['e2_m2'] if b else '', 'world_e2_m2':world['e2_m2'] if world else '', 'principal_e2_reduction_percent':100*(1-b['e2_m2']/a['e2_m2']) if b else '',
              'principal_binary_saving_percent':100*(1-b['binary_bytes']/a['binary_bytes']) if b else '', 'p2_control_binary_bytes':c['p2_control']['binary_bytes'],'p2_control_e2_m2':c['p2_control']['e2_m2']})
    s=io.StringIO(newline='');writer=csv.DictWriter(s,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows);(DEST/'pairs.csv').write_bytes(s.getvalue().encode());name='principal-direction-results.svg';plot(r,DEST/name)
    (DEST/'README.txt').write_text('Complete fixed seven-angle rotation comparison: 63 N/binary-budget pairs, 252 directional candidates, all retained native files and queries.\nPrincipal P2xP1 ruled surfaces compared with paper-style P1 vertex interpolation, NOT a more efficient P1 algorithm.\nAll overhanging Float64 control points and common clip metadata included. Same 100x100m square. P1 uses frozen L2 greedy selection / L1 edge decision and directed triangle-strip packing; no C0 closure added.\nHigher-order control: each global quadratic is represented exactly in real arithmetic by 2 P2 triangles / 9 shared nodes / complete 336-byte GPR3 file. No superiority to general P2 triangles claimed.\nNot real DTM, author-original execution, ArcGIS execution, GPU or timing measurement. Whole-domain integrals and guard in Float64, not interval proof.\n',encoding='utf8',newline='\n')
    scripts={**scripts,'data-pipeline/publish_principal_ruled.py':sha(Path(__file__).read_bytes().replace(b'\r\n',b'\n')),'data-pipeline/plot_principal_ruled.py':sha((ROOT/'data-pipeline/plot_principal_ruled.py').read_bytes().replace(b'\r\n',b'\n'))}
    impl=DEST/'implementations';impl.mkdir()
    for p in scripts:(impl/Path(p).name).write_bytes((ROOT/p).read_bytes().replace(b'\r\n',b'\n'))
    with zipfile.ZipFile(DEST/'principal-ruled-evidence.zip','x',compression=zipfile.ZIP_DEFLATED) as z:
        for p in sorted(DEST.rglob('*')):
            if p.is_file() and p.suffix!='.zip':
                info=zipfile.ZipInfo('principal-ruled-v1/'+p.relative_to(DEST).as_posix(),date_time=(2026,10,6,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,p.read_bytes(),compresslevel=9)
    b=(DEST/'principal-ruled-evidence.zip').read_bytes();summary={k:v for k,v in r.items() if k not in ('cases','scripts')};summary.update(cases=cases,scripts=scripts,report_sha256=sha(raw),native_audit_sha256=sha(ar),pairs_csv_sha256=sha((DEST/'pairs.csv').read_bytes()),figures={name:sha((DEST/name).read_bytes())},package={'filename':'principal-ruled-evidence.zip','bytes':len(b),'sha256':sha(b)})
    body=(json.dumps(summary,ensure_ascii=False,indent=2,allow_nan=False)+'\n').encode();SUMMARY.write_bytes(body);(DEST/'publication.json').write_bytes(body);print('Published seven angles, 63 pairs, full native audit and all seven P2 controls')

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('folder',type=Path);publish(p.parse_args().folder)
