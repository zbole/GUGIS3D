"""Publish compaction only after primitive, continuous-query and boundary audits."""
import argparse
import csv
import io
import json
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
import numpy as np
from build_strip_compaction_research import digest,independent_heights,ROOT
from app.environment_models import Terrain
from app.services.terrain_compaction import primitive_sha256


def differences(a,b):
    if len(a)!=len(b):raise ValueError('Query coordinate counts differ')
    delta=np.asarray([abs(x['height']-y['height']) for x,y in zip(a,b)])
    slopes=np.asarray([abs(x['slope']-y['slope']) for x,y in zip(a,b)])
    return {'samples':len(a),'max_height_difference_m':float(delta.max()),
        'max_slope_difference_degrees':float(slopes.max()),
        'slope_ties_changed':int(np.sum(slopes>1e-8)),
        'primitive_kind_ties_changed':sum(x['kind']!=y['kind'] for x,y in zip(a,b))}


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--input',type=Path,required=True)
    root=parser.parse_args().input;report=json.loads((root/'results.json').read_bytes())
    raster=report['schema']=='gugis-raster-triangle-research-v1'
    if raster:
        report['reproduction_builder_source_sha256']=digest((ROOT/'data-pipeline/build_raster_triangle_research.py').read_bytes().replace(b'\r\n',b'\n'))
    parent_name='hybrid-terrain-research.json' if raster else 'local-triangle-benchmark.json'
    if report['parent_sha256']!=digest((ROOT/'shared'/parent_name).read_bytes()):
        raise ValueError('Frozen parent changed')
    query=json.loads((root/'native-query-results.json').read_bytes())
    if query['source_sha256']!=digest((ROOT/'frontend/src/studio/terrainMath.ts').read_bytes().replace(b'\r\n',b'\n')):
        raise ValueError('Measured query kernel changed')
    report.update(native_query_source_sha256=query['source_sha256'],native_query_runtime=query['runtime'],
        decoder_source_sha256=digest((ROOT/'data-pipeline/build_strip_compaction_research.py').read_bytes().replace(b'\r\n',b'\n')),
        query_method='4096 identical continuous coordinates, plus at most 2048 deterministic original controls/edge midpoints per target. Five post-warmup runs. Independent rectangular bilinear/triangle decoder. C0 height retained; regrouping changes first-hit derivative ties at non-C1 boundaries.')
    public=ROOT/'frontend/public/research/hybrid-terrain';rows=[]
    for case in report['cases']:
        directory=root/case['id'];fixture_bytes=(directory/'query-fixture.json').read_bytes();fixture=json.loads(fixture_bytes)
        grid_data=np.load(directory/'reference.npz');xx,yy=np.meshgrid(grid_data['x'],grid_data['y'])
        grid=np.column_stack((xx.flat,yy.flat));grid_heights=grid_data['height'].ravel()
        for pair in case['variants']:
            records={};models={}
            boundary_bytes=(directory/pair['boundary_fixture']).read_bytes()
            if digest(boundary_bytes)!=pair['boundary_fixture_sha256']:raise ValueError('Boundary sites changed')
            boundary=json.loads(boundary_bytes)
            for mode in ('hybrid','compact_hybrid','local_triangles'):
                receipt=pair[mode];content=(directory/receipt['filename']).read_bytes()
                if len(content)!=receipt['bytes'] or digest(content)!=receipt['sha256']:raise ValueError('Archive changed')
                models[mode]=Terrain.model_validate_json(content)
                measured=next(q for q in query['records'] if q['case']==case['id'] and q['target_m']==pair['target_m'] and q['mode']==mode)
                if measured['archive_sha256']!=receipt['sha256'] or measured['fixture_sha256']!=digest(fixture_bytes) or measured['boundary_fixture_sha256']!=digest(boundary_bytes):
                    raise ValueError('Query receipt changed')
                records[mode]=measured;values=np.asarray(measured['values'])
                independent=independent_heights(json.loads(content),np.asarray(fixture['xy']))
                diff=float(np.abs(independent-values).max())
                boundary_values=independent_heights(json.loads(content),np.asarray(boundary['xy']))
                boundary_diff=float(np.abs(boundary_values-[h['height'] for h in measured['boundary_hits']]).max())
                if max(diff,boundary_diff)>1e-8:raise ValueError('Independent and native queries differ')
                err=values-np.asarray(fixture['reference'])
                source_err=independent_heights(json.loads(content),grid)-grid_heights
                receipt['source_grid']={'samples':len(grid),'rmse_m':float(np.sqrt(np.mean(source_err**2))),
                    'max_absolute_m':float(np.abs(source_err).max())}
                receipt['offgrid']={'samples':len(values),'fixture_sha256':digest(fixture_bytes),
                    'rmse_m':float(np.sqrt(np.mean(err**2))),'max_absolute_m':float(np.abs(err).max()),
                    'meets_sampled_target':bool(np.abs(err).max()<=pair['target_m']),
                    'decoded_kernel_max_difference_m':diff,'boundary_decoder_max_difference_m':boundary_diff,
                    **{k:measured[k] for k in ('index_ms','retained_index_heap_bytes','query_repetitions_ms','index_statistics')}}
                output=public/'models'/case['id'];output.mkdir(parents=True,exist_ok=True)
                if mode=='compact_hybrid' or raster:(output/receipt['filename']).write_bytes(content)
                rows.append([case['id'],pair['target_m'],mode,receipt['bytes'],receipt['points'],receipt['patches'],
                    receipt['offgrid']['rmse_m'],receipt['offgrid']['max_absolute_m']])
            if models['hybrid'].points!=models['compact_hybrid'].points:raise ValueError('Controls changed')
            if primitive_sha256(models['hybrid'])!=primitive_sha256(models['compact_hybrid']):raise ValueError('Native functions changed')
            # Metadata fields stay equal; all topology records count toward bytes.
            metadata=lambda model:{k:v for k,v in model.model_dump(exclude_none=True).items() if k not in ('points','patches')}
            if not all(metadata(model)==metadata(models['hybrid']) for model in models.values()):raise ValueError('Unequal metadata')
            random=differences(records['hybrid']['hits'],records['compact_hybrid']['hits'])
            edges=differences(records['hybrid']['boundary_hits'],records['compact_hybrid']['boundary_hits'])
            if random['max_height_difference_m']>1e-8 or random['max_slope_difference_degrees']>1e-8 or edges['max_height_difference_m']>1e-8:
                raise ValueError('Represented interior queries or boundary height changed')
            pair['preservation']={'primitive_sha256':primitive_sha256(models['hybrid']),
                'random_queries':random,'boundary_queries':edges,'boundary_total_candidates':boundary['total_candidates'],
                'controls_identical':True,'patch_ids_preserved':False,'boundary_derivative_tie_order_preserved':False}
            pair['comparison_eligible']=all(pair[m]['target_met'] and pair[m]['offgrid']['meets_sampled_target'] for m in models)
            pair['organization_saving_percent']=100*(1-pair['compact_hybrid']['bytes']/pair['hybrid']['bytes'])
            pair['compact_vs_local_saving_percent']=100*(1-pair['compact_hybrid']['bytes']/pair['local_triangles']['bytes']) if pair['comparison_eligible'] else None
            if raster:
                pair['native_file_saving_percent']=100*(1-pair['hybrid']['bytes']/pair['local_triangles']['bytes']) if pair['comparison_eligible'] else None
        (directory/'results.json').write_text(json.dumps(case,indent=2)+'\n',encoding='utf-8')
        package=public/f'{case["id"]}-{"raster-triangles" if raster else "strip-compaction"}.zip'
        with ZipFile(package,'w',compression=ZIP_DEFLATED) as archive:
            for path in sorted(directory.glob('*.json')):archive.write(path,path.name)
            archive.write(directory/'reference.npz','reference.npz')
            archive.writestr('readme.txt','Strip organization audit: original hybrid, identical primitives regrouped, and local-triangle baseline.\n'
                'All original archives included for recovery. Compact model does not retain old patch IDs or first-hit derivative tie order on shared boundaries.\n'
                'No control/height/refinement changes; oriented primitives SHA and continuous/boundary query audits in results.json.\n'
                'Full JSON bytes, not memory savings or proved optimality. No ArcGIS software execution.\n')
            if raster:
                archive.writestr('raster-reference.txt',report['reference_definition']+'\n'+report['certificate']+'\n'
                    'Swiss source: ImplicitTerrain authors / swissALTI3D, Federal Office of Topography swisstopo.\n'
                    'https://www.swisstopo.admin.ch/en/terms-of-use-free-geodata-and-geoservices\n'
                    'The historical sampled-only hybrid remains in the parent dataset. These hybrid/local models are newly constructed against the continuous reference raster.\n')
        case.update(download_bytes=package.stat().st_size,download_sha256=digest(package.read_bytes()))
    if raster:
        for case in report['cases']:
            for pair in case['variants']:
                for mode in ('hybrid','compact_hybrid','local_triangles'):
                    pair[mode].pop('history',None);pair[mode].pop('diagnostics',None)
    packed=(json.dumps(report,indent=2)+'\n').encode()
    report_name='raster-triangle-benchmark.json' if raster else 'strip-compaction-benchmark.json'
    result_name='raster-triangle-results' if raster else 'strip-compaction-results'
    (ROOT/'shared'/report_name).write_bytes(packed);(public/f'{result_name}.json').write_bytes(packed)
    stream=io.StringIO();writer=csv.writer(stream,lineterminator='\n');writer.writerow(['case','target_m','mode','bytes','points','patches','rmse_m','max_m']);writer.writerows(rows)
    (public/f'{result_name}.csv').write_bytes(stream.getvalue().encode('utf-8'))
    print(json.dumps({'models':len(rows),'eligible_pairs':sum(p['comparison_eligible'] for c in report['cases'] for p in c['variants']),
        'max_height_difference_m':max(p['preservation']['random_queries']['max_height_difference_m'] for c in report['cases'] for p in c['variants']),
        'boundary_slope_ties_changed':sum(p['preservation']['boundary_queries']['slope_ties_changed'] for c in report['cases'] for p in c['variants'])}),flush=True)


if __name__=='__main__':main()
