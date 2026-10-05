"""Audit and publish fixed native query trials; never overwrite a release."""
import argparse
import csv
import io
import json
import math
from pathlib import Path
import shutil
import zipfile
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from piecewise_ruled_control import ROOT, COUNTS, source, models
from terrain_order_control import digest, packed, binary_bytes, polynomial_metrics
from publish_terrain_order_control import curve_integral

DEST=ROOT/'frontend/public/research/native-query-v1'
SUMMARY=ROOT/'shared/native-query-performance-v1.json'
def stats(values):
    v=sorted(values)
    return {k:v[math.floor((len(v)-1)*q)] for k,q in [('median',.5),('p10',.1),('p90',.9),('minimum',0),('maximum',1)]}
def load(folder,e,binary=False):
    name=e['binary_filename'] if binary else e['filename'];size=e['binary_bytes'] if binary else e['bytes'];h=e['binary_sha256'] if binary else e['sha256']
    if Path(name).name!=name:raise ValueError('Unsafe evidence path')
    b=(folder/name).read_bytes()
    if len(b)!=size or digest(b)!=h:raise ValueError('Model receipt changed')
    return b
def analytic(c,x,y):
    if c.get('strips'):
        n=c['strips'];w=100/n;j=min(n-1,max(0,math.floor((x+50)/w)));l=-50+j*w;a=(.2+.05*math.cos(2*math.pi*j/n))/w**2;s=(x-l)*(x-l-w)
        return 30+.001*x+.002*y+a*s*(1+.002*y),[.001+a*(2*(x-l)-w)*(1+.002*y),.002+.002*a*s]
    if c['id']=='extruded-quadratic':return 30+.002*x*x+.03*y,[.004*x,.03]
    if c['id']=='modulated-quadratic':return 30+.00002*x*x*(y+60)+.01*y,[.00004*x*(y+60),.00002*x*x+.01]
    raise ValueError('Unknown source')

