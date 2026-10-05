"""Additive order / structure controls; never rewrite the frozen P1 evidence.

P2 Lagrange interpolation on the exact frozen P1 mesh isolates polynomial order,
but is not a newly optimized P2 greedy algorithm. Two separate ruled-structure
fixtures compare exact function spaces with P2 and total-degree P3 triangles.
"""
import argparse
from fractions import Fraction
import json
import math
from pathlib import Path
import struct
import sys

import numpy as np

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'data-pipeline'))
from curved_ruled_benchmark import digest,packed,value,curve_metrics

PARENT=ROOT/'shared/curved-ruled-comparison-v1.json'
ARCHIVES=ROOT/'frontend/public/research/curved-ruled-v1'
INITIAL=(np.array([[-50.,-50.],[50.,-50.],[50.,50.]]),np.array([[-50.,-50.],[50.,50.],[-50.,50.]]))


def multi_indices(degree):
    if degree not in (2,3):raise ValueError('Only bounded P2/P3 controls')
    return [(a,b,degree-a-b) for a in range(degree,-1,-1) for b in range(degree-a,-1,-1)]


def lagrange_weights(bary,degree):
    bary=np.asarray(bary,dtype=float);values=[]
    for alpha in multi_indices(degree):
        result=np.ones(bary.shape[:-1])
        for axis,n in enumerate(alpha):
            for j in range(n):result*=((degree*bary[...,axis]-j)/(n-j))
        values.append(result)
    return np.stack(values,axis=-1)


def faces(model):
    out=[]
    for p in model['patches']:
        if p['kind']!='triangle-strip':raise ValueError('Frozen P1 mesh required')
        for i in range(len(p['indices'])-2):
            a,b,c=p['indices'][i:i+3];out.append((a,c,b) if i%2 else (a,b,c))
    return np.asarray(model['points'])[np.asarray(out),:2]


def polynomial_model(triangles,source,degree):
    points=[];pool={};patches=[]
    for triangle in triangles:
        ids=[]
        for alpha in multi_indices(degree):
            # Canonical rational construction shares thirds across differently
            # oriented faces before one conversion to IEEE-754 Float64.
            xy=tuple(float(sum(Fraction(float(triangle[i,k]))*alpha[i] for i in range(3))/degree) for k in range(2))
            if xy not in pool:pool[xy]=len(points);points.append([*xy,float(source(np.asarray(xy)))])
            ids.append(pool[xy])
        patches.append({'kind':'lagrange-triangle','degree':degree,'nodes':ids})
    return {'format':'gugis-research-surface','version':2,'coordinate_system':'LOCAL_METERS','points':points,'patches':patches}


def ruled_fixture(source):
    points=[]
    for y in (-50.,50.):
        z=source(np.array([[-50.,y],[0.,y],[50.,y]]))
        points.extend([[-50.,y,float(z[0])],[0.,y,float(2*z[1]-(z[0]+z[2])/2)],[50.,y,float(z[2])]])
    return {'format':'gugis-research-surface','version':2,'coordinate_system':'LOCAL_METERS','points':points,
            'patches':[{'kind':'quadratic-ruled','left':[0,1,2],'right':[3,4,5]}]}


def structure_source(kind,xy):
    xy=np.asarray(xy);x,y=xy[...,0],xy[...,1]
    if kind=='extruded-quadratic':return 30+.002*x*x+.03*y
    if kind=='modulated-quadratic':return 30+.00002*x*x*(y+60)+.01*y
    raise ValueError('Unknown structure fixture')


