"""Independent exhaustive selection/dominance audit; does not import the producer."""
import csv, hashlib, io, json, math
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
METHOD_PACKAGES={'p1':'variable-curvature-v1','before':'variable-curvature-v1','p2':'variable-curvature-v1','fixed_pt':'paper-projection-stable-v1','fitted':'paper-projection-stable-v1','adaptive_pt':'paper-adaptive-projection-v1'}
def digest(b):return hashlib.sha256(b).hexdigest()

def verify(folder):
    raw=(folder/'results.json').read_bytes();r=json.loads(raw)
    protocol=(folder/'protocol.json').read_bytes();p=json.loads(protocol)
    if digest(protocol)!=r['protocol_sha256'] or protocol!=(ROOT/'data-pipeline/paper_frontier_protocol.json').read_bytes().replace(b'\r\n',b'\n'):
        raise ValueError('Fixed protocol changed')
    source=(ROOT/p['input']).read_bytes()
    if digest(source)!=p['input_sha256'] or digest(source)!=r['source_report_sha256']:
        raise ValueError('Immutable source evidence changed')
    src=json.loads(source)
    if [c['id'] for c in src['cases']]!=[c['id'] for c in r['cases']] or len(r['cases'])!=14:
        raise ValueError('All fourteen original cases required')
    stream=io.StringIO(newline='');writer=csv.writer(stream,lineterminator='\n')
    writer.writerow(['case_id','mode','threshold','method','status','native_file','full_bytes','E2_m2','original_N'])
    expected_files={};selection_count=0;dominance_count=0
    summary={f:{mode:{k:0 for k in ['wins','ties','losses','only_fitted','only_adaptive','neither']} for mode in ['byte_rows','error_rows']} for f in ['anisotropic-quartic','published-quartic']}
    for original,c in zip(src['cases'],r['cases']):
        if [x['budget'] for x in original['pairs']]!=p['original_N'] or any(c[k]!=original[k] for k in ['id','name','field','source_frame','angle_degrees']):raise ValueError('Source case/provenance changed')
        models={};provenance={};by_method={}
        for method in p['methods']:
            for row in original['pairs']:
                e=row[method];key=method+':'+e['binary_filename'][:-4]
                item={'method':method,'package':METHOD_PACKAGES[method],'previous':METHOD_PACKAGES[method]=='variable-curvature-v1','binary_filename':e['binary_filename'],'binary_bytes':e['binary_bytes'],'binary_sha256':e['binary_sha256'],'e2_m2':e['e2_m2'],'points':e.get('points',e.get('controls')),'records':e['patches']}
                if key in models and models[key]!=item:raise ValueError('Conflicting duplicate')
                models[key]=item;provenance.setdefault(key,[]).append(row['budget'])
                if not math.isfinite(item['e2_m2']) or item['e2_m2']<0:raise ValueError('Invalid finite error')
                for fn,n,h in [(e['filename'],e['bytes'],e['sha256']),(e['binary_filename'],e['binary_bytes'],e['binary_sha256'])]:
                    path=Path(METHOD_PACKAGES[method])/c['id']/fn;b=(ROOT/'frontend/public/research'/path).read_bytes()
                    if len(b)!=n or digest(b)!=h:raise ValueError('Saved native evidence corrupt')
                    expected_files[path.as_posix()]={'bytes':n,'sha256':h}
            by_method[method]=sorted([k for k,v in models.items() if v['method']==method],key=lambda k:(models[k]['binary_bytes'],models[k]['e2_m2'],k))
        if models!=c['models'] or provenance!=c['provenance'] or by_method!=c['candidates']:raise ValueError('Complete candidate archive changed')
        for method,keys in by_method.items():
            kept=[]
            for key in keys:
                better=[]
                for other in keys:
                    a,b=models[key],models[other]
                    if (b['binary_bytes'],b['e2_m2'])!=(a['binary_bytes'],a['e2_m2']) and b['binary_bytes']<=a['binary_bytes'] and b['e2_m2']<=a['e2_m2']:better.append(other)
                    dominance_count+=1
                if not better:kept.append(key)
            if kept!=c['frontiers'][method]:raise ValueError('Incorrect dominance pruning')
        for mode,threshold,values,admissibility,objective,tie in [('byte_rows','ceiling_bytes',p['byte_ceilings'],'binary_bytes','e2_m2','binary_bytes'),('error_rows','target_e2_m2',p['e2_targets_m2'],'e2_m2','binary_bytes','e2_m2')]:
            if [row[threshold] for row in c[mode]]!=values:raise ValueError('All fixed thresholds required')
            for row in c[mode]:
                if set(row['selected'])!=set(p['methods']):raise ValueError('All six controls required')
                for method in p['methods']:
                    admissible=sorted([key for key in by_method[method] if models[key][admissibility]<=row[threshold]],key=lambda key:(models[key][objective],models[key][tie],models[key]['binary_filename']))
                    chosen=admissible[0] if admissible else None
                    if row['selected'][method]!=chosen:raise ValueError('Selection violates complete finite minimum')
                    e=models.get(chosen);writer.writerow([c['id'],mode,row[threshold],method,'eligible' if e else 'no_archived_candidate',e['binary_filename'] if e else '',e['binary_bytes'] if e else '',e['e2_m2'] if e else '',','.join(map(str,provenance[chosen])) if e else ''])
                    selection_count+=1
                f,a=[models.get(row['selected'][k]) for k in ['fitted','adaptive_pt']]
                if not f or not a:label='only_fitted' if f else 'only_adaptive' if a else 'neither'
                else:label='wins' if f[objective]<a[objective] else 'ties' if f[objective]==a[objective] else 'losses'
                summary[c['field']['id']][mode][label]+=1
    if expected_files!=r['source_files'] or summary!=r['summary'] or stream.getvalue().encode('utf8')!=(folder/'all-decisions.csv').read_bytes():raise ValueError('Complete files, summary or CSV differs')
    return {'schema':'gugis-paper-finite-frontier-audit-v1','report_sha256':digest(raw),'source_report_sha256':digest(source),'complete_source_files':len(expected_files),'exhaustive_selections':selection_count,'dominance_pairs':dominance_count,'all_cases':14,'all_controls':6,'summary':summary,'scope':'Independent decisions on earlier independently audited native errors; no new performance measurements or fitting.'}

if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('folder',type=Path);args=parser.parse_args()
    print(json.dumps(verify(args.folder)))
