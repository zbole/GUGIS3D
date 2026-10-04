"""Audit both representations against unchanged 0.5m source observations.

The source was used in preprocessing: this is off-grid validation, not a
held-out dataset. Run --prepare, the Node --offgrid query, then this script.
"""
import argparse
import csv
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import time
import numpy as np
from PIL import Image
import torch
from replay_implicit_terrain import evaluate, SOURCE_SHA, WEIGHT_SHAS

ROOT = Path(__file__).resolve().parents[1]
SEED = 20261006
COUNT = 16384


def errors(reference, prediction):
    difference = np.asarray(prediction, dtype=float) - reference
    if not np.isfinite(difference).all():
        raise ValueError('An off-grid query was missing or nonfinite')
    absolute = np.abs(difference)
    return {'rmse_m': float(np.sqrt(np.mean(difference**2))), 'mae_m': float(absolute.mean()),
            'p95_absolute_m': float(np.percentile(absolute,95)), 'max_absolute_m': float(absolute.max()),
            'bias_m': float(difference.mean())}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reference', required=True, type=Path)
    parser.add_argument('--input', required=True, type=Path)
    parser.add_argument('--prepare', action='store_true')
    args = parser.parse_args()
    base_bytes = (ROOT/'shared/implicit-terrain-benchmark.json').read_bytes()
    base = json.loads(base_bytes)
    demo = args.reference/'implicitterrain_demo'
    raster = demo/'2494_1141.tif'
    if hashlib.sha256(raster.read_bytes()).hexdigest() != SOURCE_SHA:
        raise ValueError('Source raster does not match the audited 0.5m DEM')
    source = np.asarray(Image.open(raster), dtype=float)
    if source.shape != (2000,2000) or not np.isfinite(source).all() or (source == -9999).any():
        raise ValueError('Invalid source raster')
    # Original 0.5m pixel centres differ from every 1m evaluation-grid centre.
    # Exclude one outer pixel on each side to stay inside the common domain.
    selected = np.random.default_rng(SEED).choice(1998**2, COUNT, replace=False)
    rows,cols = selected//1998+1, selected%1998+1
    row_metres,col_metres = rows*.5+.25, cols*.5+.25
    xy = np.column_stack([col_metres-500,500-row_metres])
    reference = source[rows,cols]
    fixture_path = args.input/'offgrid-fixture.json'
    if args.prepare:
        fixture = {'schema':'gugis-offgrid-query-fixture-v1','seed':SEED,'source_sha256':SOURCE_SHA,
                   'parent_report_sha256':hashlib.sha256(base_bytes).hexdigest(), 'xy':xy.tolist()}
        fixture_path.write_text(json.dumps(fixture,separators=(',',':'))+'\n',encoding='utf-8')
        print(json.dumps({'stage':'prepared','samples':COUNT,'unique':len(set(selected.tolist()))}))
        return
    fixture_bytes = fixture_path.read_bytes()
    fixture = json.loads(fixture_bytes)
    if (fixture['parent_report_sha256'] != hashlib.sha256(base_bytes).hexdigest()
            or fixture['source_sha256'] != SOURCE_SHA or fixture['seed'] != SEED
            or not np.array_equal(fixture['xy'],xy)):
        raise ValueError('Fixture belongs to another source, query set or parent benchmark')
    torch.set_num_threads(8)
    coords = torch.from_numpy(np.column_stack([(row_metres-.5)/999*2-1,
                                               (col_metres-.5)/999*2-1]).astype(np.float32))
    states=[]
    for name,sha in WEIGHT_SHAS.items():
        path=demo/'2494_1141'/f'{name}.pth'
        if hashlib.sha256(path.read_bytes()).hexdigest()!=sha:
            raise ValueError(f'{name} is not the audited public model')
        state=torch.load(path,map_location='cpu',weights_only=True)
        expected=[(256,2),(256,),*[(256,256),(256,)]*3,(1,256),(1,)]
        if [tuple(v.shape) for v in state.values()]!=expected or not all(torch.isfinite(v).all() for v in state.values()):
            raise ValueError('Unsupported weight structure')
        states.append(state)
    low,high=base['dataset']['height_range_m']; rmin,rmax=base['dataset']['residual_range_normalized']
    def run():
        a,b=(evaluate(state,coords,8192) for state in states)
        normalized=a-(b*.5+.5)*(rmax-rmin)-rmin
        return (normalized.astype(float)+1)*.5*(high-low)+low
    run(); timings=[]
    for _ in range(5):
        started=time.perf_counter();prediction=run();timings.append((time.perf_counter()-started)*1000)
    native_run=json.loads((args.input/'offgrid-native-queries.json').read_bytes())
    native=native_run['reports']
    if len(native)!=len(base['variants']):
        raise ValueError('Incomplete native off-grid run')
    variants=[]
    for v in base['variants']:
        row=next(result for result in native if result['id']==v['id'])
        if (row['archive_sha256']!=v['sha256'] or row['fixture_sha256']!=hashlib.sha256(fixture_bytes).hexdigest()
                or row['query_count']!=COUNT or len(row['values'])!=COUNT or any(z is None for z in row['values'])):
            raise ValueError('Native run does not match the saved archive and query fixture')
        variants.append({'id':v['id'],'stride_m':v['stride_m'],'archive_sha256':row['archive_sha256'],
                         'metrics':errors(reference,row['values']),'query_repetitions_ms':row['query_repetitions_ms']})
    report={'schema':'gugis-offgrid-source-audit-v1','generated_at':datetime.now(timezone.utc).isoformat(),'seed':SEED,
            'parent_report_sha256':hashlib.sha256(base_bytes).hexdigest(), 'source_sha256':SOURCE_SHA,
            'fixture_sha256':hashlib.sha256(fixture_bytes).hexdigest(), 'samples':COUNT,'unique_samples':COUNT,
            'source_resolution_m':.5,'reference':'Unchanged original 0.5m DEM; quarter-metre offsets from the 1m reference lattice',
            'common_domain':'Original rows and columns 1..1998; no extrapolation',
            'held_out':False,'limitation':'The same source was used in preprocessing. Off-grid/source-resolution validation, not independent held-out accuracy. Metrics are separate from the full 1m benchmark.',
            'runtime':{'python':__import__('platform').python_version(),'torch':torch.__version__,'node':native_run['runtime'],
                       'timing':'Same points, warm five repeats, PyTorch CPU batch versus Node scalar; different implementations'},
            'spg':{'metrics':errors(reference,prediction),'query_repetitions_ms':timings,
                   'device':'CPU','torch_threads':8,'status':'pretrained-offgrid-replay'},'variants':variants}
    content=(json.dumps(report,indent=2)+'\n').encode('utf-8')
    (ROOT/'shared/implicit-terrain-offgrid.json').write_bytes(content)
    public=ROOT/'frontend/public/research/implicit-terrain'
    (public/'offgrid-results.json').write_bytes(content)
    with (public/'offgrid-results.csv').open('w',encoding='utf-8-sig',newline='') as handle:
        writer=csv.writer(handle);writer.writerow(['method','stride_m','samples','rmse_m','mae_m','p95_absolute_m','max_absolute_m','held_out'])
        for method,stride,result in [('SPG','',report['spg']),*[('GUGIS',v['stride_m'],v) for v in variants]]:
            writer.writerow([method,stride,COUNT,*[result['metrics'][key] for key in ['rmse_m','mae_m','p95_absolute_m','max_absolute_m']],False])
    print(json.dumps({'samples':COUNT,'spg':report['spg']['metrics'],'variants':[{k:v[k] for k in ['id','metrics']} for v in variants]}))


if __name__=='__main__':
    main()
