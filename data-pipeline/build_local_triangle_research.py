"""A stronger conforming local-triangle baseline against the frozen hybrid set.

Only authored analytic functions have triangle-wide error bounds in this run.
Metadata is made identical in each saved pair; algorithm provenance remains in
the receipt. No overwrite of the earlier research archives or formal cities.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys
import time
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))
from app.services.terrain_triangles import local_triangles
from app.environment_models import Terrain
from build_hybrid_research import cases, quadratic_triangle_error


def triangle_certificate(case_id,height):
    hessians={'steep-plane':[[0,0],[0,0]],'bilinear-saddle':[[0,.004],[.004,0]],
              'convex-bowl':[[.004,0],[0,.006]]}
    if case_id in hessians:
        return lambda p:quadratic_triangle_error(p,hessians[case_id])
    if case_id=='sharp-ridge':
        def bound(p):
            controls=height(p[:,0],p[:,1])
            inverse=np.linalg.inv(np.column_stack((p[1]-p[0],p[2]-p[0])))
            sites=[*p]
            for a,b in zip(p,np.roll(p,-1,axis=0)):
                if a[1]*b[1]<0:sites.append(a+(b-a)*(-a[1])/(b[1]-a[1]))
            sites=np.asarray(sites);uv=(sites-p[0])@inverse.T
            interpolated=controls[0]+uv[:,0]*(controls[1]-controls[0])+uv[:,1]*(controls[2]-controls[0])
            return float(np.max(np.abs(height(sites[:,0],sites[:,1])-interpolated)))
        return bound
    def bound(p):
        if case_id=='linear-flow':xx,yy,xy=0,8/35**2,.003
        elif case_id=='rotating-direction':
            max_x,max_y=np.max(np.abs(p),axis=0)
            xx=1e-7*(12*max_x**2+4*max_y**2)
            yy=1e-7*(12*max_y**2+4*max_x**2)
            xy=8e-7*max_x*max_y
        else:raise ValueError('No authored bound for this case')
        edges=p-np.roll(p,-1,axis=0)
        return float(np.max(xx*edges[:,0]**2+2*xy*np.abs(edges[:,0]*edges[:,1])+yy*edges[:,1]**2)/6)
    return bound


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--parent',type=Path,required=True)
    args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    parent_bytes=(ROOT/'shared/hybrid-terrain-research.json').read_bytes()
    parent=json.loads(parent_bytes)
    report={'schema':'gugis-local-triangle-research-v1','generated_at':'2026-10-04',
        'parent_sha256':hashlib.sha256(parent_bytes).hexdigest(),'paper':parent['paper'],
        'algorithm':'Worst certified Linfinity triangle; L1 interpolation decision; bisect selected edge and its neighbor for C0 closure. Exact convex L1 reduction for convex bowl; seven-point absolute-error quadrature elsewhere with longest-edge safeguard if the child bound improves less than 1%. Not paper optimality proof or ArcGIS execution.',
        'cost':'Actual complete uncompressed JSON of paired archives with identical metadata; all XYZ, strip indices, shared topology included. Original hybrid geometry unchanged. Provenance/diagnostics external to both archives, included in ZIP but not file cost.',
        'source_access':'Local triangles evaluate the exact authored function at dyadic midpoints, including points outside the original tensor grid. Hybrid retains its original source-grid controls. This stronger oracle/candidate-family difference is disclosed; not an equal-algorithm ablation.',
        'pending':['Real DEM continuous triangle error bounds','ArcGIS software execution','Proved near-optimal conforming mixed costs'],
        'cases':[],
        'builder_source_sha256':hashlib.sha256((ROOT/'backend/app/services/terrain_triangles.py').read_bytes().replace(b'\r\n',b'\n')).hexdigest(),
        'analytic_source_sha256':hashlib.sha256((ROOT/'data-pipeline/build_hybrid_research.py').read_bytes().replace(b'\r\n',b'\n')).hexdigest()}
    for data in cases():
        case_id=data['id'];original=next(c for c in parent['cases'] if c['id']==case_id)
        directory=args.output/case_id;directory.mkdir(exist_ok=True)
        parent_dir=args.parent/case_id
        reference=(parent_dir/'reference.npz').read_bytes()
        if hashlib.sha256(reference).hexdigest()!=original['source_reference_sha256']:raise ValueError('Parent source changed')
        (directory/'reference.npz').write_bytes(reference)
        shutil.copyfile(parent_dir/'query-fixture.json',directory/'query-fixture.json')
        record={'id':case_id,'name':data['name'],'demonstration':True,'source_shape':original['source_shape'],
            'source_reference_sha256':original['source_reference_sha256'],'variants':[]}
        for pair in original['variants']:
            target=pair['target_m'];legacy=pair['hybrid']
            content=(parent_dir/legacy['filename']).read_bytes()
            if hashlib.sha256(content).hexdigest()!=legacy['sha256']:raise ValueError('Parent model changed')
            hybrid=json.loads(content)
            start=time.perf_counter()
            terrain,local=local_triangles([-100,-100,100,100],data['function'],triangle_certificate(case_id,data['function']),
                tolerance=target,convex=case_id=='convex-bowl',name=data['name'])
            local['build_and_validate_ms']=(time.perf_counter()-start)*1000
            triangle=terrain.model_dump(exclude_none=True)
            metadata={k:v for k,v in hybrid.items() if k not in ('points','patches','source')}
            metadata['source']={k:v for k,v in hybrid['source'].items() if k not in ('构建器','证书口径')}
            metadata['source']['算法回执']='同包 results.json；两份档案元数据统一以公平计量成本'
            outputs={}
            for mode,model,stats in [('hybrid',hybrid,legacy),('local_triangles',triangle,local)]:
                paired={**metadata,'points':model['points'],'patches':model['patches']}
                Terrain.model_validate(paired)
                filename=f'{"paired-hybrid" if mode=="hybrid" else "local-triangles"}-{target:g}m.json'
                packed=json.dumps(paired,separators=(',',':')).encode()
                (directory/filename).write_bytes(packed)
                outputs[mode]={**stats,'filename':filename,'bytes':len(packed),'sha256':hashlib.sha256(packed).hexdigest(),
                    'origin_archive_sha256':legacy['sha256'] if mode=='hybrid' else None}
            record['variants'].append({'target_m':target,**outputs})
            print(json.dumps({'case':case_id,'target_m':target,'hybrid_points':legacy['points'],
                'local_points':local['points'],'local_triangles':local['triangles'],'local_strips':local['patches'],
                'status':local['status'],'provisional_file_saving_percent':100*(1-outputs['hybrid']['bytes']/outputs['local_triangles']['bytes'])}),flush=True)
        (directory/'results.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8')
        report['cases'].append(record)
    (args.output/'results.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')


if __name__=='__main__':main()
