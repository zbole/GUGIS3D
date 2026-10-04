"""Publish measured error/cost frontiers; no new models or formal-city writes."""
import csv
import hashlib
import io
import json
import math
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
ERROR_EPSILON=1e-10


def frontier(records, metric):
    """Observed nondominated points, with disclosed numeric error tie tolerance."""
    return [r['id'] for r in records if not any(
        other['bytes'] <= r['bytes'] and other[metric] <= r[metric]+ERROR_EPSILON and
        (other['bytes'] < r['bytes'] or other[metric] < r[metric]-ERROR_EPSILON)
        for other in records if other['id'] != r['id'])]


def build():
    paths=['shared/strip-compaction-benchmark.json','shared/raster-triangle-benchmark.json','shared/raster-multipatch-benchmark.json']
    raw={path:(ROOT/path).read_bytes() for path in paths}
    reports=[json.loads(raw[path]) for path in paths]
    output=[]
    for source in reports[:2]:
        raster=source['schema']=='gugis-raster-triangle-research-v1'
        for case in source['cases']:
            records=[]
            for pair in case['variants']:
                for family in ['hybrid','compact_hybrid','local_triangles']:
                    model=pair[family]
                    content=(ROOT/'frontend/public/research/hybrid-terrain/models'/case['id']/model['filename']).read_bytes()
                    if len(content)!=model['bytes'] or hashlib.sha256(content).hexdigest()!=model['sha256']:
                        raise ValueError('Saved model differs from parent precision experiment')
                    if raster:
                        bound=model['continuous_certificate']['max_error_bound_m']
                    elif not model.get('continuous_bound_available',family=='local_triangles'):
                        raise ValueError('A continuous bound is required for this comparison')
                    else:
                        bound=model['max_bound_m']+model['rounding_margin_m'] if family=='local_triangles' else model['max_selection_bound_m']+5e-6
                    record={'id':f"{family}:{pair['target_m']:g}", 'family':family,
                        'target_m':pair['target_m'], 'build_target_met':model['target_met'],
                        'bytes':model['bytes'], 'bound_m':bound, 'rmse_m':model['offgrid']['rmse_m'],
                        'sampled_max_m':model['offgrid']['max_absolute_m'],
                        'fixture_sha256':model['offgrid']['fixture_sha256'],
                        'samples':model['offgrid']['samples'], 'archive_sha256':model['sha256'],
                        'download':f"/research/hybrid-terrain/models/{case['id']}/{model['filename']}"}
                    if any(not math.isfinite(record[k]) or record[k]<0 for k in ['bound_m','rmse_m','sampled_max_m']):
                        raise ValueError('Invalid error measurement')
                    records.append(record)
                if raster:
                    mp=next(v for v in reports[2]['variants'] if v['target_m']==pair['target_m'])
                    if mp['native_sha256']!=pair['local_triangles']['sha256']:
                        raise ValueError('MultiPatch geometry parent differs')
                    tri=records[-1]
                    records.append({**tri,'id':f"multipatch:{pair['target_m']:g}", 'family':'multipatch',
                        'bytes':mp['core_bytes'], 'archive_sha256':mp['download']['sha256'],
                        'download':f"/research/hybrid-terrain/{mp['download']['filename']}"})
            if len({r['fixture_sha256'] for r in records})!=1 or any(r['samples']!=4096 for r in records):
                raise ValueError('Models were measured at different query sites')
            output.append({'id':case['id'],'name':case['name'],'reference_kind':'bilinear-raster' if raster else 'authored-function',
                'records':records,'frontiers':{key:frontier(records,key) for key in ['bound_m','rmse_m']}})
    return {'schema':'gugis-terrain-error-cost-v1','generated_at':'2026-10-04',
        'parents':{path:hashlib.sha256(content).hexdigest() for path,content in raw.items()},
        'builder_source_sha256':hashlib.sha256(Path(__file__).read_bytes().replace(b'\r\n',b'\n')).hexdigest(),
        'error_tie_tolerance_m':ERROR_EPSILON,
        'method':'Observed Pareto frontiers of four saved error targets, complete JSON or five-component MultiPatch bytes. Same 4096 query sites per case. Bounds include height rounding. Empirical RMSE is not a maximum-error guarantee. Not optimal over untested approximations or ArcGIS software performance.',
        'cases':output}


def main():
    report=build();content=(json.dumps(report,indent=2)+'\n').encode()
    (ROOT/'shared/terrain-error-cost.json').write_bytes(content)
    public=ROOT/'frontend/public/research/hybrid-terrain'
    (public/'terrain-error-cost.json').write_bytes(content)
    stream=io.StringIO();writer=csv.writer(stream,lineterminator='\n')
    columns=['case','id','family','target_m','build_target_met','bytes','bound_m','rmse_m','sampled_max_m','samples','fixture_sha256','archive_sha256']
    writer.writerow(columns)
    for case in report['cases']:
        for record in case['records']:
            writer.writerow([case['id']]+[record[key] for key in columns[1:]])
    (public/'terrain-error-cost.csv').write_bytes(stream.getvalue().encode())
    print(json.dumps({'cases':len(report['cases']),'measured_models':sum(len(c['records']) for c in report['cases'])}))


if __name__=='__main__':main()