def verify(folder,pieces):
    raw=(folder/'results.json').read_bytes();r=json.loads(raw);pr=(pieces/'results.json').read_bytes();p=json.loads(pr)
    oldraw=(ROOT/'shared/terrain-order-control-v1.json').read_bytes();old=json.loads(oldraw)
    if r['schema']!='gugis-native-query-performance-v1' or p['schema']!='gugis-piecewise-ruled-control-v1' or p['counts']!=list(COUNTS):raise ValueError('Unknown protocol')
    if r['parent_publication_sha256']!=digest(oldraw) or r['piecewise_report_sha256']!=digest(pr):raise ValueError('Changed parent')
    for name,h in dict(p['scripts'],**r['scripts']).items():
        if digest((ROOT/name).read_text(encoding='utf8').replace('\r\n','\n').encode())!=h:raise ValueError('Changed bound implementation: '+name)
    expected=old['structure_fixtures']+p['structure_fixtures']
    if [c['id'] for c in r['cases']]!=[c['id'] for c in expected]:raise ValueError('Missing or selected cases')
    if [c.get('strips') for c in p['structure_fixtures']]!=list(COUNTS):raise ValueError('Changed fixed scales')
    fixture=r['fixture'];fb=load(folder,fixture);points=json.loads(fb)['points']
    grid=[[-50+(i+.38196601125)*100/128,-50+(j+.61803398875)*100/32] for i in range(128) for j in range(32)]
    if points!=grid or fixture['points']!=4096:raise ValueError('Changed fixed queries')
    cb=load(folder,r['trials_csv']);csv_rows=list(csv.DictReader(io.StringIO(cb.decode())))
    if len(csv_rows)!=5*44:raise ValueError('Missing timed trials')
    if r['protocol']['prepared_trials']!=17 or r['protocol']['legacy_trials']!=5:raise ValueError('Changed trial count')
    for c,reference in zip(r['cases'],expected):
        if c['triangle_degree']!=reference['triangle_degree'] or c['name']!=reference['name']:raise ValueError('Changed comparison family')
        base=pieces if reference.get('strips') else ROOT/'frontend/public/research/order-controls-v1'
        if reference.get('strips'):
            rebuilt=models(reference['strips'])
            for index,e in enumerate([reference['ruled'],reference['triangles']]):
                b=load(base/c['id'],e);model=json.loads(b);bb=load(base/c['id'],e,True)
                if model!=rebuilt[index] or bb!=binary_bytes(model):raise ValueError('Changed shared-node structure')
                fn=lambda xy:source(reference['strips'],xy)
                metrics=curve_integral(model,fn) if index==0 else polynomial_metrics(model,fn,nodes=9)
                if abs(metrics['area_m2']-10000)>1e-7 or metrics['e2_m2']>=1e-8 or abs(metrics['e2_m2']-e['e2_m2'])>1e-9:raise ValueError('Whole-domain precision gate failed')
        methods=c['methods']
        if [m['family'] for m in methods]!=['ruled','triangles']:raise ValueError('Changed method order')
        for m,e in zip(methods,[reference['ruled'],reference['triangles']]):
            b=load(base/c['id'],e,True)
            for key in ['binary_filename','binary_bytes','binary_sha256','e2_m2','controls']:
                if m[key]!=e[key]:raise ValueError('Changed model binding')
            if len(b)!=m['binary_bytes'] or not math.isfinite(m['prepare_ms']) or m['prepare_ms']<0:raise ValueError('Invalid preparation')
            gate=m['correctness']
            if gate['requested']!=4100 or gate['hits']!=4100 or any(not 0<=gate[k]<1e-9 for k in ['max_height_m','max_gradient','max_prepared_legacy_difference']):raise ValueError('Native correctness gate failed')
        expected_sum=sum((lambda z,g:z+17*g[0]+23*g[1])(*analytic(reference,x,y)) for x,y in points)
        for implementation,count in [('prepared',17),('legacy',5)]:
            loops=c['loops' if implementation=='prepared' else 'legacy_loops']
            calibration=c['calibration_ms_per_4096' if implementation=='prepared' else 'legacy_calibration_ms_per_4096']
            if loops!=max(1,min(128,math.ceil(30/max(.001,min(calibration))))) or c['queries_per_trial']!=c['loops']*4096:raise ValueError('Changed calibration')
            for family in ['ruled','triangles']:
                rows=[v for v in c['rows'] if v['implementation']==implementation and v['family']==family]
                if [v['trial'] for v in rows]!=list(range(count)):raise ValueError('Incomplete trial sequence')
                for v in rows:
                    if v['queries']!=loops*4096 or not math.isfinite(v['elapsed_ms']) or v['elapsed_ms']<=0 or v['ns_per_query']!=v['elapsed_ms']*1e6/v['queries']:raise ValueError('Invalid timing units')
                    if v['execution_order']!=(v['trial']%2 if family=='ruled' else 1-v['trial']%2):raise ValueError('Unbalanced trial order')
                    if abs(v['checksum']-expected_sum*loops)>1e-8*max(1,abs(expected_sum*loops)):raise ValueError('Query outputs not consumed correctly')
                    match=[z for z in csv_rows if z['case_id']==c['id'] and z['implementation']==implementation and z['family']==family and int(z['trial'])==v['trial']]
                    if len(match)!=1 or any(float(match[0][k])!=v[k] for k in ['execution_order','elapsed_ms','queries','ns_per_query','checksum']):raise ValueError('CSV trial mismatch')
                m=next(m for m in methods if m['family']==family)
                if stats([v['ns_per_query'] for v in rows])!=m[implementation+'_ns_per_query']:raise ValueError('Selected or altered distribution')
        paired=[next(v['ns_per_query'] for v in c['rows'] if v['trial']==i and v['implementation']=='prepared' and v['family']=='triangles')/next(v['ns_per_query'] for v in c['rows'] if v['trial']==i and v['implementation']=='prepared' and v['family']=='ruled') for i in range(17)]
        if stats(paired)!=c['paired_speed_ratio'] or c['ruled_vs_prepared_triangle_median_ratio']!=methods[1]['prepared_ns_per_query']['median']/methods[0]['prepared_ns_per_query']['median']:raise ValueError('Incorrect speed advantage')
    return r,p,raw,pr

