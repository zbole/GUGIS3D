"""Publish checked additive function evidence; refuse to overwrite any release."""
import argparse
import csv
import io
import json
from pathlib import Path
import shutil
import zipfile

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

from curved_ruled_benchmark import ROOT,packed,digest,curve_metrics,value,patch_points

DEST=ROOT/'frontend/public/research/curved-ruled-v1'
SUMMARY=ROOT/'shared/curved-ruled-comparison-v1.json'


def triangle_integral(model,field):
    faces=[]
    for p in model['patches']:
        if p['kind']!='triangle-strip':raise ValueError('Expected P1 native strips')
        ids=p['indices']
        for i in range(len(ids)-2):
            a,b,c=ids[i:i+3];faces.append((a,c,b) if i%2 else (a,b,c))
    xyz=np.asarray(model['points'])[np.asarray(faces)];tri=xyz[:,:,:2]
    nodes,w=np.polynomial.legendre.leggauss(7);nodes=(nodes+1)/2;w=w/2
    u,v=np.meshgrid(nodes,nodes,indexing='ij');wu,wv=np.meshgrid(w,w,indexing='ij')
    bary=np.column_stack(((1-u-(1-u)*v).ravel(),u.ravel(),((1-u)*v).ravel()))
    sites=np.einsum('qi,tij->tqj',bary,xyz)
    residual=sites[:,:,2]-value(field,sites[:,:,:2])
    b,c=tri[:,1]-tri[:,0],tri[:,2]-tri[:,0];det=b[:,0]*c[:,1]-b[:,1]*c[:,0]
    if np.any(det<=0):raise ValueError('Non-upward triangle')
    sq=float(np.sum(residual**2*((wu*wv*(1-u)).ravel()[None,:])*det[:,None]))
    return {'area_m2':float(np.sum(det)/2),'e2_m2':float(np.sqrt(sq)),'native_triangles':len(faces)}


def checked(folder,name,digest_value,size=None):
    path=(folder/name).resolve()
    if not path.is_relative_to(folder.resolve()) or path.name!=name:raise ValueError('Unsafe evidence filename')
    b=path.read_bytes()
    if digest(b)!=digest_value or size is not None and len(b)!=size:raise ValueError('Changed evidence bytes')
    return b


def verify(folder):
    raw=(folder/'results.json').read_bytes();r=json.loads(raw)
    audit_raw=(folder/'native-audit.json').read_bytes();audit=json.loads(audit_raw)
    if r['schema']!='gugis-curved-ruled-comparison-v1' or audit['schema']!='gugis-curved-ruled-native-audit-v1':raise ValueError('Unknown evidence version')
    if audit['parent_report_sha256']!=digest(raw):raise ValueError('Audit parent changed')
    paths={**r['scripts'],'frontend/scripts/audit-curved-ruled-benchmark.mjs':audit['auditor_sha256'],
           'frontend/src/compare/curvedRuledMath.ts':audit['kernel_sha256']}
    for path,h in paths.items():
        if digest((ROOT/path).read_text(encoding='utf8').replace('\r\n','\n').encode())!=h:raise ValueError('Bound implementation changed')
    if digest((ROOT/'shared/paper-terrain-metrics.json').read_bytes())!=r['parent_paper_report_sha256']:raise ValueError('Paper baseline changed')
    if {c['id'] for c in r['cases']}!={'isotropic','anisotropic','variable_curvature'} or len(r['cases'])!=3:raise ValueError('Incomplete fixed fields')
    seen=set()
    for c in r['cases']:
        field=c['polynomial'] or np.asarray(c['q_matrix'])
        if len(c['baselines'])!=27 or len(c['pairs'])!=27:raise ValueError('Complete grid required')
        for e in c['baselines']+c['candidates']:
            b=checked(folder/c['id'],e['filename'],e['sha256'],e['bytes']);model=json.loads(b)
            result=curve_metrics(model,field) if 'axis' in e else triangle_integral(model,field)
            if abs(result['e2_m2']-e['e2_m2'])>1e-9*max(1.,e['e2_m2']) or abs(result['area_m2']-10000)>1e-7:raise ValueError('Saved native integral mismatch')
            if len(model['points'])!=e['controls']:raise ValueError('Control cost changed')
            rows=[a for a in audit['rows'] if (a['case'],a['filename'])==(c['id'],e['filename'])]
            if len(rows)!=1 or rows[0]['hits']!=4096 or rows[0]['requested']!=4096 or rows[0]['model_sha256']!=e['sha256']:raise ValueError('Native audit coverage or binding changed')
            seen.add((c['id'],e['filename']))
        for p in c['pairs']:
            baseline=next(b for b in c['baselines'] if b['filename']==p['baseline'])
            eligible=[e for e in c['candidates'] if e['bytes']<=baseline['bytes']]
            winner=min(eligible,key=lambda e:(e['e2_m2'],e['bytes'],e['filename'])) if eligible else None
            if p['candidate']!=(winner['filename'] if winner else None):raise ValueError('Wrong budgeted candidate')
            if winner:
                for key,num in [('e2_reduction_percent',100*(1-winner['e2_m2']/baseline['e2_m2'])),('file_saving_percent',100*(1-winner['bytes']/baseline['bytes']))]:
                    if abs(p[key]-num)>1e-10:raise ValueError('Changed advantage calculation')
    if len(audit['rows'])!=len(seen):raise ValueError('Extra or missing native rows')
    return r,raw,audit,audit_raw


