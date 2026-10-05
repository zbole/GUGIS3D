"""Immutable release of order controls and exact ruled-structure examples."""
import argparse
import csv
import io
import json
from pathlib import Path
import shutil
import struct
import zipfile

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

from terrain_order_control import ROOT,PARENT,ARCHIVES,digest,packed,binary_bytes,polynomial_metrics,structure_source,multi_indices,value,faces

DEST=ROOT/'frontend/public/research/order-controls-v1'
SUMMARY=ROOT/'shared/terrain-order-control-v1.json'


def load(folder,name,h,size):
    path=(folder/name).resolve()
    if path.name!=name or not path.is_relative_to(folder.resolve()):raise ValueError('Unsafe evidence name')
    b=path.read_bytes()
    if len(b)!=size or digest(b)!=h:raise ValueError('Evidence bytes changed')
    return b


def curve_integral(model,source):
    # Nine-node independent tensor integration of actual saved boundary controls.
    t,w=np.polynomial.legendre.leggauss(9);t=(t+1)/2;w=w/2;u,v=np.meshgrid(t,t,indexing='ij');sq=0.;area=0.
    for p in model['patches']:
        a,b=[np.array([model['points'][i] for i in p[k]]) for k in ('left','right')]
        curve=lambda c:c[0]+2*u[...,None]*(c[1]-c[0])+u[...,None]**2*(c[0]-2*c[1]+c[2])
        xyz=curve(a)+v[...,None]*(curve(b)-curve(a));span=np.r_[a,b][:,:2].max(axis=0)-np.r_[a,b][:,:2].min(axis=0)
        aa=float(np.prod(span));error=xyz[...,2]-source(xyz[...,:2]);sq+=float(np.sum(error**2*w[:,None]*w[None,:]))*aa;area+=aa
    return {'e2_m2':float(np.sqrt(sq)),'area_m2':area}


