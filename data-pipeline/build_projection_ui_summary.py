"""Small normalized fitting view, strictly bound to immutable native evidence."""
import argparse,hashlib,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];OUTPUT=ROOT/'shared/paper-projection-ui-v1.json'
def sha(b):return hashlib.sha256(b).hexdigest()
def derive():
    raw=(ROOT/'shared/paper-projection-display-v1.json').read_bytes();r=json.loads(raw);base=ROOT/'frontend/public/research/paper-projection-stable-v1';audit_raw=(ROOT/'shared/paper-projection-prototype-audit-v1.json').read_bytes();audit=json.loads(audit_raw)
    if raw!=(base/'publication.json').read_bytes() or sha((base/'results.json').read_bytes())!=r['report_sha256'] or audit['parent_report_sha256']!=r['report_sha256']:raise ValueError('Fitting/prototype evidence changed')
    view={k:r[k] for k in ['native_models','native_queries','seam_pairs','report_sha256','package']};view.update(schema='gugis-paper-projection-ui-v1',source_summary_sha256=sha(raw),prototype_audit=audit,prototype_audit_summary_sha256=sha(audit_raw),cases=[]);validated=set()
    for c in r['cases']:
        site={k:c[k] for k in ['id','name','field','angle_degrees','source_frame']};site['models']={};site['pairs']=[]
        for p in c['pairs']:
            row={'budget':p['budget']}
            for method,key,previous in [('p1','p1',True),('before','mean_hessian',True),('p2','p2',True),('pt','pt',False),('fitted','c0-stable',False)]:
                e=p['prior'][key] if previous else p[key];model_id=('prior:' if previous else 'local:')+e['filename'][:-5];entry={k:e[k] for k in ['binary_filename','binary_bytes','binary_sha256','e2_m2']};entry.update(previous=previous,method=method,points=e['controls'] if previous else e['points'],records=e['patches'])
                if method=='fitted':entry['fit']={k:e['solver'][k] for k in ['accepted','fallback_reason','active_controls','weak_controls_held_at_original_z','inactive_controls_held_at_original_z','iterations','relative_restricted_galerkin_residual']}
                site['models'][model_id]=entry;row[method]=model_id;path=(ROOT/'frontend/public/research/variable-curvature-v1' if previous else base)/c['id']/e['binary_filename']
                if path not in validated:
                    b=path.read_bytes()
                    if len(b)!=e['binary_bytes'] or sha(b)!=e['binary_sha256']:raise ValueError('Selected saved native file changed')
                    validated.add(path)
            site['pairs'].append(row)
        view['cases'].append(site)
    return (json.dumps(view,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n').encode('utf8')
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--check',action='store_true');a=parser.parse_args();b=derive()
    if a.check:
        if OUTPUT.read_bytes()!=b:raise ValueError('Normalized UI view differs')
    else:OUTPUT.write_bytes(b)
    print('Complete normalized fitting view:',len(b),'bytes')