def polynomial_metrics(model,source,nodes=7):
    p=model['patches'];degree=p[0]['degree'];indices=multi_indices(degree)
    if any(e['degree']!=degree or len(e['nodes'])!=len(indices) for e in p):raise ValueError('Homogeneous order control required')
    xyz=np.asarray(model['points'])[np.asarray([e['nodes'] for e in p])]
    vertex_ids=[indices.index((degree,0,0)),indices.index((0,degree,0)),indices.index((0,0,degree))]
    tri=xyz[:,vertex_ids,:2]
    b,c=tri[:,1]-tri[:,0],tri[:,2]-tri[:,0];det=b[:,0]*c[:,1]-b[:,1]*c[:,0]
    if np.any(det<=0):raise ValueError('Upward triangle required')
    t,w=np.polynomial.legendre.leggauss(nodes);t=(t+1)/2;w=w/2
    u,v=np.meshgrid(t,t,indexing='ij');weights=(w[:,None]*w[None,:]*(1-u)).ravel()
    bary=np.stack((1-u-(1-u)*v,u,(1-u)*v),axis=-1).reshape(-1,3)
    xy=np.einsum('qi,tij->tqj',bary,tri)
    z=np.einsum('qn,tn->tq',lagrange_weights(bary,degree),xyz[:,:,2])
    residual=z-source(xy);square=float(np.sum(residual**2*weights[None,:]*det[:,None]))
    area=float(np.sum(det)/2)
    if abs(area-10000)>1e-7:raise ValueError('Incomplete domain')
    return {'e2_m2':math.sqrt(square),'rms_m':math.sqrt(square/area),'area_m2':area,
            'controls':len(model['points']),'triangles':len(p),'degree':degree}


def binary_bytes(model):
    """Full defined GOC2 envelope, not an estimated RAM footprint.

    LE: magic[4],version/u32,points/u32,patches/u32; Float64 XYZ;
    each patch kind/u32,degree/u32,node_count/u32,Uint32 node indices.
    kind 1 = P2xP1 (left then right), kind 2 = Lagrange triangle.
    """
    out=bytearray(struct.pack('<4sIII',b'GOC2',2,len(model['points']),len(model['patches'])))
    for point in model['points']:out.extend(struct.pack('<3d',*point))
    for p in model['patches']:
        if p['kind']=='quadratic-ruled':kind,degree,ids=1,2,p['left']+p['right']
        elif p['kind']=='lagrange-triangle':kind,degree,ids=2,p['degree'],p['nodes']
        else:raise ValueError('Unsupported binary primitive')
        out.extend(struct.pack('<III',kind,degree,len(ids)));out.extend(struct.pack('<'+'I'*len(ids),*ids))
    return bytes(out)


def write_model(folder,name,model,metrics):
    raw=packed(model);binary=binary_bytes(model);(folder/(name+'.json')).write_bytes(raw);(folder/(name+'.bin')).write_bytes(binary)
    return dict(metrics,filename=name+'.json',sha256=digest(raw),bytes=len(raw),binary_filename=name+'.bin',binary_sha256=digest(binary),binary_bytes=len(binary))