def verify(folder):
    raw=(folder/'results.json').read_bytes();r=json.loads(raw);audit_raw=(folder/'native-audit.json').read_bytes();audit=json.loads(audit_raw)
    if r['schema']!='gugis-terrain-order-control-v1' or audit['schema']!='gugis-terrain-order-native-audit-v1':raise ValueError('Evidence schema changed')
    if digest(raw)!=audit['parent_report_sha256'] or digest(PARENT.read_bytes())!=r['parent_curved_publication_sha256']:raise ValueError('Parent evidence changed')
    for name,h in [('data-pipeline/terrain_order_control.py',r['source_sha256']),('frontend/scripts/audit-terrain-order-control.mjs',audit['auditor_sha256']),
                   ('frontend/src/compare/terrainOrderMath.ts',audit['kernel_sha256']),('frontend/src/compare/curvedRuledMath.ts',audit['curve_kernel_sha256'])]:
        if digest((ROOT/name).read_text(encoding='utf8').replace('\r\n','\n').encode())!=h:raise ValueError('Bound implementation changed')
    parent=json.loads(PARENT.read_bytes())
    for name,h in parent['scripts'].items():
        if digest((ROOT/name).read_text(encoding='utf8').replace('\r\n','\n').encode())!=h:raise ValueError('Frozen parent implementation changed')
    if len(r['cases'])!=3 or {c['id'] for c in r['cases']}!={c['id'] for c in parent['cases']}:raise ValueError('Incomplete fixed fields')
    if len(r['structure_fixtures'])!=2 or {c['id'] for c in r['structure_fixtures']}!={'extruded-quadratic','modulated-quadratic'}:raise ValueError('Incomplete structural examples')
    seen=set()
    for c in r['cases']+r['structure_fixtures']:
        source=(lambda xy:value(c['polynomial'] or np.asarray(c['q_matrix']),xy)) if 'q_matrix' in c else (lambda xy:structure_source(c['id'],xy))
        entries=c['p2_models']+c['ruled_references'] if 'p2_models' in c else [c['ruled'],c['triangles']]
        for e in entries:
            raw_model=load(folder/c['id'],e['filename'],e['sha256'],e['bytes']);model=json.loads(raw_model)
            binary=load(folder/c['id'],e['binary_filename'],e['binary_sha256'],e['binary_bytes'])
            if binary!=binary_bytes(model):raise ValueError('Numeric encoding changed geometry')
            result=polynomial_metrics(model,source,nodes=9) if model['patches'][0]['kind']=='lagrange-triangle' else curve_integral(model,source)
            if abs(result['area_m2']-10000)>1e-7 or abs(result['e2_m2']-e['e2_m2'])>1e-9*max(1,e['e2_m2']):raise ValueError('Saved function integral changed')
            if len(model['points'])!=e['controls']:raise ValueError('Node cost changed')
            rows=[a for a in audit['rows'] if (a['case'],a['filename'])==(c['id'],e['filename'])]
            if len(rows)!=1 or rows[0]['hits']!=4096 or rows[0]['requested']!=4096 or not rows[0]['binary_queries_identical'] or rows[0]['model_sha256']!=e['sha256'] or rows[0]['binary_sha256']!=e['binary_sha256']:raise ValueError('Native verification incomplete')
            seen.add((c['id'],e['filename']))
        if 'pairs' in c:
            original=next(a for a in parent['cases'] if a['id']==c['id'])
            if len(c['pairs'])!=9 or len(c['p2_models'])!=9 or len(c['ruled_references'])!=len(original['candidates']):raise ValueError('Incomplete control grid')
            if sorted(e['budget_n'] for e in c['p2_models'])!=parent['budgets']:raise ValueError('Control budgets changed')
            for e in c['p2_models']:
                old=next(a for a in original['baselines'] if a['method']=='paper_l2_l1' and a['budget_n']==e['budget_n'])
                b=(ARCHIVES/c['id']/old['filename']).read_bytes()
                if digest(b)!=old['sha256'] or e['mesh_parent_sha256']!=old['sha256']:raise ValueError('P1 mesh parent changed')
                model=json.loads((folder/c['id']/e['filename']).read_bytes())
                xyz=np.asarray(model['points']);tri=xyz[np.array([p['nodes'] for p in model['patches']])][:,[0,3,5],:2]
                if not np.array_equal(tri,faces(json.loads(b))):raise ValueError('P2 does not use exactly frozen P1 faces')
                if np.max(np.abs(xyz[:,2]-source(xyz[:,:2])))>1e-9:raise ValueError('P2 nodal source values changed')
            for e in c['ruled_references']:
                old=next(a for a in original['candidates'] if a['filename']==e['original_filename']);b=(ARCHIVES/c['id']/old['filename']).read_bytes()
                model=json.loads(b);model['version']=2
                if old['sha256']!=e['original_sha256'] or digest(b)!=old['sha256'] or packed(model)!=(folder/c['id']/e['filename']).read_bytes():raise ValueError('Frozen ruled model changed')
            for pair in c['pairs']:
                tri=next(a for a in c['p2_models'] if a['filename']==pair['p2_model']);candidates=[e for e in c['ruled_references'] if e['bytes']<=tri['bytes']]
                best=min(candidates,key=lambda e:(e['e2_m2'],e['bytes'])) if candidates else None
                if pair['ruled_model']!=(best['filename'] if best else None):raise ValueError('Wrong budget selection')
                difference=best['e2_m2']-tri['e2_m2'] if best else None
                verdict='numerical-tie' if best and abs(difference)<=1e-8 else 'ruled-lower' if best and difference<0 else 'p2-lower' if best else 'no-ruled-model'
                if difference!=pair['e2_difference_m2'] or verdict!=pair['e2_verdict']:raise ValueError('Incorrect order verdict')
        else:
            a,b=c['ruled'],c['triangles']
            if c['both_numerically_exact']!=(max(a['e2_m2'],b['e2_m2'])<c['numerical_e2_tolerance_m2']):raise ValueError('Incorrect exactness claim')
            for key,num in [('json_saving_percent',100*(1-a['bytes']/b['bytes'])),('binary_saving_percent',100*(1-a['binary_bytes']/b['binary_bytes']))]:
                if abs(c[key]-num)>1e-10:raise ValueError('Incorrect structural gain')
    if len(audit['rows'])!=len(seen):raise ValueError('Missing or extra native checks')
    return r,raw,audit,audit_raw


