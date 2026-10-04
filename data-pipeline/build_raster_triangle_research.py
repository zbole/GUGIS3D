"""Continuous reference-raster hybrid / local triangle / compact-strip research."""
import argparse
import json
from pathlib import Path
import shutil
import sys
import time
import numpy as np
from build_strip_compaction_research import digest,ROOT
from app.environment_models import Terrain
from app.services.terrain_raster_reference import RasterReference
from app.services.terrain_hybrid import adaptive_grid
from app.services.terrain_triangles import local_triangles
from app.services.terrain_compaction import compact_strips,primitive_sha256


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--parent',type=Path,required=True);args=parser.parse_args()
    folder=args.output/'swiss-dem-crop';folder.mkdir(parents=True,exist_ok=True)
    parent_bytes=(ROOT/'shared/hybrid-terrain-research.json').read_bytes();parent=json.loads(parent_bytes)
    case=next(c for c in parent['cases'] if c['id']=='swiss-dem-crop');source=args.parent/case['id']
    grid_bytes=(source/'reference.npz').read_bytes()
    if digest(grid_bytes)!=case['source_reference_sha256']:raise ValueError('Frozen source crop changed')
    grid=np.load(source/'reference.npz');ref=RasterReference(grid['x'],grid['y'],grid['height'])
    for name in ('reference.npz','query-fixture.json'):shutil.copyfile(source/name,folder/name)
    report={'schema':'gugis-raster-triangle-research-v1','generated_at':'2026-10-04','parent_sha256':digest(parent_bytes),
        'builder_source_sha256':digest((ROOT/'backend/app/services/terrain_compaction.py').read_bytes().replace(b'\r\n',b'\n')),
        'strip_packer_source_sha256':digest((ROOT/'backend/app/services/terrain_triangles.py').read_bytes().replace(b'\r\n',b'\n')),
        'raster_certificate_source_sha256':digest((ROOT/'backend/app/services/terrain_raster_reference.py').read_bytes().replace(b'\r\n',b'\n')),
        'hybrid_builder_source_sha256':digest((ROOT/'backend/app/services/terrain_hybrid.py').read_bytes().replace(b'\r\n',b'\n')),
        'raster_builder_source_sha256':digest(Path(__file__).read_bytes().replace(b'\r\n',b'\n')),
        'reference_definition':'Continuous piecewise-bilinear interpolation of the frozen 129x129 source crop, 0.5 m spacing, 64x64 m. Not a bound against unmeasured ground or a UK DEM.',
        'certificate':'On each source cell the difference to a triangle plane is A+Bx+Cy+Dxy. Its absolute maximum occurs on clipped-cell edges. Check inside raster vertices, triangle-edge grid crossings and quadratic stationary points. Aligned ruled differences are bilinear and attain maxima at source-cell corners. Five-decimal Z rounding margin and floating guard included; not interval-verified arithmetic.',
        'source_access':'Local triangles query the same interpolated source reference at dyadic midpoints. No new terrain observations. Hybrid controls stay on source raster grid. Different candidate families remain explicit.',
        'method':'Continuously certified hybrid grid, conforming local longest-edge bisection with longer-neighbor preparation, then geometry-identical hybrid strip regrouping. The raster is not C2; this separate engineering strategy avoids needle triangles from arbitrary neighbor splits. Not the paper L1 algorithm or optimality theorem. Original sampled-only research remains unchanged.',
        'cases':[]}
    record={k:case[k] for k in ('id','name','source_reference_sha256','source_shape','source_sha256','source_window')}
    record.update(demonstration=False,variants=[])
    historical_cache={}
    for pair in case['variants']:
        target=pair['target_m'];old=(source/pair['hybrid']['filename']).read_bytes()
        print(json.dumps({'target':target,'phase':'continuous hybrid build'}),flush=True)
        if digest(old)!=pair['hybrid']['sha256']:raise ValueError('Original archive changed')
        original=json.loads(old);start=time.perf_counter()
        hybrid,hybrid_stats,_=adaptive_grid(ref.x,ref.y,ref.height,tolerance=target,cell_certificate=ref.cell_certificate,
            name=case['name'],demonstration=False)
        hybrid_stats['build_and_validate_ms']=(time.perf_counter()-start)*1000
        start=time.perf_counter()
        local,local_stats=local_triangles([ref.x[0],ref.y[0],ref.x[-1],ref.y[-1]],ref,ref.triangle_error,tolerance=target,name=case['name'],edge_decision='longest-edge')
        local_stats['build_and_validate_ms']=(time.perf_counter()-start)*1000
        metadata={k:v for k,v in original.items() if k not in ('points','patches','source')}
        metadata['source']={k:v for k,v in original['source'].items() if k not in ('构建方法','误差口径')}
        metadata['source']['算法回执']='同包 results.json；连续参考栅格误差与不同算法分列'
        models={};stats={}
        for mode,terrain,receipt in [('hybrid',hybrid,hybrid_stats),('local_triangles',local,local_stats)]:
            data=terrain.model_dump(exclude_none=True)
            normalized={**metadata,'points':data['points'],'patches':data['patches']}
            models[mode]=Terrain.model_validate(normalized);receipt=dict(receipt)
            start=time.perf_counter();certificate=ref.model_error(normalized)
            receipt.update(continuous_certificate=certificate,certificate_validate_ms=(time.perf_counter()-start)*1000,
                continuous_bound_available=True,target_met=receipt['target_met'] and certificate['max_error_bound_m']<=target,
                scope=report['reference_definition'],certificate_scope=report['certificate'])
            stats[mode]=receipt
        start=time.perf_counter();models['compact_hybrid'],compact_stats=compact_strips(models['hybrid'])
        stats['compact_hybrid']={**stats['hybrid'],**compact_stats,'compaction_validate_ms':(time.perf_counter()-start)*1000,
            'patches':len(models['compact_hybrid'].patches)}
        outputs={}
        prefixes={'hybrid':'raster-hybrid','local_triangles':'raster-local-triangles','compact_hybrid':'raster-compact-hybrid'}
        for mode,model in models.items():
            content=json.dumps(model.model_dump(exclude_none=True),separators=(',',':')).encode()
            filename=f'{prefixes[mode]}-{target:g}m.json';(folder/filename).write_bytes(content)
            outputs[mode]={**stats[mode],'filename':filename,'bytes':len(content),'sha256':digest(content)}
        primitive_key=digest(json.dumps([original['points'],original['patches']],separators=(',',':')).encode())
        if primitive_key not in historical_cache:historical_cache[primitive_key]=ref.model_error(original)
        sites=set(tuple(p[:2]) for p in models['hybrid'].points)
        for patch in models['hybrid'].patches:
            for face in patch.faces():
                for a,b in zip(face,face[1:]+face[:1]):sites.add(tuple((np.asarray(models['hybrid'].points[a][:2])+models['hybrid'].points[b][:2])/2))
        ordered=sorted(sites);step=max(1,int(np.ceil(len(ordered)/2048)));boundary=ordered[::step]
        boundary_name=f'boundary-{target:g}m.json';boundary_bytes=json.dumps({'xy':boundary,'total_candidates':len(ordered),'stride':step},separators=(',',':')).encode()
        (folder/boundary_name).write_bytes(boundary_bytes)
        record['variants'].append({'target_m':target,**outputs,'boundary_fixture':boundary_name,
            'boundary_fixture_sha256':digest(boundary_bytes),'original_primitive_sha256':primitive_sha256(models['hybrid']),
            'historical_sampled_hybrid_sha256':pair['hybrid']['sha256'],'historical_continuous_certificate':historical_cache[primitive_key]})
        print(json.dumps({'target':target,'hybrid_points':stats['hybrid']['points'],'local_points':stats['local_triangles']['points'],
            'certificates':[stats[m]['continuous_certificate']['max_error_bound_m'] for m in ('hybrid','local_triangles')],
            'target_met':[stats[m]['target_met'] for m in ('hybrid','local_triangles')],
            'historical_bound':historical_cache[primitive_key]['max_error_bound_m']}),flush=True)
    # Large build histories/diagnostics stay in local provenance for publication ZIPs.
    report['cases']=[record];(args.output/'results.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')


if __name__=='__main__':main()
