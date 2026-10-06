"""Source-bound secondary statistics, retaining every CPU fixture and outcome."""
import argparse,csv,hashlib,io,json,math
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1];PROTOCOL=ROOT/'data-pipeline/query_statistics_protocol.json'
def sha(b):return hashlib.sha256(b).hexdigest()
def sign_p(wins,losses):
    n=wins+losses
    return min(1.,2*sum(math.comb(n,k) for k in range(min(wins,losses)+1))/2**n) if n else 1.
def holm(values):
    order=sorted(range(len(values)),key=lambda i:(values[i],i));adjusted=[0.]*len(values);last=0.
    for rank,i in enumerate(order):last=max(last,min(1.,(len(values)-rank)*values[i]));adjusted[i]=last
    return adjusted
def bootstrap(ruled,triangles,ruled_first,resamples,seed):
    ruled=np.asarray(ruled);triangles=np.asarray(triangles);ruled_first=np.asarray(ruled_first);rng=np.random.Generator(np.random.PCG64(seed));groups=[np.where(ruled_first)[0],np.where(~ruled_first)[0]]
    if not all(len(g) for g in groups):raise ValueError('Both execution-order strata required')
    parts=[]
    for start in range(0,resamples,5000):
        n=min(5000,resamples-start);indices=np.concatenate([g[rng.integers(0,len(g),size=(n,len(g)))] for g in groups],axis=1);parts.append(np.median(triangles[indices],axis=1)/np.median(ruled[indices],axis=1))
    ratios=np.concatenate(parts);return {'low':float(np.quantile(ratios,.025,method='linear')),'high':float(np.quantile(ratios,.975,method='linear')),'resamples':resamples,'distribution_sha256':sha(ratios.astype('<f8').tobytes())},ratios
def compute(folder):
    if folder.exists():raise FileExistsError('Fresh private statistical output required')
    protocolraw=PROTOCOL.read_bytes();protocol=json.loads(protocolraw);summaryraw=(ROOT/protocol['source_summary']).read_bytes();summary=json.loads(summaryraw);src=ROOT/'frontend/public/research/native-query-v1';report_raw=(src/'results.json').read_bytes();trials=(src/'trials.csv').read_bytes()
    if summary['report_sha256']!=protocol['source_report_sha256'] or sha(report_raw)!=protocol['source_report_sha256'] or sha(trials)!=protocol['source_trials_sha256'] or summary['trials_csv']['sha256']!=sha(trials) or summary['protocol']['prepared_trials']!=protocol['paired_trials']:raise ValueError('Published source identity changed')
    records=list(csv.DictReader(io.StringIO(trials.decode())));expected=[c['id'] for c in summary['cases']]
    if expected!=protocol['cases'] or len(records)!=220:raise ValueError('Missing fixed source fixture or raw row')
    prepared=[r for r in records if r['implementation']==protocol['implementation']]
    if len(prepared)!=170:raise ValueError('Prepared trial count changed')
    folder.mkdir(parents=True);(folder/'protocol.json').write_bytes(protocolraw);(folder/'source-summary.json').write_bytes(summaryraw);(folder/'source-report.json').write_bytes(report_raw);(folder/'source-trials.csv').write_bytes(trials);cases=[];pairs=[]
    for ordinal,c in enumerate(summary['cases']):
        rows=[r for r in prepared if r['case_id']==c['id']];pool={}
        for row in rows:
            trial=int(row['trial']);family=row['family'];order=int(row['execution_order']);queries=int(row['queries']);elapsed=float(row['elapsed_ms']);ns=float(row['ns_per_query']);checksum=float(row['checksum'])
            if family not in ['ruled','triangles'] or trial not in range(17) or (trial,family) in pool or order!=(trial%2 if family=='ruled' else 1-trial%2) or queries!=c['queries_per_trial'] or not math.isfinite(ns) or ns<=0 or not math.isfinite(checksum) or abs(elapsed*1e6/queries-ns)>1e-8*max(1,ns):raise ValueError('Invalid paired raw timing')
            pool[trial,family]={'trial':trial,'family':family,'order':order,'queries':queries,'ns':ns,'checksum':checksum}
        if len(pool)!=34:raise ValueError('Incomplete prepared pairing')
        ruled=[];triangles=[];first=[]
        for trial in range(17):
            r=pool[trial,'ruled'];t=pool[trial,'triangles']
            if abs(r['checksum']-t['checksum'])>1e-8*max(1,abs(r['checksum'])):raise ValueError('Paired consumed checksums differ')
            ruled.append(r['ns']);triangles.append(t['ns']);first.append(r['order']==0);pairs.append({'case_id':c['id'],'trial':trial,'first':'ruled' if r['order']==0 else 'triangles','ruled_ns':r['ns'],'triangles_ns':t['ns'],'ratio':t['ns']/r['ns']})
        r=np.array(ruled);t=np.array(triangles);first=np.array(first);ratio=float(np.median(t)/np.median(r))
        if abs(ratio-c['ruled_vs_prepared_triangle_median_ratio'])>1e-12 or np.median(r)!=c['methods'][0]['prepared_ns_per_query']['median'] or np.median(t)!=c['methods'][1]['prepared_ns_per_query']['median']:raise ValueError('Source medians changed')
        interval,distribution=bootstrap(r,t,first,protocol['bootstrap_resamples'],protocol['seed']+ordinal);(folder/(c['id']+'-bootstrap.f64')).write_bytes(distribution.astype('<f8').tobytes());wins=int(np.sum(r<t));losses=int(np.sum(r>t));ties=int(np.sum(r==t));orders=[]
        for value in [True,False]:
            ids=np.where(first==value)[0];orders.append({'first':'ruled' if value else 'triangles','pairs':len(ids),'median_ratio':float(np.median(t[ids])/np.median(r[ids]))})
        cases.append({'id':c['id'],'name':c['name'],'pairs':17,'ruled_median_ns':float(np.median(r)),'triangles_median_ns':float(np.median(t)),'median_ratio':ratio,'bootstrap':interval,'wins':wins,'losses':losses,'ties':ties,'sign_two_sided_p':sign_p(wins,losses),'execution_orders':orders,'bootstrap_filename':c['id']+'-bootstrap.f64'})
    adjusted=holm([c['sign_two_sided_p'] for c in cases])
    for c,p in zip(cases,adjusted):c['holm_adjusted_p']=p;c['significant_holm_005']=p<.05;c['resampling_interval_above_one']=c['bootstrap']['low']>1
    scripts=['data-pipeline/query_statistics.py','data-pipeline/query_statistics_protocol.json'];report={'schema':'gugis-native-query-statistics-v1','protocol_sha256':sha(protocolraw),'source_summary_sha256':sha(summaryraw),'source_report_sha256':sha(report_raw),'source_trials_sha256':sha(trials),'source_environment':summary['environment'],'analysis_environment':{'python_numpy':np.__version__,'rng':'PCG64','secondary_analysis':True},'scripts':{p:sha((ROOT/p).read_bytes().replace(b'\r\n',b'\n')) for p in scripts},'scope':protocol['scope'],'cases':cases}
    (folder/'results.json').write_bytes((json.dumps(report,ensure_ascii=False,indent=2,allow_nan=False)+'\n').encode());stream=io.StringIO(newline='');writer=csv.DictWriter(stream,fieldnames=list(pairs[0]));writer.writeheader();writer.writerows(pairs);(folder/'paired-trials.csv').write_bytes(stream.getvalue().encode());print('All five source CPU fixtures retained; paired bootstrap and Holm signs computed')
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('folder',type=Path);compute(parser.parse_args().folder)
