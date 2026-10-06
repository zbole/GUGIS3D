"""Add an explicit same-codec P2 triangle control to the fixed rotation study.

Does not replace or rerun the parent experiment. Copies its retained native
files byte-for-byte and binds the complete parent report and source hashes.
"""
import argparse
import json
from pathlib import Path
import shutil
import struct
import numpy as np
from principal_ruled_benchmark import ROOT,sha,model,packed,source_value

def make_control(q):
    points=[];pool={};patches=[]
    for triangle in (np.array([[-50.,-50.],[50.,-50.],[50.,50.]]),np.array([[-50.,-50.],[50.,50.],[-50.,50.]])):
        nodes=[]
        for a in range(2,-1,-1):
            for b in range(2-a,-1,-1):
                c=2-a-b;xy=(a*triangle[0]+b*triangle[1]+c*triangle[2])/2;key=tuple(xy)
                if key not in pool:pool[key]=len(points);points.append([*map(float,xy),float(source_value(xy,q))])
                nodes.append(pool[key])
        patches.append({'kind':'lagrange-triangle','degree':2,'indices':nodes})
    return model(points,patches)
def control_binary(m):
    out=bytearray(struct.pack('<4sHHII4d',b'GPR3',3,1,len(m['points']),len(m['patches']),*m['clip_bounds']))
    for p in m['points']:out.extend(struct.pack('<3d',*p))
    for p in m['patches']:
        if p['kind']!='lagrange-triangle' or p['degree']!=2 or len(p['indices'])!=6:raise ValueError('P2 control required')
        out.extend(struct.pack('<BBHII6I',3,2,0,6,0,*p['indices']))
    return bytes(out)
def control_metrics(m,q,nodes=3):
    t,w=np.polynomial.legendre.leggauss(nodes);t=(t+1)/2;w=w/2;u,v=np.meshgrid(t,t,indexing='ij');wu,wv=np.meshgrid(w,w,indexing='ij');b=u.ravel();c=((1-u)*v).ravel();a=1-b-c
    basis=np.column_stack((a*(2*a-1),4*a*b,4*a*c,b*(2*b-1),4*b*c,c*(2*c-1)));weights=(wu*wv*(1-u)).ravel();total=0.;bound=0.;area=0.
    for p in m['patches']:
        pts=np.array([m['points'][i] for i in p['indices']]);pa,pb,pc=pts[[0,3,5],:2];e=pb-pa;d=pc-pa;det=abs(float(np.linalg.det(np.column_stack((e,d)))))
        xy=a[:,None]*pa+b[:,None]*pb+c[:,None]*pc;residual=basis@pts[:,2]-source_value(xy,q);total+=float(np.dot(weights,residual*residual))*det;area+=det/2
        z,ab,ac,bz,bc,cz=pts[:,2];coeff=np.array([z,-3*z+4*ab-bz,-3*z+4*ac-cz,2*z-4*ab+2*bz,4*z-4*ab-4*ac+4*bc,2*z-4*ac+2*cz]);source=np.array([source_value(pa,q),2*pa@q@e,2*pa@q@d,e@q@e,2*e@q@d,d@q@d]);bound=max(bound,float(np.abs(coeff-source).sum()))
    guard=1e-9+max(abs(p[2]) for p in m['points'])*1e-12;e2=float(np.sqrt(total))
    return {'e2_m2':e2,'rms_integral_m':e2/100,'integrated_area_m2':area,'coefficient_residual_bound_m':bound,'continuous_bound_m':bound+guard,'float64_guard_m':guard}
def build(parent,folder):
    if folder.exists():raise FileExistsError('Fresh private output required')
    raw=(parent/'results.json').read_bytes();r=json.loads(raw)
    if r['schema']!='gugis-principal-ruled-v1':raise ValueError('Fixed parent study required')
    for p,h in r['scripts'].items():
        if sha((ROOT/p).read_bytes().replace(b'\r\n',b'\n'))!=h:raise ValueError('Parent implementation changed')
    folder.mkdir(parents=True);(folder/'parent-results.json').write_bytes(raw);r['schema']='gugis-principal-ruled-order-control-v1';r['parent_report_sha256']=sha(raw);r['control_script_sha256']=sha(Path(__file__).read_bytes().replace(b'\r\n',b'\n'))
    r['control']='Every fixed field also has a two-face P2 Lagrange model: nine shared nodes, complete same GPR3 codec with clip rectangle. It represents the global quadratic exactly in real arithmetic; full-domain E2 and coefficient-residual bound are evaluated in Float64. No advantage over general P2 triangles is claimed.'
    for c in r['cases']:
        out=folder/c['id'];out.mkdir()
        for p in (parent/c['id']).iterdir():
            if p.suffix in ('.json','.bin'):shutil.copyfile(p,out/p.name)
        q=np.array(c['q_matrix']);m=make_control(q);jb=packed(m);bb=control_binary(m);e={'filename':'p2-exact-control.json','bytes':len(jb),'sha256':sha(jb),'binary_filename':'p2-exact-control.bin','binary_bytes':len(bb),'binary_sha256':sha(bb),'controls':len(m['points']),'patches':len(m['patches']),**control_metrics(m,q)}
        if e['controls']!=9 or e['patches']!=2 or e['binary_bytes']!=336 or e['e2_m2']>=1e-8:raise ValueError('Invalid P2 control')
        (out/e['filename']).write_bytes(jb);(out/e['binary_filename']).write_bytes(bb);c['p2_control']=e
    (folder/'results.json').write_text(json.dumps(r,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf8',newline='\n');print('Added all seven exact-quadratic P2 controls; parent native models retained byte-for-byte')

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('parent',type=Path);p.add_argument('output',type=Path);a=p.parse_args();build(a.parent,a.output)