def publish(folder,pieces):
    if DEST.exists() or SUMMARY.exists():raise FileExistsError('Published evidence is immutable')
    r,p,raw,pr=verify(folder,pieces);DEST.mkdir(parents=True)
    for name in ['results.json','trials.csv','query-fixture.json']:shutil.copyfile(folder/name,DEST/name)
    (DEST/'piecewise-controls.json').write_bytes(pr)
    old=json.loads((ROOT/'shared/terrain-order-control-v1.json').read_bytes())
    for c in old['structure_fixtures']+p['structure_fixtures']:
        base=pieces if c.get('strips') else ROOT/'frontend/public/research/order-controls-v1'
        out=DEST/c['id'];out.mkdir()
        for e in [c['ruled'],c['triangles']]:
            for name in [e['filename'],e['binary_filename']]:shutil.copyfile(base/c['id']/name,out/name)
    (DEST/'README.txt').write_text('Five fixed analytic structure cases; same native height and Cartesian gradient queries.\n128x32 deterministic interior coordinates, both source families exact to numerical E2 < 1e-8 m2. C0 strip boundaries have one-sided gradients.\nBoth prepared methods use identical bounding-box index policy and precomputed coefficients. 17 paired AB/BA trials; observed p10-p90 variation, not confidence intervals. Warm-up and separately calibrated legacy loops are recorded.\nFull GOC2 binary files measured, not RAM. CPU query timings measured in Node on the recorded machine, not ArcGIS or GPU/browser frame times.\n',encoding='utf8',newline='\n')
    fig,axes=plt.subplots(1,2,figsize=(11,4.6),layout='constrained')
    labels=['P2, 1 strip','P3, 1 strip','P3, 8 strips','P3, 32 strips','P3, 128 strips'];x=np.arange(5)
    for offset,family,color,label in [(-.18,'ruled','#128979','GUGIS P2xP1'),(.18,'triangles','#94a4b4','Nodal P2/P3 triangles')]:
        ms=[next(m for m in c['methods'] if m['family']==family) for c in r['cases']]
        axes[0].bar(x+offset,[m['binary_bytes'] for m in ms],.36,color=color,label=label)
        med=np.array([m['prepared_ns_per_query']['median'] for m in ms]);lo=np.array([m['prepared_ns_per_query']['p10'] for m in ms]);hi=np.array([m['prepared_ns_per_query']['p90'] for m in ms])
        axes[1].errorbar(x+offset,med,yerr=np.array([med-lo,hi-med]),fmt='o',capsize=4,color=color,label=label)
    axes[0].set(yscale='log',ylabel='Complete GOC2 file / B',title='Same-function structure cost: all E2 < 1e-8 m²')
    axes[1].set(ylabel='Prepared CPU query / ns',title='Point location + height + gradient\n17 trials: median and observed p10–p90')
    for ax in axes:ax.set_xticks(x,labels,rotation=20);ax.grid(axis='y',alpha=.2);ax.legend(fontsize=8)
    figures={}
    for ext in ['png','svg']:
        name='native-query-results.'+ext;fig.savefig(DEST/name,dpi=170,metadata={'Date':None} if ext=='svg' else None);figures[name]=digest((DEST/name).read_bytes())
    plt.close(fig)
    source_out=DEST/'implementations';source_out.mkdir()
    for name in sorted(set(r['scripts'])|set(p['scripts'])|{'data-pipeline/publish_native_query_performance.py'}):
        (source_out/Path(name).name).write_text((ROOT/name).read_text(encoding='utf8').replace('\r\n','\n'),encoding='utf8',newline='\n')
    with zipfile.ZipFile(DEST/'native-query-evidence.zip','x',compression=zipfile.ZIP_DEFLATED) as z:
        for path in sorted(DEST.rglob('*')):
            if not path.is_file() or path.suffix=='.zip':continue
            info=zipfile.ZipInfo('native-query-v1/'+path.relative_to(DEST).as_posix(),date_time=(2026,10,6,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED
            z.writestr(info,path.read_bytes(),compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
    zb=(DEST/'native-query-evidence.zip').read_bytes()
    summary={k:v for k,v in r.items() if k!='cases'}
    summary.update(report_sha256=digest(raw),publisher_sha256=digest(Path(__file__).read_text(encoding='utf8').replace('\r\n','\n').encode()),figures=figures,
      package={'filename':'native-query-evidence.zip','bytes':len(zb),'sha256':digest(zb)},
      cases=[dict({k:v for k,v in c.items() if k!='rows'},binary_saving_percent=100*(1-c['methods'][0]['binary_bytes']/c['methods'][1]['binary_bytes'])) for c in r['cases']])
    b=(json.dumps(summary,ensure_ascii=False,indent=2,allow_nan=False)+'\n').encode();SUMMARY.write_bytes(b);(DEST/'publication.json').write_bytes(b)
    print('Published all five fixed structures, 220 timed trials, complete native files and audit-ready source.')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('folder',type=Path);parser.add_argument('pieces',type=Path);args=parser.parse_args();publish(args.folder,args.pieces)
