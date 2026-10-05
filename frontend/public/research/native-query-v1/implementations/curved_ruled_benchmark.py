"""Additive P2 x P1 ruled-function / paper-style P1 comparison at file ceilings.

Three fixed strict-convex fields from the frozen paper experiment. Both methods
sample the same analytic field; changed approximation spaces are explicit.
No formal cities, source reports or existing evidence are modified.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
import time

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'backend'))
from app.services.terrain_triangles import pack_triangle_strips
import paper_metric_benchmark as paper

FORMAT = 'gugis-research-surface'
NODES, WEIGHTS = np.polynomial.legendre.leggauss(5)
NODES, WEIGHTS = (NODES+1)/2, WEIGHTS/2
U,V = np.meshgrid(NODES,NODES,indexing='ij')
W = WEIGHTS[:,None]*WEIGHTS[None,:]


def digest(b): return hashlib.sha256(b).hexdigest()
def packed(model): return json.dumps(model,separators=(',',':'),allow_nan=False).encode()
def value(field,points):
    p=np.asarray(points,dtype=float)
    return paper.quartic_value(p,field) if isinstance(field,dict) else 30+np.einsum('...i,ij,...j->...',p,field,p)


def curve_point(controls,u):
    p=np.asarray(controls,dtype=float);u=np.asarray(u)
    return (1-u)[...,None]**2*p[0]+2*(u*(1-u))[...,None]*p[1]+u[...,None]**2*p[2]


def patch_points(model,patch,u,v):
    a=curve_point([model['points'][i] for i in patch['left']],u)
    b=curve_point([model['points'][i] for i in patch['right']],u)
    return a*(1-np.asarray(v))[...,None]+b*np.asarray(v)[...,None]


def make_curve_grid(field,nx,ny,axis):
    if axis not in ('x','y') or nx<1 or ny<1 or nx*ny>4096:raise ValueError('Bounded tensor grid required')
    points=[];pool={};patches=[];samples=set()
    def point_id(p):
        key=tuple(float(v) for v in p)
        if key not in pool:pool[key]=len(points);points.append(list(key))
        return pool[key]
    for j in range(ny):
        for i in range(nx):
            x0,x1=-50+100*i/nx,-50+100*(i+1)/nx
            y0,y1=-50+100*j/ny,-50+100*(j+1)/ny
            boundaries=[]
            for fixed in ((y0,y1) if axis=='x' else (x0,x1)):
                xy=np.array([[x0,fixed],[(x0+x1)/2,fixed],[x1,fixed]] if axis=='x' else [[fixed,y0],[fixed,(y0+y1)/2],[fixed,y1]])
                z=value(field,xy);samples.update(map(tuple,xy))
                # Quadratic Bezier interpolates the three supplied heights.
                controls=np.column_stack((xy,[z[0],2*z[1]-(z[0]+z[2])/2,z[2]]))
                boundaries.append([point_id(p) for p in controls])
            patches.append({'kind':'quadratic-ruled','left':boundaries[0],'right':boundaries[1]})
    return {'format':FORMAT,'version':1,'coordinate_system':'LOCAL_METERS','points':points,'patches':patches},len(samples)


def curve_metrics(model,field):
    e2sq=0.;area=0.;bounds=[]
    # Tensor-degree <=4 residual; its square is <=8, exactly integrated by
    # five-node Gauss per axis, subject to float64 roundoff and saved controls.
    for patch in model['patches']:
        xyz=patch_points(model,patch,U,V);xy=xyz[...,:2]
        controls=np.array([model['points'][i] for i in patch['left']+patch['right']])
        delta=controls[:,:2].max(axis=0)-controls[:,:2].min(axis=0)
        local_area=float(np.prod(delta));error=xyz[...,2]-value(field,xy)
        e2sq+=float(np.sum(W*error**2))*local_area;area+=local_area
        # Convert residual polynomial to tensor Bernstein coefficients.
        # Coefficient hull bounds the function; this is a Float64 certificate,
        # not directed interval arithmetic. Both axes use degree four.
        t=np.linspace(0,1,5);a,b=np.meshgrid(t,t,indexing='ij')
        pts=patch_points(model,patch,a,b);g=pts[...,2]-value(field,pts[...,:2])
        vand=np.polynomial.polynomial.polyvander(t,4)
        power=np.linalg.solve(vand,np.linalg.solve(vand,g).T).T
        transform=np.array([[math.comb(i,k)/math.comb(4,k) if k<=i else 0 for k in range(5)] for i in range(5)])
        coefficients=transform@power@transform.T
        guard=1e-10*max(1.,float(np.max(np.abs(pts[...,2]))))
        bounds.append(float(np.max(np.abs(coefficients)))+guard)
    if not math.isclose(area,10000,abs_tol=1e-7):raise ValueError('Whole domain required')
    return {'e2_m2':math.sqrt(e2sq),'rms_m':math.sqrt(e2sq/area),'area_m2':area,
            'continuous_bound_m':max(bounds),'controls':len(model['points']),
            'native_triangles':0,'curved_ruled_patches':len(model['patches'])}


def triangle_model(triangles,field):
    pool={};points=[];faces=[]
    for triangle in triangles:
        face=[]
        for xy in triangle:
            key=tuple(xy)
            if key not in pool:pool[key]=len(points);points.append([*key,float(value(field,np.array(key)))])
            face.append(pool[key])
        faces.append(face)
    strips=pack_triangle_strips(faces,256)
    model={'format':FORMAT,'version':1,'coordinate_system':'LOCAL_METERS','points':points,
           'patches':[{'kind':'triangle-strip','indices':indices} for indices in strips]}
    return model


def curve_candidates(field,max_bytes):
    candidates=[];probes=0;started=time.perf_counter()
    for axis in ('x','y'):
        nx=ny=1
        while nx*ny<=4096:
            model,samples=make_curve_grid(field,nx,ny,axis);content=packed(model)
            if len(content)>max_bytes:break
            m=curve_metrics(model,field);probes+=1
            candidates.append({'axis':axis,'nx':nx,'ny':ny,'fit_samples':samples,'bytes':len(content),'model':model,**m})
            options=[]
            for xx,yy in ((nx*2,ny),(nx,ny*2)):
                if xx*yy>4096:continue
                mm,ss=make_curve_grid(field,xx,yy,axis);b=packed(mm);metrics=curve_metrics(mm,field);probes+=1
                # Same fixed rule in every field, no Hessian or case labels.
                benefit=(m['e2_m2']**2-metrics['e2_m2']**2)/max(1,len(b)-len(content))
                options.append((benefit,-len(b),xx,yy))
            if not options:break
            _,_,nx,ny=max(options)
    return candidates,{'candidate_evaluations':probes,'elapsed_seconds':time.perf_counter()-started,
                       'rule':'Two boundary axes; globally double x or y by full-domain squared-error reduction per additional serialized byte. Select minimum E2 candidate below each ceiling. All path candidates retained; trial refinements counted separately, not saved. Finite search, not optimality proof.'}


def build(output):
    if output.exists():raise FileExistsError('Fresh output required; published evidence is immutable')
    output.mkdir(parents=True)
    report={'schema':'gugis-curved-ruled-comparison-v1','generated_at':'2026-10-06',
            'paper':'https://arxiv.org/abs/1101.1452','domain_m':[-50,-50,50,50],
            'budgets':list(paper.BUDGETS),'parent_paper_report_sha256':digest((ROOT/'shared/paper-terrain-metrics.json').read_bytes()),
            'scripts':{name:digest((ROOT/name).read_text(encoding='utf8').replace('\r\n','\n').encode()) for name in
              ['data-pipeline/curved_ruled_benchmark.py','data-pipeline/paper_metric_benchmark.py','backend/app/services/terrain_triangles.py']},
            'scope':'Same field and full-domain E2, with complete serialized native-file ceilings. P2xP1 quadratic-boundary ruled functions versus paper-style P1 vertex interpolants; different approximation spaces. No theorem refutation, author original scores, ArcGIS execution, or city production-format change.',
            'cases':[]}
    parent=json.loads((ROOT/'shared/paper-terrain-metrics.json').read_bytes())
    for cid,label,field in paper.all_cases():
        case={'id':cid,'name':label,'q_matrix':None if isinstance(field,dict) else field.tolist(),
              'polynomial':field if isinstance(field,dict) else None,'baselines':[],'candidates':[],'pairs':[]}
        folder=output/cid;folder.mkdir();max_bytes=0
        for method in ('paper_l2_l1','greedy_euclidean','uniform_euclidean'):
            parent_method=next(m for c in parent['cases'] if c['id']==cid for m in c['methods'] if m['id']==method)
            for n in paper.BUDGETS:
                began=time.perf_counter();rows,_,mesh=paper.run(field,method,(n,));model=triangle_model(mesh,field);content=packed(model)
                for key in ('e2_m2','linf_m','rms_m','area_m2'):assert rows[0][key]==next(r for r in parent_method['rows'] if r['triangles']==n)[key]
                name=f'{method}-{n}.json';(folder/name).write_bytes(content);max_bytes=max(max_bytes,len(content))
                case['baselines'].append({'method':method,'budget_n':n,'filename':name,'sha256':digest(content),'bytes':len(content),
                    'controls':len(model['points']),'native_triangles':n,'e2_m2':rows[0]['e2_m2'],'rms_m':rows[0]['rms_m'],
                    'continuous_bound_m':rows[0]['linf_m'],'area_m2':rows[0]['area_m2'],'fit_seconds':time.perf_counter()-began})
        candidates,search=curve_candidates(field,max_bytes);case['search']=search
        for c in candidates:
            model=c.pop('model');content=packed(model);name=f"curve-{c['axis']}-{c['nx']}x{c['ny']}.json";(folder/name).write_bytes(content)
            case['candidates'].append(dict(c,filename=name,sha256=digest(content)))
        for baseline in case['baselines']:
            eligible=[c for c in case['candidates'] if c['bytes']<=baseline['bytes']]
            winner=min(eligible,key=lambda c:(c['e2_m2'],c['bytes'],c['filename'])) if eligible else None
            case['pairs'].append({'method':baseline['method'],'budget_n':baseline['budget_n'],'baseline':baseline['filename'],
                'candidate':winner['filename'] if winner else None,'e2_reduction_percent':100*(1-winner['e2_m2']/baseline['e2_m2']) if winner else None,
                'file_saving_percent':100*(1-winner['bytes']/baseline['bytes']) if winner else None})
        report['cases'].append(case)
        print(json.dumps({'case':cid,'curves':len(candidates),'paper_2048':next(p for p in case['pairs'] if p['method']=='paper_l2_l1' and p['budget_n']==2048)}),flush=True)
    content=(json.dumps(report,ensure_ascii=False,indent=2,allow_nan=False)+'\n').encode();(output/'results.json').write_bytes(content)
    print(json.dumps({'report_sha256':digest(content),'cases':len(report['cases'])}),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,required=True)
    build(parser.parse_args().output)
