"""Publish the local-triangle comparison only after native and Python readback."""
import argparse
import csv
import hashlib
import io
import json
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
import numpy as np
from publish_hybrid_research import independent_heights
ROOT=Path(__file__).resolve().parents[1]


def digest(content):return hashlib.sha256(content).hexdigest()


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--input',type=Path,required=True)
    args=parser.parse_args();root=args.input
    report=json.loads((root/'results.json').read_bytes())
    if digest((ROOT/'shared/hybrid-terrain-research.json').read_bytes())!=report['parent_sha256']:
        raise ValueError('Frozen parent benchmark changed')
    query=json.loads((root/'native-query-results.json').read_bytes())
    source=digest((ROOT/'frontend/src/studio/terrainMath.ts').read_bytes().replace(b'\r\n',b'\n'))
    if query['source_sha256']!=source:raise ValueError('Website kernel changed since measurements')
    report.update(native_query_runtime=query['runtime'],native_query_source_sha256=source)
    output=ROOT/'frontend/public/research/hybrid-terrain';rows=[]
    for case in report['cases']:
        directory=root/case['id'];fixture_bytes=(directory/'query-fixture.json').read_bytes();fixture=json.loads(fixture_bytes)
        xy=np.asarray(fixture['xy']);reference=np.asarray(fixture['reference'])
        original_grid=np.load(directory/'reference.npz');xx,yy=np.meshgrid(original_grid['x'],original_grid['y'])
        grid=np.column_stack((xx.flat,yy.flat));grid_reference=original_grid['height'].ravel()
        for pair in case['variants']:
            for mode in ('hybrid','local_triangles'):
                model=pair[mode]
                measured=next(q for q in query['records'] if q['case']==case['id'] and q['target_m']==pair['target_m'] and q['mode']==mode)
                content=(directory/model['filename']).read_bytes()
                if measured['archive_sha256']!=digest(content) or digest(content)!=model['sha256'] or len(content)!=model['bytes']:
                    raise ValueError('Archive differs from measurement receipt')
                if measured['fixture_sha256']!=digest(fixture_bytes):raise ValueError('Coordinate fixture changed')
                values=np.asarray(measured['values']);independent=independent_heights(json.loads(content),xy)
                difference=float(np.max(np.abs(independent-values)))
                if difference>1e-8:raise ValueError('Native and independent readbacks differ')
                errors=values-reference;absolute=np.abs(errors)
                grid_errors=independent_heights(json.loads(content),grid)-grid_reference
                model['source_grid']={'samples':len(grid),'rmse_m':float(np.sqrt(np.mean(grid_errors**2))),
                    'max_absolute_m':float(np.max(np.abs(grid_errors)))}
                model['offgrid']={'samples':len(xy),'seed':fixture['seed'],'fixture_sha256':digest(fixture_bytes),
                    'rmse_m':float(np.sqrt(np.mean(errors**2))),'mae_m':float(np.mean(absolute)),
                    'p95_absolute_m':float(np.percentile(absolute,95)),'max_absolute_m':float(np.max(absolute)),
                    'meets_sampled_target':bool(np.max(absolute)<=pair['target_m']),
                    'decoded_kernel_max_difference_m':difference,
                    **{k:measured[k] for k in ('index_ms','retained_index_heap_bytes','query_repetitions_ms','index_statistics')}}
                static=output/'models'/case['id'];static.mkdir(parents=True,exist_ok=True)
                (static/model['filename']).write_bytes(content)
                rows.append([case['id'],pair['target_m'],mode,model['bytes'],model['points'],model['patches'],model['target_met'],
                    model['source_grid']['rmse_m'],model['source_grid']['max_absolute_m'],
                    model['offgrid']['rmse_m'],model['offgrid']['max_absolute_m'],model['offgrid']['meets_sampled_target']])
            pair['comparison_eligible']=all(pair[m]['target_met'] and pair[m]['offgrid']['meets_sampled_target'] for m in ('hybrid','local_triangles'))
            pair['native_file_saving_percent']=100*(1-pair['hybrid']['bytes']/pair['local_triangles']['bytes']) if pair['comparison_eligible'] else None
            pair['control_point_saving_percent']=100*(1-pair['hybrid']['points']/pair['local_triangles']['points']) if pair['comparison_eligible'] else None
        (directory/'results.json').write_text(json.dumps(case,indent=2)+'\n',encoding='utf-8')
        package=output/f'{case["id"]}-local-triangles.zip'
        with ZipFile(package,'w',compression=ZIP_DEFLATED) as archive:
            for path in sorted(directory.glob('*.json')):archive.write(path,path.name)
            archive.write(directory/'reference.npz','reference.npz')
            archive.writestr('readme.txt','Local conforming triangle benchmark, authored analytic samples only.\n'
                'Each pair has identical metadata; exact original hybrid geometry and local triangle geometry. Full provenance is in results.json.\n'
                'Local triangles use unrounded dyadic binary64 XY and exact authored values at midpoints, a stronger oracle than the fixed source lattice.\n'
                'Worst certified Linfinity selection; convex exact L1 decision, other cases seven-point L1 quadrature plus 1% bound-progress safeguard.\n'
                'Conforming neighbor closure. No transfer of the paper optimality proof. No ArcGIS software execution.\n')
        case.update(download_bytes=package.stat().st_size,download_sha256=digest(package.read_bytes()))
    # Full histories/diagnostics remain in each ZIP; public scalar report stays small.
    for case in report['cases']:
        for pair in case['variants']:
            for mode in ('hybrid','local_triangles'):
                pair[mode].pop('history',None);pair[mode].pop('diagnostics',None)
                pair[mode].pop('diagnostic_examples',None)
    packed=(json.dumps(report,indent=2)+'\n').encode()
    (ROOT/'shared/local-triangle-benchmark.json').write_bytes(packed)
    (output/'local-triangle-results.json').write_bytes(packed)
    csv_data=io.StringIO();writer=csv.writer(csv_data,lineterminator='\n')
    writer.writerow(['case','target_m','mode','bytes','points','patches','target_met','source_rmse_m','source_max_m','offgrid_rmse_m','offgrid_max_m','offgrid_met'])
    writer.writerows(rows);(output/'local-triangle-results.csv').write_bytes(csv_data.getvalue().encode('utf-8'))
    print(json.dumps({'models':len(rows),'eligible_pairs':sum(p['comparison_eligible'] for c in report['cases'] for p in c['variants']),
        'max_kernel_difference_m':max(p[m]['offgrid']['decoded_kernel_max_difference_m'] for c in report['cases'] for p in c['variants'] for m in ('hybrid','local_triangles'))}),flush=True)


if __name__=='__main__':main()
