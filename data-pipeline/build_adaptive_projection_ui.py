"""Compact six-method receipts derived only from immutable adaptive-paper evidence."""
import argparse,json
from pathlib import Path
from paper_adaptive_projection_benchmark import sha
ROOT=Path(__file__).resolve().parents[1];INPUT=ROOT/'shared/paper-adaptive-projection-display-v1.json';OUTPUT=ROOT/'shared/paper-adaptive-projection-ui-v1.json'
def body():
    raw=INPUT.read_bytes();s=json.loads(raw);base=ROOT/'frontend/public/research/paper-adaptive-projection-v1'
    if raw!=(base/'publication.json').read_bytes() or sha((base/'results.json').read_bytes())!=s['report_sha256']:raise ValueError('Adaptive publication changed')
    view={k:s[k] for k in ['report_sha256','package','native_models','native_queries']};view.update(schema='gugis-paper-adaptive-projection-ui-v1',source_summary_sha256=sha(raw),cases=[]);checked=set()
    for c in s['cases']:
        site={k:c[k] for k in ['id','name','field','source_frame','angle_degrees']};site['models']={};site['pairs']=[]
        for p in c['pairs']:
            pair={'budget':p['budget']}
            for key,alias in [('p1','p1'),('fixed_pt','pt'),('adaptive_pt','adaptive'),('before','before'),('fitted','fitted'),('p2','p2')]:
                e=p[key];package='variable-curvature-v1' if key in ['p1','before','p2'] else 'paper-adaptive-projection-v1' if key=='adaptive_pt' else 'paper-projection-stable-v1';identity=alias+':'+e['binary_filename'][:-4];entry={k:e[k] for k in ['binary_filename','binary_bytes','binary_sha256','e2_m2']};entry.update(method=alias,previous=package=='variable-curvature-v1',package=package,points=e.get('points',e.get('controls')),records=e['patches'])
                if identity in site['models'] and site['models'][identity]!=entry:raise ValueError('Conflicting selected native receipt')
                site['models'][identity]=entry;pair[alias]=identity;path=ROOT/'frontend/public/research'/package/c['id']/e['binary_filename']
                if path not in checked:
                    b=path.read_bytes()
                    if len(b)!=e['binary_bytes'] or sha(b)!=e['binary_sha256']:raise ValueError('Actual native source/control changed')
                    checked.add(path)
            site['pairs'].append(pair)
        view['cases'].append(site)
    return (json.dumps(view,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n').encode('utf8')
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--check',action='store_true');a=p.parse_args();b=body()
    if a.check:
        if OUTPUT.read_bytes()!=b:raise ValueError('Compact adaptive receipts changed')
    else:OUTPUT.write_bytes(b)
    print(f'Complete six-method UI receipts: {len(b)} bytes')
