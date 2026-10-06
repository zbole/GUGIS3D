"""Audit all four-family CPU records and publish a separate immutable source study."""
import argparse,csv,hashlib,html,io,itertools,json,math,shutil,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
DEST=ROOT/'frontend/public/research/source-query-v1'
SUMMARY=ROOT/'shared/source-query-display-v1.json'
def sha(b):return hashlib.sha256(b).hexdigest()
def packed(v):return (json.dumps(v,ensure_ascii=False,indent=2,allow_nan=False)+'\n').encode('utf8')
def checked(p,h,size=None):
    b=p.read_bytes()
    if sha(b)!=h or size is not None and len(b)!=size:raise ValueError('Evidence bytes changed: '+str(p))
    return b
def stats(v):
    v=sorted(v)
    return {'median':v[(len(v)-1)//2],'p10':v[math.floor((len(v)-1)*.1)],'p90':v[math.floor((len(v)-1)*.9)],'minimum':v[0],'maximum':v[-1]}
def verify(folder,failed):
    receipt_raw=(folder/'run-receipt.json').read_bytes();receipt=json.loads(receipt_raw)
    protocol_raw=checked(folder/'protocol.json',receipt['protocol_sha256']);protocol=json.loads(protocol_raw)
    if protocol_raw!=(ROOT/'data-pipeline/source_query_protocol.json').read_bytes():raise ValueError('Fixed CPU protocol changed')
    source_raw=checked(ROOT/'shared/source-native-bands-v1.json',protocol['source_publication_sha256']);source=json.loads(source_raw)
    if receipt['source_publication_sha256']!=sha(source_raw) or len(receipt['runs'])!=3 or len(source['cases'])!=20:raise ValueError('Missing repetitions or source windows')
    audit_raw=(folder/'native-audit.json').read_bytes();audit=json.loads(audit_raw)
    if audit['receipt_sha256']!=sha(receipt_raw) or audit['source_proof_locations']!=82000 or audit['frozen_equivalence_locations']!=184060 or audit['query_calls']!=696120 or len(audit['cases'])!=20:raise ValueError('Native source audit incomplete')
    for p,h in {**receipt['scripts'],**audit['scripts']}.items():
        if sha((ROOT/p).read_text(encoding='utf8').replace('\r\n','\n').encode('utf8'))!=h:raise ValueError('Frozen implementation changed')
    failed_raw=(failed/'run-receipt.json').read_bytes();failure=json.loads(failed_raw)
    if failure['protocol_sha256']!=sha(protocol_raw) or failure['scripts']!=receipt['scripts'] or len(failure['runs'])!=1 or failure['runs'][0]['exit_code']!=1 or 'report_sha256' in failure['runs'][0] or (failed/'run-1/results.json').exists():raise ValueError('Retained pre-timing path failure differs')
    orders=list(itertools.permutations(protocol['families']));cases=[]
    for c in source['cases']:cases.append({'id':c['id'],'city_id':c['city_id'],'name':c['name'],'reference_sha256':c['reference_sha256'],'source_raster_sha256':c['source_raster_sha256'],'methods':[], 'repetitions':[]})
    rows=[];environment=None;fixture=None
    for index,entry in enumerate(receipt['runs'],1):
        if entry['repetition']!=index or entry['folder']!=f'run-{index}' or entry['exit_code']!=0 or entry['signal'] is not None:raise ValueError('Failed/altered process')
        d=folder/entry['folder'];raw=checked(d/'results.json',entry['report_sha256']);r=json.loads(raw);csv_raw=checked(d/'trials.csv',entry['trials_sha256'],r['trials_csv']['bytes']);cr=list(csv.DictReader(io.StringIO(csv_raw.decode('utf8'))))
        if r['protocol_sha256']!=sha(protocol_raw) or r['source_publication_sha256']!=sha(source_raw) or len(r['cases'])!=20 or len(cr)!=1920:raise ValueError('Incomplete source timing coverage')
        for p,h in r['scripts'].items():
            if receipt['scripts'].get(p)!=h:raise ValueError('Timed source differs from prior receipt')
        if r['compiled_sha256']!=audit['compiled_sha256']:raise ValueError('Measured and audited compiled kernels differ')
        for name,h in r['compiled_sha256'].items():checked(d/name,h)
        f=checked(d/'query-fixture.json',r['fixture']['sha256'],r['fixture']['bytes'])
        if fixture is None:fixture=f
        if f!=fixture or json.loads(f)['points']!=[[-32+(i+.38196601125)/2,-32+(j+.61803398875)*2] for i in range(128) for j in range(32)]:raise ValueError('Fixed source query locations changed')
        if environment is None:environment=r['environment']
        if any(r['environment'][k]!=environment[k] for k in ['node','v8','platform','architecture','cpu_model','logical_cores']):raise ValueError('Same-device identity changed')
        cursor=0
        for out,c,original,a in zip(cases,r['cases'],source['cases'],audit['cases']):
            if c['id']!=original['id'] or c['reference_sha256']!=original['reference_sha256'] or c['source_raster_sha256']!=original['source_raster_sha256'] or a['id']!=c['id']:raise ValueError('Site order/source identity changed')
            if not a['byte_roundtrip'] or not a['outside_rejected'] or max(a['max_height_m'],a['max_gradient'],a['max_frozen_difference'])>=1e-9 or a['execution_points']!=[4225,8385,16641]:raise ValueError('Native source query correctness failed')
            cal=c['calibration_ms_per_4096'];loops=max(1,min(128,math.ceil(30/max(.001,min(cal[1],cal[2])))))
            if c['loops']!=loops or c['queries_per_trial']!=4096*loops or len(c['rows'])!=96:raise ValueError('Common calibrated loops changed')
            for trial,order in enumerate(orders):
                group=c['rows'][trial*4:trial*4+4]
                if tuple(v['family'] for v in group)!=order or [v['execution_order'] for v in group]!=[0,1,2,3] or any(v['trial']!=trial for v in group):raise ValueError('Balanced complete permutation order changed')
                checksum=group[0]['checksum']
                for v in group:
                    record=cr[cursor];cursor+=1
                    if v['queries']!=4096*loops or not v['elapsed_ms']>0 or not math.isfinite(v['ns_per_query']) or v['ns_per_query']!=v['elapsed_ms']*1e6/v['queries'] or abs(v['checksum']-checksum)>=1e-8*max(1,abs(checksum)):raise ValueError('Invalid timed arithmetic/checksum')
                    if record['case_id']!=c['id'] or any(record[k]!=str(v[k]) for k in ['family','trial','execution_order','queries']) or any(float(record[k])!=v[k] for k in ['elapsed_ms','ns_per_query','checksum']):raise ValueError('CSV and report timing records differ')
                    rows.append({'repetition':index,**record})
            entries=[original['models'][0],original['models'][0],next(v for v in original['models'] if v['family']=='source_p2'),original['regular_grid']]
            if [m['family'] for m in c['methods']]!=protocol['families']:raise ValueError('Missing explicit raster/frozen method')
            for m,e,points in zip(c['methods'],entries,[4225,8385,16641,4225]):
                if m['binary_bytes']!=(e.get('binary_bytes') or e['bytes']) or m['binary_sha256']!=(e.get('binary_sha256') or e['sha256']) or m['execution_points']!=points or m['correctness']['hits']!=4100 or max(m['correctness']['max_height_m'],m['correctness']['max_gradient'])>=1e-9:raise ValueError('Actual measured native file or correctness differs')
                values=[v['ns_per_query'] for v in c['rows'] if v['family']==m['family']]
                if stats(values)!=m['ns_per_query']:raise ValueError('Displayed latency statistics differ')
            med=[v['ns_per_query']['median'] for v in c['methods']];ratios={'p2_over_compact':med[2]/med[0],'generic_over_compact':med[1]/med[0],'grid_over_compact':med[3]/med[0]}
            if ratios!=c['ratios']:raise ValueError('Displayed comparison ratio differs')
            out['methods']=[{k:m[k] for k in ['family','filename','binary_bytes','binary_sha256','stored_points','execution_points','primitives']} for m in c['methods']]
            out['repetitions'].append({'repetition':index,'loops':loops,'queries_per_trial':4096*loops,'latency_median_ns':dict(zip(protocol['families'],med)), 'ratios':ratios})
        if cursor!=len(cr):raise ValueError('Extra trial records')
    if len(rows)!=5760:raise ValueError('All 5760 records must be retained')
    for c in cases:
        c['ranges']={key:{'minimum':min(v['ratios'][key] for v in c['repetitions']),'maximum':max(v['ratios'][key] for v in c['repetitions']),'wins':sum(v['ratios'][key]>1 for v in c['repetitions'])} for key in ['p2_over_compact','generic_over_compact','grid_over_compact']}
    aggregate={key:{'minimum':min(c['ranges'][key]['minimum'] for c in cases),'maximum':max(c['ranges'][key]['maximum'] for c in cases),'wins':sum(c['ranges'][key]['wins'] for c in cases),'total':60} for key in ['p2_over_compact','generic_over_compact','grid_over_compact']}
    result={'schema':'gugis-source-query-display-v1','protocol_sha256':sha(protocol_raw),'receipt_sha256':sha(receipt_raw),'native_audit_sha256':sha(audit_raw),'source_publication_sha256':sha(source_raw),'failure_receipt_sha256':sha(failed_raw),'scope':protocol['scope'],'protocol':protocol,'environment':environment,'scripts':{**receipt['scripts'],**audit['scripts']},'release_scripts':{'data-pipeline/publish_source_query.py':sha(Path(__file__).read_text(encoding='utf8').replace('\r\n','\n').encode('utf8'))},'cases':cases,'aggregate':aggregate,'raw_records':5760,'repetitions':3,'site_processes':60,'native_query_calls':696120,'prior_failure':{'stage':'pre-timing output directory creation','cause':'relative path resolved under the child frontend cwd','timing_records':0,'recovery':'New complete attempt using an absolute output path; frozen scripts and protocol unchanged.'}}
    out=io.StringIO(newline='');writer=csv.DictWriter(out,fieldnames=['repetition',*cr[0]],lineterminator='\n');writer.writeheader();writer.writerows(rows)
    return result,out.getvalue().encode('utf8')
def plot(r):
    maximum=max(5,math.ceil(r['aggregate']['p2_over_compact']['maximum']));x=lambda v:230+max(0,min(maximum,v))*650/maximum
    parts=['<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="900" viewBox="0 0 1120 900"><rect width="1120" height="900" fill="white"/><g font-family="Arial,sans-serif" fill="#294d42">','<text x="24" y="34" font-size="21">Actual DTM native CPU query: 20 windows / 3 fresh processes</text>','<text x="24" y="62" font-size="13">Exact P2 latency median / compact ruled median. All 60 process/site measurements retained.</text>']
    for v in range(maximum+1):parts.append(f'<path d="M{x(v):.2f} 85 V756" stroke="#e2e8e3"/><text x="{x(v):.2f}" y="778" font-size="12" text-anchor="middle">{v}</text>')
    for i,c in enumerate(r['cases']):
        y=100+32*i;rg=c['ranges']['p2_over_compact'];parts.append(f'<text x="24" y="{y+4}" font-size="11">{html.escape(c["id"])}</text><path d="M{x(rg["minimum"]):.2f} {y} H{x(rg["maximum"]):.2f}" stroke="#acd0c3" stroke-width="4"/>')
        for j,run in enumerate(c['repetitions']):parts.append(f'<circle cx="{x(run["ratios"]["p2_over_compact"]):.2f}" cy="{y-3+j*3}" r="3.3" fill="{["#267e6a","#577890","#b68b47"][j]}"/>')
        parts.append(f'<text x="905" y="{y+4}" font-size="12">{rg["minimum"]:.3f} to {rg["maximum"]:.3f} x</text>')
    grid=r['aggregate']['grid_over_compact'];parts.extend([f'<text x="24" y="812" font-size="13">Implicit Float32 grid / compact ratio: {grid["minimum"]:.3f} to {grid["maximum"]:.3f}; &lt;1 means grid is faster.</text>','<text x="24" y="840" font-size="12">Same source-relative bilinear height and gradient. Balanced 24 orders / 5760 raw records. Observed ranges, not CIs.</text>','<text x="24" y="867" font-size="12">Same-device Node CPU only. API metadata differs for raster. Not ArcGIS software, GPU, heap RAM or surveyed accuracy.</text>','</g></svg>'])
    return ('\n'.join(parts)+'\n').encode('utf8')
def publish(folder,failed):
    r,trials=verify(folder,failed)
    if DEST.exists() or SUMMARY.exists():raise ValueError('Immutable source-query version already exists')
    DEST.mkdir()
    for name in ['protocol.json','run-receipt.json','native-audit.json']:shutil.copyfile(folder/name,DEST/name)
    shutil.copyfile(failed/'run-receipt.json',DEST/'failed-before-timing-receipt.json');shutil.copyfile(ROOT/'shared/source-native-bands-v1.json',DEST/'source-publication.json')
    for index in range(1,4):
        d=DEST/f'run-{index}';d.mkdir()
        for name in ['results.json','trials.csv','query-fixture.json','compact.mjs','frozen.mjs']:shutil.copyfile(folder/f'run-{index}'/name,d/name)
    source=json.loads((ROOT/'shared/source-native-bands-v1.json').read_bytes())
    for c in source['cases']:
        d=DEST/'models'/c['id'];d.mkdir(parents=True)
        for e in [c['models'][0],next(v for v in c['models'] if v['family']=='source_p2'),c['regular_grid']]:
            name=e.get('binary_filename',e['filename']);src=ROOT/'frontend/public/research/source-native-bands-v1'/c['id']/name;checked(src,e.get('binary_sha256',e['sha256']),e.get('binary_bytes',e['bytes']));shutil.copyfile(src,d/name)
    for p in [*r['scripts'],'data-pipeline/publish_source_query.py','data-pipeline/source_query_protocol.json']:
        d=DEST/'implementation'/p;d.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/p,d)
    (DEST/'all-trials.csv').write_bytes(trials);r['trials_sha256']=sha(trials);figure=plot(r);(DEST/'source-query-results.svg').write_bytes(figure);r['figure_sha256']=sha(figure)
    audit={'schema':'gugis-source-query-release-audit-v1','records':5760,'source_sites':20,'fresh_processes':3,'site_processes':60,'native_query_calls':696120,'complete_balanced_orders':True,'all_files_sha_checked':True,'frozen_source_preserved':True,'retained_pre_timing_failure':True};(DEST/'release-audit.json').write_bytes(packed(audit));r['release_audit_sha256']=sha(packed(audit))
    raw=packed(r);(DEST/'results.json').write_bytes(raw)
    (DEST/'README.txt').write_text('Complete same-device CPU study, every one of 20 source windows in three fresh sequential Node processes, balanced four-method trial order. All 5760 raw records, native binary models, source identity, kernels, decoded-query proof and the pre-timing failed attempt retained. Use an ABSOLUTE output directory to replay repeat-source-query.mjs. Grid storage/speed controls explicit. Observed ranges are not confidence intervals. No paper-author, ArcGIS software, GPU, surveyed-truth or heap-memory superiority claim.\n',encoding='utf8')
    package=DEST/'source-query-evidence.zip'
    with zipfile.ZipFile(package,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        for p in sorted(DEST.rglob('*')):
            if p.is_file() and p!=package:
                info=zipfile.ZipInfo(p.relative_to(DEST).as_posix(),date_time=(2026,10,6,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,p.read_bytes(),compresslevel=9)
    publication={**r,'report_sha256':sha(raw),'package':{'filename':package.name,'bytes':package.stat().st_size,'sha256':sha(package.read_bytes())}};(DEST/'publication.json').write_bytes(packed(publication));SUMMARY.write_bytes(packed(publication));print(json.dumps({'aggregate':r['aggregate'],'records':5760,'package':publication['package']}))
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('folder',type=Path);p.add_argument('failed',type=Path);p.add_argument('--verify-only',action='store_true');a=p.parse_args()
    if a.verify_only:verify(a.folder,a.failed);print('All 5760 CPU records, complete sources, methods and native audit verified')
    else:publish(a.folder,a.failed)
