"""Measure locally conforming hybrid rectangles against the fixed Bristol cases."""
import argparse
import json
from pathlib import Path
import time
import numpy as np
from build_bristol_terrain_benchmark import ROOT,digest,packed,Terrain
from terrain_partition_hybrid import partition_hybrid,RasterReference
from app.services.terrain_compaction import compact_strips,primitive_sha256


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--parent',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    if (args.output/'results.json').exists():raise ValueError('Use a fresh output directory')
    parent_bytes=(ROOT/'shared/bristol-certified-terrain.json').read_bytes();parent=json.loads(parent_bytes)
    report={'schema':'gugis-bristol-local-partition-v1','generated_at':'2026-10-05','parent_sha256':digest(parent_bytes),
            'raster_sha256':parent['raster_sha256'],'method':'Locally refined rectangles; hanging edges close with centre-to-boundary triangles encoded as triangle strips. Shared IDs and edge traces enforce C0. Whole-cell reference bounds, not local slope or Hessian heuristics. No optimality claim.',
            'scripts':{p:digest((ROOT/p).read_bytes().replace(b'\r\n',b'\n')) for p in ['data-pipeline/terrain_partition_hybrid.py','data-pipeline/build_bristol_local_partition.py']},
            'reference_scope':parent['reference_definition'],'coordinate_scope':parent['coordinate_scope'],'cases':[]}
    for case in parent['cases']:
        source=args.parent/case['id'];folder=args.output/case['id'];folder.mkdir(exist_ok=False)
        reference_bytes=(source/'reference.json').read_bytes();fixture_bytes=(source/'query-fixture.json').read_bytes()
        if digest(reference_bytes)!=case['reference_sha256'] or digest(fixture_bytes)!=case['fixture_sha256']:raise ValueError('Frozen reference changed')
        (folder/'reference.json').write_bytes(reference_bytes);(folder/'query-fixture.json').write_bytes(fixture_bytes)
        grid=json.loads(reference_bytes);ref=RasterReference(grid['x'],grid['y'],grid['height'])
        record={k:case[k] for k in ('id','name','reference_sha256','fixture_sha256','origin_bng','source_window')};record['variants']=[]
        for old in case['variants']:
            target=old['target_m'];print(json.dumps({'case':case['id'],'target':target,'phase':'local partition'}),flush=True)
            start=time.perf_counter();model,stats=partition_hybrid(ref,tolerance=target,name=case['name'])
            build_ms=(time.perf_counter()-start)*1000
            original_bytes=(source/old['hybrid']['filename']).read_bytes()
            if digest(original_bytes)!=old['hybrid']['sha256']:raise ValueError('Common metadata model changed')
            metadata={k:v for k,v in json.loads(original_bytes).items() if k not in ('points','patches')}
            body=model.model_dump(exclude_none=True);model=Terrain.model_validate({**metadata,'points':body['points'],'patches':body['patches']})
            start=time.perf_counter();compact,cs=compact_strips(model);compaction_ms=(time.perf_counter()-start)*1000
            if primitive_sha256(model)!=primitive_sha256(compact):raise ValueError('Compaction changed primitives')
            pair={'target_m':target,'primitive_sha256':primitive_sha256(model),
                  'global_compact_bytes':old['compact_hybrid']['bytes'],'local_triangles_bytes':old['local_triangles']['bytes'],
                  'receipt':stats,'build_validate_ms':build_ms,'compaction_validate_ms':compaction_ms}
            for family,value in [('local_hybrid',model),('compact_local_hybrid',compact)]:
                content=packed(value.model_dump(exclude_none=True));filename=f'{family}-{target:g}m.json'
                (folder/filename).write_bytes(content)
                pair[family]={'filename':filename,'bytes':len(content),'sha256':digest(content),'points':len(value.points),
                              'patches':len(value.patches),'ruled_patches':sum(p.kind=='ruled-strip' for p in value.patches),
                              'triangle_patches':sum(p.kind=='triangle-strip' for p in value.patches),
                              'continuous_bound_m':ref.model_error(value.model_dump(exclude_none=True))['max_error_bound_m']}
            record['variants'].append(pair)
            print(json.dumps({'case':case['id'],'target':target,'status':stats['status'],'points':len(compact.points),
                              'local_compact_bytes':pair['compact_local_hybrid']['bytes'],'global_compact_bytes':pair['global_compact_bytes'],
                              'local_triangles_bytes':pair['local_triangles_bytes'],'boundary_cells':stats['boundary_triangulated_cells']}),flush=True)
        report['cases'].append(record)
    (args.output/'results.json').write_bytes((json.dumps(report,ensure_ascii=False,indent=2)+'\n').encode())


if __name__=='__main__':main()
