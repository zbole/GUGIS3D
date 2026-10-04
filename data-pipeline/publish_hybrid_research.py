"""Cross-check saved-model queries, publish scalars, and refresh dataset ZIPs."""
import argparse
import csv
import hashlib
import io
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import numpy as np
ROOT=Path(__file__).resolve().parents[1]


def independent_heights(terrain,xy):
    result=np.full(len(xy),np.nan);points=np.asarray(terrain['points']);x,y=xy.T
    for patch in terrain['patches']:
        if patch['kind']=='ruled-strip':
            corners=points[[patch['left'][0],patch['left'][1],patch['right'][0],patch['right'][1]]]
            west,south=np.min(corners[:,:2],axis=0);east,north=np.max(corners[:,:2],axis=0)
            mask=np.isnan(result)&(x>=west-1e-9)&(x<=east+1e-9)&(y>=south-1e-9)&(y<=north+1e-9)
            u,v=(x[mask]-west)/(east-west),(y[mask]-south)/(north-south)
            lookup={(p[0],p[1]):p[2] for p in corners}
            a,b,c,d=[lookup[pos] for pos in [(west,south),(east,south),(west,north),(east,north)]]
            result[mask]=(1-u)*(1-v)*a+u*(1-v)*b+(1-u)*v*c+u*v*d
        else:
            ids=patch['indices']
            for i in range(len(ids)-2):
                a,b,c=points[ids[i:i+3]]
                det=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
                u=((x-a[0])*(c[1]-a[1])-(y-a[1])*(c[0]-a[0]))/det
                v=((b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0]))/det
                mask=np.isnan(result)&(u>=-1e-9)&(v>=-1e-9)&(u+v<=1+1e-9)
                result[mask]=a[2]+u[mask]*(b[2]-a[2])+v[mask]*(c[2]-a[2])
    if not np.isfinite(result).all():raise ValueError('Independent saved-model query missed a point')
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--input',type=Path,required=True)
    args=parser.parse_args();root=args.input
    report=json.loads((root/'results.json').read_bytes())
    queries=json.loads((root/'native-query-results.json').read_bytes())
    report['native_query_runtime']=queries['runtime'];report['native_query_source_sha256']=queries['source_sha256']
    report['builder_source_sha256']=hashlib.sha256((ROOT/'backend/app/services/terrain_hybrid.py').read_bytes().replace(b'\r\n',b'\n')).hexdigest()
    report['query_method']='4096 shared random continuous coordinates, seed 20261007; website native kernel Node CPU, warm-up plus five runs. Independent Python decoded-model cross-check. Analytic references evaluated exactly; DEM references bilinearly interpolated from source crop, not independent measured heights. Index heap is post-GC increment above parsed-model baseline; no GPU/ArcGIS claim.'
    rows=[]
    for data in report['cases']:
        directory=root/data['id'];fixture_bytes=(directory/'query-fixture.json').read_bytes();fixture=json.loads(fixture_bytes)
        xy=np.asarray(fixture['xy']);reference=np.asarray(fixture['reference'])
        for variant in data['variants']:
            for mode in ('hybrid','triangles'):
                model=variant[mode]
                query=next(q for q in queries['records'] if q['case']==data['id'] and q['target_m']==variant['target_m'] and q['mode']==mode)
                if query['archive_sha256']!=model['sha256'] or query['fixture_sha256']!=hashlib.sha256(fixture_bytes).hexdigest():
                    raise ValueError('Query provenance mismatch')
                content=(directory/model['filename']).read_bytes()
                if hashlib.sha256(content).hexdigest()!=model['sha256']:raise ValueError('Archive changed')
                static_directory=ROOT/f'frontend/public/research/hybrid-terrain/models/{data["id"]}'
                static_directory.mkdir(parents=True,exist_ok=True)
                (static_directory/model['filename']).write_bytes(content)
                values=np.asarray(query['values']);independent=independent_heights(json.loads(content),xy)
                difference=float(np.abs(values-independent).max())
                if difference>1e-8:raise ValueError('Python and website saved-model queries disagree')
                errors=values-reference;absolute=np.abs(errors)
                audit={'samples':len(xy),'seed':fixture['seed'],'reference_kind':fixture['reference_kind'],
                    'rmse_m':float(np.sqrt(np.mean(errors**2))),'mae_m':float(absolute.mean()),
                    'p95_absolute_m':float(np.percentile(absolute,95)),'max_absolute_m':float(absolute.max()),
                    'meets_sampled_target':bool(absolute.max()<=variant['target_m']),
                    'decoded_kernel_max_difference_m':difference,'fixture_sha256':query['fixture_sha256'],
                    **{k:v for k,v in query.items() if k in ('index_ms','retained_index_heap_bytes','query_repetitions_ms','index_statistics')}}
                model['offgrid']=audit
                rows.append([data['id'],variant['target_m'],mode,model['bytes'],model['points'],model['patches'],
                    model['target_met'],model['continuous_bound_available'],model['rmse_m'],model['max_sampled_error_m'],
                    audit['rmse_m'],audit['max_absolute_m'],audit['meets_sampled_target']])
            variant['comparison_eligible']=all(variant[m]['target_met'] and variant[m]['offgrid']['meets_sampled_target'] for m in ('hybrid','triangles'))
            variant['native_file_saving_percent']=100*(1-variant['hybrid']['bytes']/variant['triangles']['bytes']) if variant['comparison_eligible'] else None
            variant['control_point_saving_percent']=100*(1-variant['hybrid']['points']/variant['triangles']['points']) if variant['comparison_eligible'] else None
        (directory/'results.json').write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')
        package=ROOT/f'frontend/public/research/hybrid-terrain/{data["id"]}.zip'
        with ZipFile(package,'w',compression=ZIP_DEFLATED) as archive:
            for p in sorted(directory.glob('*.json')):archive.write(p,p.name)
            archive.write(directory/'reference.npz','reference.npz')
            archive.writestr('readme.txt','Finite-scale hybrid research dataset: native JSON, reference grid, query fixture and full scalar/diagnostic results.\n'
                'Same global tensor candidate family; not optimal arbitrary triangulation or a replication of greedy bisection.\n'
                'Analytic cases include explicit cell bounds. DEM errors are source-sample checks; random-point reference is interpolated DEM, not measured truth.\n'
                'No ArcGIS execution. Native models in local projection offsets, not UK city geography.\n'
                'Swiss source: ImplicitTerrain authors / swissALTI3D, Federal Office of Topography swisstopo.\n'
                'https://www.swisstopo.admin.ch/en/terms-of-use-free-geodata-and-geoservices\nNo author weights or code.\n')
        data['download_bytes']=package.stat().st_size;data['download_sha256']=hashlib.sha256(package.read_bytes()).hexdigest()
    # Large per-cell diagnostics and histories remain in downloadable archives.
    for data in report['cases']:
        for variant in data['variants']:
            for mode in ('hybrid','triangles'):
                model=variant[mode]
                diagnostics=model.pop('diagnostics');model['diagnostic_examples']=sorted(diagnostics,key=lambda d:(d['kind']!='ruled-strip',-d['mother_length_m']))[:6]
                history=model.pop('history');model['refinement_steps']=len(history)-1
    public=ROOT/'frontend/public/research/hybrid-terrain';public.mkdir(parents=True,exist_ok=True)
    content=(json.dumps(report,indent=2)+'\n').encode()
    (ROOT/'shared/hybrid-terrain-research.json').write_bytes(content);(public/'results.json').write_bytes(content)
    stream=io.StringIO();writer=csv.writer(stream,lineterminator='\n')
    writer.writerow(['case','target_m','mode','native_bytes','points','patches','source_target_met','analytic_bound_available',
        'source_rmse_m','source_max_m','offgrid_rmse_m','offgrid_max_m','offgrid_sampled_target_met']);writer.writerows(rows)
    (public/'results.csv').write_bytes(stream.getvalue().encode('utf-8'))
    print(json.dumps({'cases':len(report['cases']),'models':len(rows),'eligible_pairs':sum(v['comparison_eligible'] for c in report['cases'] for v in c['variants']),
        'max_kernel_difference_m':max(v[m]['offgrid']['decoded_kernel_max_difference_m'] for c in report['cases'] for v in c['variants'] for m in ('hybrid','triangles'))}),flush=True)


if __name__=='__main__':main()