def publish(folder):
    if DEST.exists() or SUMMARY.exists():raise FileExistsError('Existing order control release is immutable')
    r,raw,audit,audit_raw=verify(folder);DEST.mkdir(parents=True)
    (DEST/'results.json').write_bytes(raw);(DEST/'native-audit.json').write_bytes(audit_raw)
    summary=dict(r,parent_report_sha256=digest(raw),native_audit_sha256=digest(audit_raw),publisher_sha256=digest(Path(__file__).read_text(encoding='utf8').replace('\r\n','\n').encode()),packages={},figures={})
    rows=[]
    for c in r['cases']+r['structure_fixtures']:
        out=DEST/c['id'];out.mkdir();entries=c['p2_models']+c['ruled_references'] if 'p2_models' in c else [c['ruled'],c['triangles']]
        for e in entries:
            for name in [e['filename'],e['binary_filename']]:shutil.copyfile(folder/c['id']/name,out/name)
        (out/'case-record.json').write_text(json.dumps({'schema':'gugis-terrain-order-case-v1','parent_report_sha256':digest(raw),'case':c},ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
        note='Order control, not a new optimized P2 greedy reproduction. Original strict-convex fields versus frozen P2xP1 ruled candidates.\nTwo separate purpose-built ruled-structure fixtures have E2 below 1e-8 m2; not independent real DEM or theorem proofs.\nJSON and binary are complete uncompressed files, not measured RAM. GOC2 LE: 4-byte magic, u32 version=2, u32 point count, u32 patch count; Float64 XYZ; each patch u32 kind, u32 degree, u32 node count, Uint32 indices.\nKind 1: two quadratic boundary curves, left then right (6 points). Kind 2: Lagrange triangle, degree 2/3; node orders (a,b,p-a-b), a decreasing then b decreasing, total degree p.\n'
        (out/'README.txt').write_text(note,encoding='utf8',newline='\n')
        name=c['id']+'.zip'
        with zipfile.ZipFile(DEST/name,'x',compression=zipfile.ZIP_DEFLATED) as z:
            for p in sorted(out.iterdir()):
                info=zipfile.ZipInfo(c['id']+'/'+p.name,date_time=(2026,10,6,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED
                z.writestr(info,p.read_bytes(),compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
        b=(DEST/name).read_bytes();summary['packages'][c['id']]={'filename':name,'bytes':len(b),'sha256':digest(b)}
        if 'pairs' in c:
            for pair in c['pairs']:
                p=next(e for e in c['p2_models'] if e['filename']==pair['p2_model']);a=next(e for e in c['ruled_references'] if e['filename']==pair['ruled_model'])
                rows.append({'case':c['id'],'baseline_n':pair['budget_n'],'p2_json_bytes':p['bytes'],'ruled_json_bytes':a['bytes'],'p2_e2_m2':p['e2_m2'],'ruled_e2_m2':a['e2_m2'],'verdict':pair['e2_verdict']})
    s=io.StringIO(newline='');w=csv.DictWriter(s,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
    (DEST/'order-pairs.csv').write_text(s.getvalue(),encoding='utf8',newline='');summary['order_pairs_csv_sha256']=digest((DEST/'order-pairs.csv').read_bytes())
    fig,axes=plt.subplots(1,2,figsize=(10,4.2),layout='constrained')
    for ax,c in zip(axes,r['structure_fixtures']):
        vals=[c['ruled']['binary_bytes'],c['triangles']['binary_bytes']]
        bars=ax.bar(['GUGIS P2xP1',f"P{c['triangle_degree']} triangles"],vals,color=['#128979','#a3b0bd'],width=.55)
        ax.bar_label(bars,labels=[str(v)+' B' for v in vals],padding=5)
        ax.set(ylim=(0,max(vals)*1.3),ylabel='Entire GOC2 envelope / B',title=c['id']+'\nBoth E2 < 1e-8 m²')
        ax.text(.5,.92,f"GUGIS file smaller by {c['binary_saving_percent']:.1f}%",transform=ax.transAxes,ha='center',fontsize=10,color='#147969')
    for ext in ['png','svg']:
        name='structure-cost.'+ext;fig.savefig(DEST/name,dpi=170,metadata={'Date':None} if ext=='svg' else None);summary['figures'][name]=digest((DEST/name).read_bytes())
    plt.close(fig)
    fig,axes=plt.subplots(1,3,figsize=(12,4),layout='constrained')
    for ax,c in zip(axes,r['cases']):
        ax.loglog([e['bytes']/1000 for e in c['p2_models']],[max(1e-8,e['e2_m2']) for e in c['p2_models']],'o-',label='P2 on frozen paper P1 mesh',color='#aa792f')
        ax.scatter([e['bytes']/1000 for e in c['ruled_references']],[max(1e-8,e['e2_m2']) for e in c['ruled_references']],label='Retained P2xP1 ruled files',color='#168576',s=13)
        ax.set(title=c['id'],xlabel='Complete native JSON / kB',ylabel='E2 / m²; values <= 1e-8 at floor');ax.grid(alpha=.2);ax.legend(fontsize=7)
    for ext in ['png','svg']:
        name='order-sensitivity.'+ext;fig.savefig(DEST/name,dpi=170,metadata={'Date':None} if ext=='svg' else None);summary['figures'][name]=digest((DEST/name).read_bytes())
    plt.close(fig)
    b=(json.dumps(summary,ensure_ascii=False,indent=2,allow_nan=False)+'\n').encode();SUMMARY.write_bytes(b);(DEST/'publication.json').write_bytes(b)
    print('Published 86 native JSON/binary pairs, 27 order controls, 2 structural examples and complete evidence.')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('folder',type=Path);publish(parser.parse_args().folder)
