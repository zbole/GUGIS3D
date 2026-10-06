"""Decision tables derived from an immutable, already observed finite archive."""
import argparse, csv, hashlib, io, json, math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROTOCOL = ROOT / 'data-pipeline/paper_frontier_protocol.json'
PACKAGES = {'p1':'variable-curvature-v1', 'before':'variable-curvature-v1', 'p2':'variable-curvature-v1', 'fixed_pt':'paper-projection-stable-v1', 'fitted':'paper-projection-stable-v1', 'adaptive_pt':'paper-adaptive-projection-v1'}

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def packed(value):
    return (json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)+'\n').encode('utf8')

def build():
    protocol_raw = PROTOCOL.read_bytes().replace(b'\r\n', b'\n')
    p = json.loads(protocol_raw)
    raw = (ROOT / p['input']).read_bytes()
    if sha(raw) != p['input_sha256']:
        raise ValueError('Immutable adaptive source report changed')
    source = json.loads(raw)
    result = {'schema':'gugis-paper-finite-frontier-results-v1', 'protocol_sha256':sha(protocol_raw), 'source_report_sha256':sha(raw), 'cases':[], 'summary':{}}
    files = {}
    for c in source['cases']:
        if [row['budget'] for row in c['pairs']] != p['original_N']:
            raise ValueError('All original nine rows required')
        case = {k:c[k] for k in ['id','name','field','source_frame','angle_degrees']}
        case.update(models={}, candidates={}, provenance={}, frontiers={}, byte_rows=[], error_rows=[])
        for method in p['methods']:
            entries = {}
            for row in c['pairs']:
                e = row[method]
                key = method+':'+e['binary_filename'][:-4]
                item = {'method':method, 'package':PACKAGES[method], 'previous':PACKAGES[method]=='variable-curvature-v1', 'binary_filename':e['binary_filename'], 'binary_bytes':e['binary_bytes'], 'binary_sha256':e['binary_sha256'], 'e2_m2':e['e2_m2'], 'points':e.get('points',e.get('controls')), 'records':e['patches']}
                if not math.isfinite(item['e2_m2']) or item['e2_m2'] < 0:
                    raise ValueError('Invalid saved error')
                if key in entries and entries[key] != item:
                    raise ValueError('Inconsistent repeated native candidate')
                entries[key] = item
                case['provenance'].setdefault(key, []).append(row['budget'])
                for filename, expected_sha, expected_bytes in [(e['binary_filename'],e['binary_sha256'],e['binary_bytes']), (e['filename'],e['sha256'],e['bytes'])]:
                    path = Path(PACKAGES[method])/c['id']/filename
                    blob = (ROOT/'frontend/public/research'/path).read_bytes()
                    if sha(blob) != expected_sha or len(blob) != expected_bytes:
                        raise ValueError('Actual complete native candidate changed: '+str(path))
                    files[path.as_posix()] = {'bytes':len(blob), 'sha256':sha(blob)}
            case['models'].update(entries)
            keys = sorted(entries, key=lambda key:(entries[key]['binary_bytes'],entries[key]['e2_m2'],key))
            case['candidates'][method] = keys
            case['frontiers'][method] = [key for key in keys if not any(other != key and entries[other]['binary_bytes'] <= entries[key]['binary_bytes'] and entries[other]['e2_m2'] <= entries[key]['e2_m2'] and (entries[other]['binary_bytes'] < entries[key]['binary_bytes'] or entries[other]['e2_m2'] < entries[key]['e2_m2']) for other in keys)]
        for ceiling in p['byte_ceilings']:
            row = {'ceiling_bytes':ceiling, 'selected':{}}
            for method, keys in case['candidates'].items():
                eligible = [key for key in keys if case['models'][key]['binary_bytes'] <= ceiling]
                row['selected'][method] = min(eligible,key=lambda key:(case['models'][key]['e2_m2'],case['models'][key]['binary_bytes'],case['models'][key]['binary_filename'])) if eligible else None
            case['byte_rows'].append(row)
        for target in p['e2_targets_m2']:
            row = {'target_e2_m2':target, 'selected':{}}
            for method, keys in case['candidates'].items():
                eligible = [key for key in keys if case['models'][key]['e2_m2'] <= target]
                row['selected'][method] = min(eligible,key=lambda key:(case['models'][key]['binary_bytes'],case['models'][key]['e2_m2'],case['models'][key]['binary_filename'])) if eligible else None
            case['error_rows'].append(row)
        result['cases'].append(case)
    for field in sorted({c['field']['id'] for c in result['cases']}):
        summary = {}
        for mode, column in [('byte_rows','e2_m2'), ('error_rows','binary_bytes')]:
            counts = {key:0 for key in ['wins','ties','losses','only_fitted','only_adaptive','neither']}
            for c in result['cases']:
                if c['field']['id'] != field:
                    continue
                for row in c[mode]:
                    f, a = row['selected']['fitted'],row['selected']['adaptive_pt']
                    if f is None or a is None:
                        key = 'only_fitted' if f is not None else 'only_adaptive' if a is not None else 'neither'
                    else:
                        fv,av = c['models'][f][column],c['models'][a][column]
                        key = 'wins' if fv < av else 'ties' if fv == av else 'losses'
                    counts[key] += 1
            summary[mode] = counts
        result['summary'][field] = summary
    result['source_files'] = files
    result['defaults'] = {key:p[key] for key in ['default_case','default_byte_ceiling','default_e2_target_m2']}
    return result, protocol_raw

def csv_bytes(result):
    stream = io.StringIO(newline='')
    writer = csv.writer(stream,lineterminator='\n')
    writer.writerow(['case_id','mode','threshold','method','status','native_file','full_bytes','E2_m2','original_N'])
    for c in result['cases']:
        for mode, threshold in [('byte_rows','ceiling_bytes'),('error_rows','target_e2_m2')]:
            for row in c[mode]:
                for method, key in row['selected'].items():
                    e = c['models'].get(key)
                    writer.writerow([c['id'],mode,row[threshold],method,'eligible' if e else 'no_archived_candidate',e['binary_filename'] if e else '',e['binary_bytes'] if e else '',e['e2_m2'] if e else '',','.join(map(str,c['provenance'][key])) if e else ''])
    return stream.getvalue().encode('utf8')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output',type=Path)
    args = parser.parse_args()
    if args.output.exists():
        raise FileExistsError('Choose a fresh output; keep earlier outcomes')
    args.output.mkdir(parents=True)
    report, protocol = build()
    (args.output/'protocol.json').write_bytes(protocol)
    (args.output/'results.json').write_bytes(packed(report))
    (args.output/'all-decisions.csv').write_bytes(csv_bytes(report))
    print(json.dumps({'cases':len(report['cases']),'source_files':len(report['source_files']),'summary':report['summary']}))
