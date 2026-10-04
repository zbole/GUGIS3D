"""Ship audited local-partition models, including exact shared-edge closure checks."""
import argparse
from collections import Counter
import csv
import io
import json
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
import numpy as np
from build_bristol_terrain_benchmark import ROOT,digest,packed,Terrain
from app.services.terrain_compaction import primitive_sha256


def closure(model):
    counts=Counter();area=0.
    for patch in model.patches:
        for face in patch.faces():
            for a,b in zip(face,face[1:]+face[:1]):counts[tuple(sorted((a,b)))]+=1
            xy=np.asarray([model.points[i][:2] for i in face])
            signed=float(np.linalg.det(np.column_stack((xy[1]-xy[0],xy[2]-xy[0])))/2)
            if signed<=0:raise ValueError('Nonpositive XY triangle orientation')
            area+=signed
    xmin=min(p[0] for p in model.points);xmax=max(p[0] for p in model.points)
    ymin=min(p[1] for p in model.points);ymax=max(p[1] for p in model.points)
    interior=boundary=0
    for (a,b),count in counts.items():
        p,q=model.points[a],model.points[b]
        outer=(p[0]==q[0] and p[0] in (xmin,xmax)) or (p[1]==q[1] and p[1] in (ymin,ymax))
        if count!=(1 if outer else 2):raise ValueError('Missing or nonmanifold shared edge')
        if outer:boundary+=1
        else:interior+=1
    expected=(xmax-xmin)*(ymax-ymin)
    if abs(area-expected)>1e-8:raise ValueError('XY coverage area changed')
    return {'internal_edges_paired':interior,'outer_edges':boundary,'xy_area_m2':area,
            'c0_shared_ids_and_edge_traces':True,'c1_claim':False}


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--input',type=Path,required=True)
    args=parser.parse_args();build_bytes=(args.input/'results.json').read_bytes();report=json.loads(build_bytes)
    audit_bytes=(args.input/'native-audit.json').read_bytes();audit=json.loads(audit_bytes)
    if audit['parent_sha256']!=digest(build_bytes):raise ValueError('Native audit changed build binding')
    report.update(build_receipt_sha256=digest(build_bytes),native_audit_sha256=digest(audit_bytes),
                  native_kernel_sha256=audit['native_kernel_sha256'],native_runner_sha256=audit['runner_sha256'],
                  native_query_scope=audit['scope'])
    report['scripts']['data-pipeline/publish_bristol_local_partition.py']=digest(Path(__file__).read_bytes().replace(b'\r\n',b'\n'))
    public=ROOT/'frontend/public/research/bristol-local-partition';public.mkdir(parents=True,exist_ok=True)
    rows=[]
    for case in report['cases']:
        folder=args.input/case['id']
        for pair in case['variants']:
            primitive=None
            for family in ('local_hybrid','compact_local_hybrid'):
                record=pair[family];content=(folder/record['filename']).read_bytes()
                if digest(content)!=record['sha256']:raise ValueError('Saved model changed')
                model=Terrain.model_validate(json.loads(content))
                if primitive_sha256(model)!=pair['primitive_sha256']:raise ValueError('Directed geometry changed')
                record['closure']=closure(model)
                query=next(r for r in audit['records'] if r['case_id']==case['id'] and r['target_m']==pair['target_m'] and r['family']==family)
                if query['archive_sha256']!=record['sha256'] or query['fixture_sha256']!=case['fixture_sha256']:raise ValueError('Query audit mismatched')
                record['query_audit']=query
                rows.append([case['id'],pair['target_m'],family,record['bytes'],record['points'],record['continuous_bound_m'],
                             query['rmse_m'],query['max_sampled_m'],pair['build_validate_ms'],query['index_ms'],query['query_batch_median_ms']])
            compact=pair['compact_local_hybrid']['bytes']
            pair['vs_global_compact_saving_percent']=100*(1-compact/pair['global_compact_bytes'])
            pair['vs_local_triangles_saving_percent']=100*(1-compact/pair['local_triangles_bytes'])
            print(json.dumps({'case':case['id'],'target':pair['target_m'],
                              'global_saving':pair['vs_global_compact_saving_percent'],'local_triangle_saving':pair['vs_local_triangles_saving_percent']}),flush=True)
        package=public/f"{case['id']}-local-partition.zip"
        with ZipFile(package,'w',compression=ZIP_DEFLATED) as archive:
            for path in sorted(folder.iterdir()):
                if path.is_file():archive.write(path,path.name)
            archive.writestr('build-receipt.json',build_bytes);archive.writestr('native-audit.json',audit_bytes)
            archive.write(ROOT/'backend/data/terrain/DATA_LICENSE.md','DATA_LICENSE.md')
            archive.writestr('README.txt','Local-partition research in BNG offsets, NOT city ENU. EA 2022 DTM / OGL v3.\n'
                              'Rule each rectangle only when its whole-cell reference bound passes.\n'
                              'Hanging boundary vertices use centre-to-boundary triangles encoded as triangle strips, no triangle-fan primitive.\n'
                              'Shared point IDs and boundary edges: C0, not C1. Reference bound is not unknown-ground accuracy.\n'
                              'Different certified surfaces, not identical-geometry isolation or an optimality theorem. No ArcGIS software run.\n')
        content=package.read_bytes();case['download']={'filename':package.name,'bytes':len(content),'sha256':digest(content)}
    content=(json.dumps(report,ensure_ascii=False,indent=2)+'\n').encode()
    (ROOT/'shared/bristol-local-partition.json').write_bytes(content);(public/'results.json').write_bytes(content)
    summary=json.loads(content)
    summary['full_report_sha256']=digest(content)
    for case in summary['cases']:
        for pair in case['variants']:
            pair['receipt']={k:v for k,v in pair['receipt'].items() if k not in ('history','cells_source_indices')}
    (ROOT/'shared/bristol-local-partition-summary.json').write_bytes((json.dumps(summary,ensure_ascii=False,indent=2)+'\n').encode())
    stream=io.StringIO();writer=csv.writer(stream,lineterminator='\n')
    writer.writerow(['case','target_m','family','native_bytes','points','continuous_bound_m','rmse_m','max_sampled_m','build_validate_ms','index_ms','4096_query_median_ms'])
    writer.writerows(rows);(public/'results.csv').write_bytes(stream.getvalue().encode())


if __name__=='__main__':main()
