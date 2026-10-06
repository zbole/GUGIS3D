"""Attach an exhaustive prototype validity audit without rewriting its release."""
import argparse,csv,io,json,shutil,zipfile
from pathlib import Path
import hashlib
ROOT=Path(__file__).resolve().parents[1];DEST=ROOT/'frontend/public/research/paper-projection-prototype-audit-v1';SUMMARY=ROOT/'shared/paper-projection-prototype-audit-v1.json'
def sha(b):return hashlib.sha256(b).hexdigest()
def packed(v):return (json.dumps(v,ensure_ascii=False,sort_keys=True,indent=2,allow_nan=False)+'\n').encode('utf8')
def publish(folder):
    raw=(folder/'results.json').read_bytes();r=json.loads(raw);parent=json.loads((ROOT/'shared/paper-projection-display-v1.json').read_bytes());base=ROOT/'frontend/public/research/paper-projection-stable-v1/prototype';proto_raw=(base/'results.json').read_bytes();proto=json.loads(proto_raw)
    if sha(proto_raw)!=r['prototype_report_sha256'] or r['parent_report_sha256']!=parent['report_sha256'] or r['parent_package']!=parent['package']:raise ValueError('Parent/prototype identity changed')
    entries={(e['case_id'],e['filename']):e for e in r['models']};expected=set();pairs=[]
    for c in proto['cases']:
        for row in c['pairs']:
            pair={'case_id':c['id'],'budget':row['budget']}
            for method in ['pt','c0-l2']:
                e=row[method];binding=(c['id'],e['filename']);expected.add(binding);b=(base/c['id']/e['filename']).read_bytes();model=json.loads(b)
                if sha(b)!=e['sha256']:raise ValueError('Preserved prototype model changed')
                maximum=max(abs(v) for p in model['points'] for v in p);item=entries[binding]
                if item['binary_sha256']!=e['binary_sha256'] or item['maximum_abs_stored_coordinate_or_coefficient_m']!=maximum or item['native_valid']!=(maximum<=10000):raise ValueError('Independent coefficient / native classification differs')
                pair[method]=item['native_valid']
            pair['prototype_error_worsened']=row['c0-l2']['e2_m2']>row['prior']['mean_hessian']['e2_m2'];pairs.append(pair)
    if pairs!=r['pairs'] or expected!=set(entries) or len(entries)!=len(r['models']) or r['rejected_pairs']!=sum(not p['pt'] or not p['c0-l2'] for p in pairs) or r['source_error_worsened_pairs']!=sum(p['prototype_error_worsened'] for p in pairs):raise ValueError('Incomplete prototype audit')
    package=ROOT/'frontend/public/research/paper-projection-stable-v1'/parent['package']['filename'];b=package.read_bytes()
    if len(b)!=parent['package']['bytes'] or sha(b)!=parent['package']['sha256']:raise ValueError('Complete parent package changed')
    for file,h in r['scripts'].items():
        if sha((ROOT/file).read_bytes().replace(b'\r\n',b'\n'))!=h:raise ValueError('Native audit code changed')
    if DEST.exists() or SUMMARY.exists():raise FileExistsError('Immutable prototype audit exists')
    DEST.mkdir();(DEST/'results.json').write_bytes(raw);stream=io.StringIO(newline='');writer=csv.DictWriter(stream,fieldnames=['case_id','budget','pt','c0-l2','prototype_error_worsened'],lineterminator='\n');writer.writeheader();writer.writerows(pairs);csvraw=stream.getvalue().encode();(DEST/'pairs.csv').write_bytes(csvraw)
    scripts={**r['scripts'],'data-pipeline/publish_projection_prototype_audit.py':sha(Path(__file__).read_bytes().replace(b'\r\n',b'\n'))}
    for file,h in scripts.items():target=DEST/'implementation'/file;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/file,target)
    (DEST/'README.txt').write_text('Exhaustive validity audit of the entire unchanged prototype: 249 unique saved models / 126 fixed pairs. Native validation rejects 11 models and pairs; only two of those pairs also worsened the source integral. All rejected files remain in the complete parent evidence package. The repaired release has a separate successful native audit of all 249 models. Stored Bezier coefficients are not surveyed elevations. This supplement does not rewrite the original package, protocol, source or outcomes.\n',encoding='utf8');pack=DEST/'prototype-audit-evidence.zip'
    with zipfile.ZipFile(pack,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        for p in sorted(DEST.rglob('*')):
            if p.is_file() and p!=pack:
                info=zipfile.ZipInfo(p.relative_to(DEST).as_posix(),date_time=(2026,10,6,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,p.read_bytes(),compresslevel=9)
    summary={k:r[k] for k in ['schema','parent_report_sha256','prototype_report_sha256','native_models','valid_models','rejected_models','rejected_pairs','source_error_worsened_pairs']};summary.update(report_sha256=sha(raw),pairs_csv_sha256=sha(csvraw),scripts=scripts,parent_package=r['parent_package'],package={'filename':pack.name,'bytes':pack.stat().st_size,'sha256':sha(pack.read_bytes())});s=packed(summary);(DEST/'publication.json').write_bytes(s);SUMMARY.write_bytes(s);print(json.dumps(summary,ensure_ascii=False))
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('folder',type=Path);publish(parser.parse_args().folder)
