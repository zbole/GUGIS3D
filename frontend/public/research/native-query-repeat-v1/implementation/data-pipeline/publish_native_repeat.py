"""Validate every fresh CPU repetition and publish a separate immutable version."""
import argparse,csv,hashlib,html,io,json,math,re,shutil,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
DEST=ROOT/'frontend/public/research/native-query-repeat-v1'
SUMMARY=ROOT/'shared/native-query-repeat-display-v1.json'
BASE=ROOT/'frontend/public/research/native-query-v1'
def sha(raw):return hashlib.sha256(raw).hexdigest()
def packed(obj):return (json.dumps(obj,ensure_ascii=False,indent=2,allow_nan=False)+'\n').encode('utf8')
def checked(p,h,size=None):
    b=p.read_bytes()
    if sha(b)!=h or size is not None and len(b)!=size:raise ValueError('Evidence bytes changed: '+str(p))
    return b
def median(values):
    values=sorted(values);return values[(len(values)-1)//2]
def stats(values):
    values=sorted(values);return {'median':median(values),'p10':values[math.floor((len(values)-1)*.1)],'p90':values[math.floor((len(values)-1)*.9)],'minimum':values[0],'maximum':values[-1]}
def verify(folder):
    receipt_raw=(folder/'run-receipt.json').read_bytes();receipt=json.loads(receipt_raw);protocol_raw=checked(folder/'protocol.json',receipt['protocol_sha256']);protocol=json.loads(protocol_raw)
    if protocol_raw!=(ROOT/'data-pipeline/native_query_repeat_protocol.json').read_bytes():raise ValueError('Fixed repetition protocol changed')
    baseline_raw=checked(BASE/'results.json',protocol['baseline_report_sha256']);baseline=json.loads(baseline_raw)
    if receipt['baseline_report_sha256']!=sha(baseline_raw) or len(receipt['runs'])!=protocol['repetitions']:raise ValueError('Incomplete or changed baseline/repetitions')
    runner=checked(folder/'replay-runner.mjs',receipt['adapted_runner_sha256']).decode('utf8')
    adapted_import=re.search(r'import \{bundleWorkspaceModule\} from ("[^\n]+");\nconst build=async options=>bundleWorkspaceModule\(options.entryPoints\[0\],options.outfile\);',runner)
    adapted_root=re.search(r'const root=("[^\n]+")(,folder=process.argv\[2\],pieces=process.argv\[3\];)',runner)
    if not adapted_import or not adapted_root:raise ValueError('Missing explicit root/build adapter')
    restored=runner.replace(adapted_import.group(0),"import {build} from 'esbuild';").replace(adapted_root.group(0),"const root=fileURLToPath(new URL('../../',import.meta.url))"+adapted_root.group(2))
    if sha(restored.encode('utf8'))!=protocol['frozen_runner_sha256_lf']:raise ValueError('Timed body changed')
    audit_raw=(folder/'native-audit.json').read_bytes();audit=json.loads(audit_raw)
    if audit['receipt_sha256']!=sha(receipt_raw) or audit['queries']!=123000 or len(audit['models'])!=30:raise ValueError('Native audit coverage differs')
    scripts={**receipt['scripts'],**audit['scripts']}
    for p,h in scripts.items():
        if sha((ROOT/p).read_text(encoding='utf8').replace('\r\n','\n').encode('utf8'))!=h:raise ValueError('Repeat/audit source changed')
    cases={c['id']:{'id':c['id'],'name':c['name'],'baseline_ratio':c['ruled_vs_prepared_triangle_median_ratio'],'repetitions':[]} for c in baseline['cases']}
    all_csv=[];environments=[];verified=0;expected_audits=set()
    for index,entry in enumerate(receipt['runs'],1):
        if entry['repetition']!=index or entry['folder']!=f'run-{index}' or entry['exit_code']!=0 or entry['signal'] is not None:raise ValueError('Failed/altered run retained; cannot publish a complete release')
        directory=folder/entry['folder'];report_raw=checked(directory/'results.json',entry['report_sha256']);r=json.loads(report_raw);trial_raw=checked(directory/'trials.csv',entry['trials_sha256'],r['trials_csv']['bytes'])
        if r['piecewise_report_sha256']!=protocol['piecewise_report_sha256'] or [c['id'] for c in r['cases']]!=protocol['cases']:raise ValueError('Fixture or case order changed')
        if r['fixture']!=baseline['fixture'] or (directory/'query-fixture.json').read_bytes()!=(BASE/'query-fixture.json').read_bytes() or r['protocol']!=baseline['protocol'] or r['scripts']!=baseline['scripts']:raise ValueError('Frozen measurement/fixture protocol changed')
        for p,h in r['scripts'].items():
            if sha((ROOT/p).read_text(encoding='utf8').replace('\r\n','\n').encode('utf8'))!=h:raise ValueError('Frozen source/kernel changed')
        for name,h in audit['compiled_sha256'].items():checked(directory/name,h)
        for key in ['node','v8','platform','architecture','cpu_model','logical_cores']:
            if r['environment'][key]!=baseline['environment'][key]:raise ValueError('Same-device runtime identity changed')
        environments.append(r['environment']);csvrows=list(csv.DictReader(io.StringIO(trial_raw.decode('utf8'))))
        if len(csvrows)!=220:raise ValueError('Missing original/legacy trial records')
        cursor=0
        for c,original in zip(r['cases'],baseline['cases']):
            if not 1<=c['loops']<=128 or not 1<=c['legacy_loops']<=128 or c['queries_per_trial']!=c['loops']*4096 or len(c['rows'])!=44:raise ValueError('Calibration or trial coverage changed')
            for m,old in zip(c['methods'],original['methods']):
                for key in ['family','binary_filename','binary_bytes','binary_sha256','controls','patches','e2_m2']:
                    if m[key]!=old[key]:raise ValueError('Actual measured native fixture differs')
                if m['correctness']['hits']!=4100 or m['correctness']['requested']!=4100 or any(m['correctness'][k]>=1e-9 for k in ['max_height_m','max_gradient','max_prepared_legacy_difference']):raise ValueError('Producer native correctness failed')
                a=next(v for v in audit['models'] if (v['repetition'],v['case_id'],v['family'])==(index,c['id'],m['family']));expected_audits.add((index,c['id'],m['family']))
                if a['hits']!=4100 or not a['outside_rejected'] or a['binary_sha256']!=m['binary_sha256'] or a['max_height_m']>=1e-9 or a['max_gradient']>=1e-9:raise ValueError('Independent native correctness failed')
                for implementation in ['prepared','legacy']:
                    v=[row['ns_per_query'] for row in c['rows'] if row['family']==m['family'] and row['implementation']==implementation]
                    if stats(v)!=m[implementation+'_ns_per_query']:raise ValueError('Displayed trial statistics differ')
            pairs=[]
            for implementation,trials in [('prepared',17),('legacy',5)]:
                for trial in range(trials):
                    group=[row for row in c['rows'] if row['implementation']==implementation and row['trial']==trial]
                    order=['ruled','triangles'] if trial%2==0 else ['triangles','ruled']
                    if [row['family'] for row in group]!=order or [row['execution_order'] for row in group]!=[0,1]:raise ValueError('Alternating paired order changed')
                    for row in group:
                        count=(c['loops'] if implementation=='prepared' else c['legacy_loops'])*4096
                        if row['queries']!=count or not row['elapsed_ms']>0 or row['ns_per_query']!=row['elapsed_ms']*1e6/count or not math.isfinite(row['checksum']):raise ValueError('Invalid timing arithmetic')
                        cr=csvrows[cursor];cursor+=1
                        if cr['case_id']!=c['id'] or any(cr[k]!=str(row[k]) for k in ['implementation','family','trial','execution_order','queries']) or any(float(cr[k])!=row[k] for k in ['elapsed_ms','ns_per_query','checksum']):raise ValueError('Full report/CSV rows differ')
                        all_csv.append({'repetition':index,**cr});verified+=1
                    ordered=sorted(group,key=lambda v:0 if v['family']=='ruled' else 1);a,b=ordered
                    if abs(a['checksum']-b['checksum'])>=1e-8*max(1,abs(a['checksum'])):raise ValueError('Paired checksum differs')
                    if implementation=='prepared':pairs.append(b['ns_per_query']/a['ns_per_query'])
            ratio=c['methods'][1]['prepared_ns_per_query']['median']/c['methods'][0]['prepared_ns_per_query']['median']
            if ratio!=c['ruled_vs_prepared_triangle_median_ratio'] or stats(pairs)!=c['paired_speed_ratio']:raise ValueError('Ratio or paired diagnostics differ')
            cases[c['id']]['repetitions'].append({'repetition':index,'ratio':ratio,'ruled_median_ns':c['methods'][0]['prepared_ns_per_query']['median'],'triangles_median_ns':c['methods'][1]['prepared_ns_per_query']['median'],'paired_wins':sum(v>1 for v in pairs),'paired_losses':sum(v<1 for v in pairs),'loops':c['loops'],'queries_per_trial':c['queries_per_trial']})
        if cursor!=len(csvrows):raise ValueError('Extra trial records')
    if len(expected_audits)!=30 or verified!=660:raise ValueError('Incomplete validation')
    for c in cases.values():
        values=[v['ratio'] for v in c['repetitions']];c['minimum_ratio']=min(values);c['maximum_ratio']=max(values);c['favourable_repetitions']=sum(v>1 for v in values)
    release_scripts={'data-pipeline/publish_native_repeat.py':sha(Path(__file__).read_text(encoding='utf8').replace('\r\n','\n').encode('utf8'))}
    result={'schema':'gugis-native-query-repeat-display-v1','protocol_sha256':sha(protocol_raw),'receipt_sha256':sha(receipt_raw),'baseline_report_sha256':sha(baseline_raw),'native_audit_sha256':sha(audit_raw),'scripts':scripts,'release_scripts':release_scripts,'scope':protocol['scope'],'environment':environments[0],'repetitions':3,'cases':list(cases.values()),'raw_records':verified,'prepared_pairs':255,'native_queries':audit['queries']}
    output=io.StringIO(newline='');writer=csv.DictWriter(output,fieldnames=['repetition',*csvrows[0].keys()],lineterminator='\n');writer.writeheader();writer.writerows(all_csv)
    return result,output.getvalue().encode('utf8'),{'schema':'gugis-native-query-repeat-release-audit-v1','verified_records':verified,'verified_runs':3,'verified_cases':15,'native_models':30,'native_queries':audit['queries'],'timed_body_unchanged':True,'same_device_identity':True,'baseline_unchanged':True,'full_csv_consistent':True}
def plot(report):
    colours=['#267e6a','#54768b','#b78e50'];parts=['<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="650" viewBox="0 0 1100 650"><rect width="1100" height="650" fill="white"/>','<g fill="#294d42" font-family="Arial,sans-serif"><text x="28" y="36" font-size="20">Native CPU query repetitions: three fresh Node processes</text><text x="28" y="64" font-size="13">All five fixed exact-function fixtures / 17 paired prepared trials per case and process / unchanged timing body.</text>']
    left=270;right=820;lo=.9;hi=1.5;x=lambda v:left+(right-left)*(v-lo)/(hi-lo)
    for v in [.9,1,1.1,1.2,1.3,1.4,1.5]:parts.append(f'<path d="M{x(v):.2f} 100 V490" stroke="{chr(35)}dde5df"/><text x="{x(v):.2f}" y="515" text-anchor="middle" font-size="12">{v:.2f}</text>')
    for i,c in enumerate(report['cases']):
        y=125+73*i;parts.append(f'<text x="28" y="{y+8}" font-size="14">{html.escape(c["id"])}</text><path d="M{x(c["minimum_ratio"]):.2f} {y} H{x(c["maximum_ratio"]):.2f}" stroke="#cad9d1" stroke-width="5"/>')
        for j,r in enumerate(c['repetitions']):parts.append(f'<circle cx="{x(r["ratio"]):.2f}" cy="{y+(-9+9*j)}" r="5" fill="{colours[j]}"/>')
        parts.append(f'<text x="850" y="{y+8}" font-size="13">{c["minimum_ratio"]:.3f}–{c["maximum_ratio"]:.3f} ×</text>')
    for i,colour in enumerate(colours):parts.append(f'<circle cx="{28+230*i}" cy="554" r="5" fill="{colour}"/><text x="{42+230*i}" y="558" font-size="13">Fresh process {i+1}</text>')
    parts+=['<text x="270" y="538" font-size="12">Triangle latency median / ruled latency median (&gt;1 favours ruled)</text>','<text x="28" y="591" font-size="12">Observed three-process ranges, not confidence intervals. All measurements retained; no fastest-run selection.</text>','<text x="28" y="616" font-size="12">Same Windows i7-14650HX / Node v24.13.0. Background OS load uncontrolled; no GPU or ArcGIS software claim.</text>','</g></svg>']
    return ('\n'.join(parts)+'\n').encode('utf8')
def publish(folder):
    r,trials,audit=verify(folder)
    if DEST.exists() or SUMMARY.exists():raise ValueError('Immutable repetition version already exists')
    DEST.mkdir();shutil.copyfile(folder/'protocol.json',DEST/'protocol.json');shutil.copyfile(folder/'run-receipt.json',DEST/'run-receipt.json');shutil.copyfile(folder/'replay-runner.mjs',DEST/'replay-runner.mjs');shutil.copyfile(folder/'native-audit.json',DEST/'native-audit.json');shutil.copyfile(BASE/'results.json',DEST/'original-results.json')
    old=json.loads((ROOT/'shared/native-query-performance-v1.json').read_bytes());checked(BASE/old['package']['filename'],old['package']['sha256'],old['package']['bytes']);shutil.copyfile(BASE/old['package']['filename'],DEST/'original-native-query-evidence.zip')
    for run in json.loads((folder/'run-receipt.json').read_bytes())['runs']:
        out=DEST/run['folder'];out.mkdir()
        for name in ['results.json','trials.csv','query-fixture.json','prepared.mjs','frozen.mjs']:shutil.copyfile(folder/run['folder']/name,out/name)
    for p in [*r['scripts'],'data-pipeline/native_query_repeat_protocol.json','data-pipeline/publish_native_repeat.py','frontend/scripts/benchmark-order-query.mjs','frontend/src/compare/preparedOrderQuery.ts','frontend/src/compare/terrainOrderMath.ts','frontend/src/compare/curvedRuledMath.ts']:
        dest=DEST/'implementation'/p;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/p,dest)
    (DEST/'all-trials.csv').write_bytes(trials);r['trials_sha256']=sha(trials);figure=plot(r);(DEST/'native-repeat-results.svg').write_bytes(figure);r['figure_sha256']=sha(figure)
    (DEST/'release-audit.json').write_bytes(packed(audit));r['release_audit_sha256']=sha(packed(audit));raw=packed(r);(DEST/'results.json').write_bytes(raw)
    (DEST/'README.txt').write_text('All three fresh-process repetitions and all five fixed cases retained. Observed ranges are not confidence intervals. Same native CPU source functions, unchanged original timing body, bounded workspace build adapter. Original public evidence preserved. Native audit rebuilds exact compiled kernels and checks 123000 points. Not GPU, ArcGIS, paper-author timing or cross-device guarantees.\n',encoding='utf8')
    package=DEST/'native-repeat-evidence.zip'
    with zipfile.ZipFile(package,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        for p in sorted(DEST.rglob('*')):
            if p.is_file() and p!=package:
                info=zipfile.ZipInfo(p.relative_to(DEST).as_posix(),date_time=(2026,10,6,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,p.read_bytes(),compresslevel=9)
    publication={**r,'report_sha256':sha(raw),'package':{'filename':package.name,'bytes':package.stat().st_size,'sha256':sha(package.read_bytes())}};summary=packed(publication);(DEST/'publication.json').write_bytes(summary);SUMMARY.write_bytes(summary)
    print(json.dumps({'cases':len(r['cases']),'repetitions':3,'records':r['raw_records'],'package':publication['package']},ensure_ascii=False))
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('folder',type=Path);parser.add_argument('--verify-only',action='store_true');args=parser.parse_args()
    if args.verify_only:verify(args.folder);print('All fixed timing records, source pins, native audit and ratios verified')
    else:publish(args.folder)
