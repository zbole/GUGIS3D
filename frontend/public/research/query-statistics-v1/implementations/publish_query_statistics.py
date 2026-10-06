"""Validate every statistical result from the original CPU trial receipts."""
import argparse,json,math,shutil,zipfile
from pathlib import Path
import numpy as np
import query_statistics as source
from plot_query_statistics import plot
ROOT=source.ROOT;sha=source.sha;DEST=ROOT/'frontend/public/research/query-statistics-v1';SUMMARY=ROOT/'shared/query-statistics-display-v1.json'
def checked(p,digest):
    b=p.read_bytes()
    if sha(b)!=digest:raise ValueError('Source/evidence changed: '+str(p))
    return b
def publish(folder):
    if DEST.exists() or SUMMARY.exists():raise FileExistsError('Immutable statistical release required')
    raw=(folder/'results.json').read_bytes();r=json.loads(raw);protocolraw=checked(folder/'protocol.json',r['protocol_sha256']);protocol=json.loads(protocolraw)
    if protocolraw!=source.PROTOCOL.read_bytes() or [c['id'] for c in r['cases']]!=protocol['cases']:raise ValueError('Fixed secondary protocol changed')
    source_summary_raw=checked(folder/'source-summary.json',r['source_summary_sha256']);parent=json.loads(source_summary_raw)
    if source_summary_raw!=(ROOT/protocol['source_summary']).read_bytes():raise ValueError('Published source summary differs')
    source_report_raw=checked(folder/'source-report.json',r['source_report_sha256']);trials=checked(folder/'source-trials.csv',r['source_trials_sha256'])
    if r['source_report_sha256']!=protocol['source_report_sha256'] or r['source_trials_sha256']!=protocol['source_trials_sha256']:raise ValueError('Original timing identities differ')
    for p,h in r['scripts'].items():
        if sha((ROOT/p).read_bytes().replace(b'\r\n',b'\n'))!=h:raise ValueError('Statistical code changed')
    # A fresh deterministic replay reads the bound original CSV, never times queries.
    replay=folder/'independent-release-replay';source.compute(replay)
    if (replay/'results.json').read_bytes()!=raw or (replay/'paired-trials.csv').read_bytes()!=(folder/'paired-trials.csv').read_bytes():raise ValueError('Full deterministic secondary replay differs')
    import csv,io
    pairs=list(csv.DictReader(io.StringIO((folder/'paired-trials.csv').read_text(encoding='utf8'))));audit=[]
    for c in r['cases']:
        data=[p for p in pairs if p['case_id']==c['id']];a=np.array([float(p['ruled_ns']) for p in data]);b=np.array([float(p['triangles_ns']) for p in data]);wins=int(np.sum(a<b));losses=int(np.sum(a>b));n=wins+losses
        # Independently sum the full equally-probable binomial support.
        pvalue=sum(math.comb(n,k) for k in range(n+1) if math.comb(n,k)<=math.comb(n,wins))/2**n if n else 1.
        if abs(pvalue-c['sign_two_sided_p'])>1e-15 or c['wins']!=wins or c['losses']!=losses or c['ties']!=int(np.sum(a==b)) or len(data)!=17:raise ValueError('Independent paired sign calculation differs')
        dist=checked(folder/c['bootstrap_filename'],c['bootstrap']['distribution_sha256']);values=np.frombuffer(dist,dtype='<f8')
        if len(values)!=protocol['bootstrap_resamples'] or (replay/c['bootstrap_filename']).read_bytes()!=dist or not np.isfinite(values).all():raise ValueError('Bootstrap distribution differs')
        ordered=np.sort(values)
        def linear(q):
            k=q*(len(ordered)-1);lo=int(math.floor(k));hi=int(math.ceil(k));return float(ordered[lo]+(k-lo)*(ordered[hi]-ordered[lo]))
        if abs(linear(.025)-c['bootstrap']['low'])>1e-12 or abs(linear(.975)-c['bootstrap']['high'])>1e-12:raise ValueError('Independent percentile interpolation differs')
        audit.append({'case_id':c['id'],'pairs':17,'binomial_full_support_p':pvalue,'bootstrap_replay_sha256':sha(dist),'percentiles_rechecked':True})
    sorted_p=sorted(c['sign_two_sided_p'] for c in r['cases'])
    for c in r['cases']:
        p=c['sign_two_sided_p'];adjusted=min(1.,max((len(sorted_p)-j)*value for j,value in enumerate(sorted_p) if value<=p))
        if adjusted!=c['holm_adjusted_p']:raise ValueError('Independent Holm stepdown differs')
    original_evidence=ROOT/'frontend/public/research/native-query-v1'/parent['package']['filename'];checked(original_evidence,parent['package']['sha256'])
    DEST.mkdir(parents=True)
    for p in folder.iterdir():
        if p.is_file():shutil.copyfile(p,DEST/p.name)
    shutil.copyfile(original_evidence,DEST/'original-native-query-evidence.zip');plot(r,pairs,DEST/'query-statistics-results.svg')
    ar=(json.dumps({'schema':'gugis-query-statistics-release-audit-v1','report_sha256':sha(raw),'source_records':220,'prepared_pairs':85,'source_timings_unchanged':True,'replay':'Exact complete report, paired CSV and all 250000 bootstrap Float64 values; independent full binomial support and linear percentile interpolation','rows':audit},separators=(',',':'))+'\n').encode();(DEST/'release-audit.json').write_bytes(ar)
    scripts={**r['scripts'],'data-pipeline/publish_query_statistics.py':sha(Path(__file__).read_bytes().replace(b'\r\n',b'\n')),'data-pipeline/plot_query_statistics.py':sha((ROOT/'data-pipeline/plot_query_statistics.py').read_bytes().replace(b'\r\n',b'\n'))};impl=DEST/'implementations';impl.mkdir()
    for p in scripts:(impl/Path(p).name).write_bytes((ROOT/p).read_bytes().replace(b'\r\n',b'\n'))
    (DEST/'README.txt').write_text('SECONDARY ANALYSIS of the existing five fixed native CPU fixtures, 17 paired prepared trials each. Original 220 raw rows, five legacy trials per fixture and original native evidence package remain unchanged and included. This is not a new timed run or preregistration before source timing collection.\nStatistic: median(triangle ns/query) divided by median(ruled ns/query); not median of paired ratios. Paired percentile bootstrap, fixed execution-order strata (9 ruled-first / 8 triangle-first), 50000 PCG64 resamples per case, seed61006 + fixed case ordinal. 2.5/97.5 linear quantiles are exploratory resampling intervals. All five cases remain.\nTwo-sided exact paired sign test excludes exact ties; Holm stepdown over all five cases at alpha0.05. Assumes sufficiently independent/representative timing pairs; serial dependence, deterministic execution order and runtime drift may affect inference. No causal probability or cross-device guarantee.\nSource is the already published Windows i7-14650HX / Node24.13.0 CPU correctness-preserving polynomial query benchmark, not rendering, GPU, ArcGIS software or real-DTM performance. Package includes deterministic numerical replay, independent binomial/percentile checks and all raw bootstrap distributions.\n',encoding='utf8',newline='\n')
    with zipfile.ZipFile(DEST/'query-statistics-evidence.zip','x',compression=zipfile.ZIP_DEFLATED) as archive:
        for p in sorted(DEST.rglob('*')):
            if p.is_file() and p.name!='query-statistics-evidence.zip':
                info=zipfile.ZipInfo('query-statistics-v1/'+p.relative_to(DEST).as_posix(),date_time=(2026,10,6,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;archive.writestr(info,p.read_bytes(),compresslevel=9)
    b=(DEST/'query-statistics-evidence.zip').read_bytes();summary={**r,'scripts':scripts,'report_sha256':sha(raw),'release_audit_sha256':sha(ar),'paired_csv_sha256':sha((DEST/'paired-trials.csv').read_bytes()),'figure_sha256':sha((DEST/'query-statistics-results.svg').read_bytes()),'package':{'filename':'query-statistics-evidence.zip','bytes':len(b),'sha256':sha(b)}}
    body=(json.dumps(summary,ensure_ascii=False,indent=2,allow_nan=False)+'\n').encode();SUMMARY.write_bytes(body);(DEST/'publication.json').write_bytes(body);print('Published all five conditional statistical outcomes without replacing source measurements')
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('folder',type=Path);publish(parser.parse_args().folder)