def publish(folder):
    if DEST.exists() or SUMMARY.exists():raise FileExistsError('Immutable evidence already exists')
    r,raw,audit,audit_raw=verify(folder);DEST.mkdir(parents=True)
    (DEST/'results.json').write_bytes(raw);(DEST/'native-audit.json').write_bytes(audit_raw)
    summary=dict(r,parent_report_sha256=digest(raw),native_audit_sha256=digest(audit_raw),
                 publisher_sha256=digest(Path(__file__).read_text(encoding='utf8').replace('\r\n','\n').encode()),figures={},packages={})
    flat=[]
    for c in r['cases']:
        out=DEST/c['id'];out.mkdir()
        for e in c['baselines']+c['candidates']:shutil.copyfile(folder/c['id']/e['filename'],out/e['filename'])
        note='Same analytic field; native P2xP1 curved ruled functions versus paper-style P1 vertex interpolation.\nDifferent approximation spaces; this is not a refutation of the paper optimality theorem.\nFull serialized native JSON ceilings, not GPU memory. Both use source-aware error evaluation.\nCurved tensor grid is C0 continuous; P1 paper baseline retains nonconforming bisection.\nNo author original scores, independent real terrain, ArcGIS software execution, or production city-format change.\n'
        (out/'README.txt').write_text(note,encoding='utf8',newline='\n')
        name=c['id']+'.zip'
        with zipfile.ZipFile(DEST/name,'x',compression=zipfile.ZIP_DEFLATED) as z:
            for p in sorted(out.iterdir()):
                info=zipfile.ZipInfo(c['id']+'/'+p.name,date_time=(2026,10,6,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED
                z.writestr(info,p.read_bytes(),compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
        b=(DEST/name).read_bytes();summary['packages'][c['id']]={'filename':name,'bytes':len(b),'sha256':digest(b)}
        fig,ax=plt.subplots(figsize=(8,4.6),layout='constrained')
        for method,label,color in [('paper_l2_l1','Paper-style P1 / L2 selection, L1 edge','#bd7626'),('greedy_euclidean','P1 / L2 selection, Euclidean edge','#71839a'),('uniform_euclidean','P1 / area selection, Euclidean edge','#93954c')]:
            entries=[e for e in c['baselines'] if e['method']==method]
            ax.loglog([e['bytes']/1000 for e in entries],[e['e2_m2'] for e in entries],'o-',color=color,markersize=4,label=label)
        curves=sorted(c['candidates'],key=lambda e:e['bytes']);ax.scatter([e['bytes']/1000 for e in curves],[e['e2_m2'] for e in curves],color='#8bc4b1',s=18,label='All retained P2xP1 ruled candidates')
        pairs=[p for p in c['pairs'] if p['method']=='paper_l2_l1' and p['candidate']]
        bases={e['filename']:e for e in c['baselines']};candidates={e['filename']:e for e in c['candidates']}
        ax.loglog([bases[p['baseline']]['bytes']/1000 for p in pairs],[candidates[p['candidate']]['e2_m2'] for p in pairs],'s-',color='#087f79',label='GUGIS / best under each paper-file ceiling')
        ax.set(xlabel='Native file or ceiling / kB (uncompressed)',ylabel='Full-domain E2 / m²',title=c['id']+' · 100 × 100 m · different approximation spaces')
        ax.grid(alpha=.2);ax.legend(fontsize=8)
        for ext in ('png','svg'):
            fn=c['id']+'-cost-error.'+ext;fig.savefig(DEST/fn,dpi=170,metadata={'Date':None} if ext=='svg' else None);summary['figures'][fn]=digest((DEST/fn).read_bytes())
        plt.close(fig)
        for p in c['pairs']:flat.append({'case':c['id'],**p})
    text=io.StringIO(newline='');writer=csv.DictWriter(text,fieldnames=list(flat[0]));writer.writeheader();writer.writerows(flat)
    (DEST/'pairs.csv').write_text(text.getvalue(),encoding='utf8',newline='');summary['pairs_csv_sha256']=digest((DEST/'pairs.csv').read_bytes())
    b=(json.dumps(summary,ensure_ascii=False,indent=2,allow_nan=False)+'\n').encode();SUMMARY.write_bytes(b);(DEST/'publication.json').write_bytes(b)
    print('Published 3 fixed fields, 81 baseline files, every retained function candidate and all positive/negative comparisons.')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('folder',type=Path);publish(parser.parse_args().folder)
