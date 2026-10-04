"""Regroup frozen native primitives without changing controls or approximation."""
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
from app.environment_models import Terrain
from app.services.terrain_compaction import compact_strips,primitive_sha256


def digest(content):return hashlib.sha256(content).hexdigest()


def independent_heights(terrain,xy):
    """Decode every stored rectangular bilinear quad and oriented strip face."""
    result=np.full(len(xy),np.nan);points=np.asarray(terrain['points']);x,y=xy.T
    for patch in terrain['patches']:
        if patch['kind']=='ruled-strip':
            for a,b,c,d in zip(patch['left'],patch['right'],patch['left'][1:],patch['right'][1:]):
                corners=points[[a,b,c,d]];west,south=corners[:,:2].min(axis=0);east,north=corners[:,:2].max(axis=0)
                lookup={(p[0],p[1]):p[2] for p in corners}
                positions=[(west,south),(east,south),(west,north),(east,north)]
                if len(lookup)!=4 or any(pos not in lookup for pos in positions):
                    raise ValueError('This independent research decoder requires axis-aligned rectangles')
                mask=np.isnan(result)&(x>=west-1e-9)&(x<=east+1e-9)&(y>=south-1e-9)&(y<=north+1e-9)
                u,v=(x[mask]-west)/(east-west),(y[mask]-south)/(north-south)
                a,b,c,d=[lookup[pos] for pos in positions]
                result[mask]=(1-u)*(1-v)*a+u*(1-v)*b+(1-u)*v*c+u*v*d
        elif patch['kind']=='triangle-strip':
            for i in range(len(patch['indices'])-2):
                a,b,c=points[patch['indices'][i:i+3]]
                det=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
                u=((x-a[0])*(c[1]-a[1])-(y-a[1])*(c[0]-a[0]))/det
                v=((b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0]))/det
                mask=np.isnan(result)&(u>=-1e-9)&(v>=-1e-9)&(u+v<=1+1e-9)
                result[mask]=a[2]+u[mask]*(b[2]-a[2])+v[mask]*(c[2]-a[2])
        else:raise ValueError('Only ruled and triangle strips are benchmarked')
    if not np.isfinite(result).all():raise ValueError('Independent query missed a site')
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True);parser.add_argument('--parent',type=Path,required=True)
    args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    parent_bytes=(ROOT/'shared/local-triangle-benchmark.json').read_bytes();parent=json.loads(parent_bytes)
    report={'schema':'gugis-strip-compaction-research-v1','generated_at':'2026-10-04',
        'parent_sha256':digest(parent_bytes),'builder_source_sha256':digest((ROOT/'backend/app/services/terrain_compaction.py').read_bytes().replace(b'\r\n',b'\n')),
        'strip_packer_source_sha256':digest((ROOT/'backend/app/services/terrain_triangles.py').read_bytes().replace(b'\r\n',b'\n')),
        'method':'Join only matching ruled boundary endpoints; repack identical oriented triangles. Controls and represented bilinear/linear functions unchanged. No refinement or new function access.',
        'cost':'Complete normalized-metadata JSON. Research patch identifiers are regrouped; per-patch attribute/ID preservation is not offered. Original archives remain available. Not memory savings or ArcGIS execution.',
        'cases':[]}
    for case in parent['cases']:
        folder=args.output/case['id'];folder.mkdir(exist_ok=True);source=args.parent/case['id']
        for filename in ('query-fixture.json','reference.npz'):shutil.copyfile(source/filename,folder/filename)
        result={k:case[k] for k in ('id','name','source_reference_sha256')};result['variants']=[]
        for pair in case['variants']:
            model_bytes=(source/pair['hybrid']['filename']).read_bytes()
            if digest(model_bytes)!=pair['hybrid']['sha256']:raise ValueError('Frozen hybrid changed')
            original=Terrain.model_validate_json(model_bytes);start=time.perf_counter()
            compact,stats=compact_strips(original);stats['compaction_validate_ms']=(time.perf_counter()-start)*1000
            packed=json.dumps(compact.model_dump(exclude_none=True),separators=(',',':')).encode()
            filename=f"compact-hybrid-{pair['target_m']:g}m.json";(folder/filename).write_bytes(packed)
            records={m:dict(pair[m]) for m in ('hybrid','local_triangles')}
            for m,rec in records.items():
                content=(source/rec['filename']).read_bytes()
                if digest(content)!=rec['sha256']:raise ValueError('Frozen pair changed')
                (folder/rec['filename']).write_bytes(content)
            records['compact_hybrid']={**records['hybrid'],**stats,'filename':filename,'bytes':len(packed),
                'sha256':digest(packed),'patches':len(compact.patches)}
            if primitive_sha256(original)!=stats['primitive_sha256']:raise ValueError('Primitive preservation failed')
            # Exact source controls and edge midpoints; bounded deterministic subset.
            sites=set(tuple(p[:2]) for p in original.points)
            for patch in original.patches:
                for face in patch.faces():
                    for a,b in zip(face,face[1:]+face[:1]):
                        sites.add(tuple((np.asarray(original.points[a][:2])+original.points[b][:2])/2))
            ordered=sorted(sites);step=max(1,int(np.ceil(len(ordered)/2048)))
            boundary=ordered[::step]
            boundary_name=f"boundary-{pair['target_m']:g}m.json"
            boundary_bytes=json.dumps({'xy':boundary,'total_candidates':len(ordered),'stride':step},separators=(',',':')).encode()
            (folder/boundary_name).write_bytes(boundary_bytes)
            result['variants'].append({'target_m':pair['target_m'],**records,'boundary_fixture':boundary_name,
                'boundary_fixture_sha256':digest(boundary_bytes),'original_primitive_sha256':primitive_sha256(original)})
            print(json.dumps({'case':case['id'],'target':pair['target_m'],'before_bytes':len(model_bytes),
                'after_bytes':len(packed),'local_bytes':pair['local_triangles']['bytes'],'patches':len(compact.patches)}),flush=True)
        report['cases'].append(result)
    (args.output/'results.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')


if __name__=='__main__':main()