def build(output):
    if output.exists():raise FileExistsError('Fresh output directory required')
    output.mkdir(parents=True)
    parent_raw=PARENT.read_bytes();parent=json.loads(parent_raw)
    report={'schema':'gugis-terrain-order-control-v1','generated_at':'2026-10-06','paper':parent['paper'],
            'parent_curved_publication_sha256':digest(parent_raw),'binary_protocol':'GOC2, LE version2, Float64 XYZ, Uint32 patch headers and indices; entire uncompressed envelope measured.',
            'source_sha256':digest(Path(__file__).read_text(encoding='utf8').replace('\r\n','\n').encode()),
            'scope':'P2 Lagrange on exactly the frozen P1 mesh, not optimized P2 greedy. Same analytic fields, full-domain E2. Separate non-strict-convex structure fixtures show basis-structure cost at numerical zero; no theorem refutation, DEM accuracy or ArcGIS run.',
            'cases':[],'structure_fixtures':[]}
    for c in parent['cases']:
        folder=output/c['id'];folder.mkdir();source=lambda xy: value(c['polynomial'] or np.asarray(c['q_matrix']),xy)
        item={'id':c['id'],'name':c['name'],'q_matrix':c['q_matrix'],'polynomial':c['polynomial'],'p2_models':[],
              'ruled_references':[],'pairs':[]}
        for e in c['candidates']:
            original=(ARCHIVES/c['id']/e['filename']).read_bytes();assert digest(original)==e['sha256'] and len(original)==e['bytes']
            model=json.loads(original);model['version']=2
            item['ruled_references'].append(dict(write_model(folder,'ruled-'+e['filename'][:-5],model,{k:e[k] for k in ['e2_m2','rms_m','area_m2','controls']}),
                                                  original_sha256=e['sha256'],original_filename=e['filename'],patches=len(model['patches'])))
        for baseline in c['baselines']:
            if baseline['method']!='paper_l2_l1':continue
            raw=(ARCHIVES/c['id']/baseline['filename']).read_bytes();assert digest(raw)==baseline['sha256']
            model=polynomial_model(faces(json.loads(raw)),source,2)
            entry=write_model(folder,f"p2-on-paper-mesh-{baseline['budget_n']}",model,polynomial_metrics(model,source))
            entry.update(budget_n=baseline['budget_n'],mesh_parent_sha256=baseline['sha256']);item['p2_models'].append(entry)
            eligible=[m for m in item['ruled_references'] if m['bytes']<=entry['bytes']]
            best=min(eligible,key=lambda e:(e['e2_m2'],e['bytes'])) if eligible else None
            item['pairs'].append({'budget_n':baseline['budget_n'],'p2_model':entry['filename'],'ruled_model':best['filename'] if best else None,
                                  'e2_difference_m2':best['e2_m2']-entry['e2_m2'] if best else None,
                                  'e2_verdict':'numerical-tie' if best and abs(best['e2_m2']-entry['e2_m2'])<=1e-8 else 'ruled-lower' if best and best['e2_m2']<entry['e2_m2'] else 'p2-lower' if best else 'no-ruled-model'})
        report['cases'].append(item)
        print(json.dumps({'case':c['id'],'p2_n2048':item['p2_models'][-1]['e2_m2'],'ruled_n2048_verdict':item['pairs'][-1]['e2_verdict']}),flush=True)
    for cid,name,degree in [('extruded-quadratic','二次轮廓沿直线延展',2),('modulated-quadratic','二次轮廓随母线线性变化',3)]:
        folder=output/cid;folder.mkdir();source=lambda xy:structure_source(cid,xy)
        ruled=ruled_fixture(source);triangle=polynomial_model(INITIAL,source,degree)
        # Use independent tensor Gauss for the single straight-axis ruled patch.
        t,w=np.polynomial.legendre.leggauss(9);t=(t+1)/2;w=w/2;u,v=np.meshgrid(t,t,indexing='ij')
        aa,bb=np.asarray(ruled['points'][:3]),np.asarray(ruled['points'][3:])
        bez=lambda a:(1-u)[...,None]**2*a[0]+2*(u*(1-u))[...,None]*a[1]+u[...,None]**2*a[2]
        xyz=bez(aa)*(1-v)[...,None]+bez(bb)*v[...,None];error=xyz[...,2]-source(xyz[...,:2])
        e2=float(np.sqrt(np.sum(error**2*w[:,None]*w[None,:])*10000))
        a=write_model(folder,'ruled',ruled,dict(e2_m2=e2,rms_m=e2/100,controls=len(ruled['points']),patches=1,area_m2=10000))
        b=write_model(folder,f'p{degree}-triangles',triangle,polynomial_metrics(triangle,source))
        report['structure_fixtures'].append({'id':cid,'name':name,'triangle_degree':degree,'scope':'Purpose-built ruled structure, not one of the strict-convex paper fixtures.',
            'ruled':a,'triangles':b,'numerical_e2_tolerance_m2':1e-8,'both_numerically_exact':a['e2_m2']<1e-8 and b['e2_m2']<1e-8,
            'json_saving_percent':100*(1-a['bytes']/b['bytes']),'binary_saving_percent':100*(1-a['binary_bytes']/b['binary_bytes'])})
        print(json.dumps(report['structure_fixtures'][-1],ensure_ascii=False),flush=True)
    (output/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf8',newline='\n')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,required=True)
    build(parser.parse_args().output)
