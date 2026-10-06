"""Deduplicate selected native receipts without changing fixed scientific evidence."""
import argparse,hashlib,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
INPUT=ROOT/'shared/diagonal-hybrid-display-v1.json'
OUTPUT=ROOT/'shared/diagonal-hybrid-ui-v1.json'
def sha(b):return hashlib.sha256(b).hexdigest()
def derive():
    raw=INPUT.read_bytes();s=json.loads(raw);base=ROOT/'frontend/public/research/diagonal-hybrid-v1'
    if raw!=(base/'publication.json').read_bytes() or sha((base/'results.json').read_bytes())!=s['report_sha256']:raise ValueError('Immutable publication changed')
    v={k:s[k] for k in ['native_models','native_queries','seam_height_pairs','report_sha256','package']}
    v.update(schema='gugis-diagonal-hybrid-ui-v1',source_summary_sha256=sha(raw),cases=[]);checked=set()
    fields=['method','binary_filename','binary_bytes','binary_sha256','nx','ny','ruled_cells','p1_triangles','stored_points','e2_m2','continuous_bound_m']
    for c in s['cases']:
        site={k:c[k] for k in ['id','name','origin_bng','regular_grid']};site['models']={}
        # The immutable source publication stores a filename, not a browser URL.
        source_url='/research/source-native-bands-v1/'+c['id']+'/'+c['regular_grid']['filename']
        source_bytes=(ROOT/'frontend/public'/source_url.lstrip('/')).read_bytes()
        if len(source_bytes)!=c['regular_grid']['bytes'] or sha(source_bytes)!=c['regular_grid']['sha256']:raise ValueError('Original native source grid changed')
        site['regular_grid']={**c['regular_grid'],'url':source_url}
        def receipt(e,previous=False):
            if e is None:return None
            model_id=('prior:' if previous else 'local:')+e['binary_filename'][:-4]
            entry={k:e[k] for k in fields};entry.update(minus_cells=e.get('minus_cells',e['p1_triangles']//2),plus_cells=e.get('plus_cells',0),previous=previous)
            if model_id in site['models'] and site['models'][model_id]!=entry:raise ValueError('Conflicting model receipts')
            site['models'][model_id]=entry
            p=(ROOT/'frontend/public/research/hybrid-source-v1' if previous else base)/c['id']/e['binary_filename']
            if p not in checked:
                b=p.read_bytes()
                if len(b)!=e['binary_bytes'] or sha(b)!=e['binary_sha256']:raise ValueError('Selected native file changed')
                checked.add(p)
            return model_id
        for group,key in [('byte_pairs','byte_ceiling'),('target_pairs','height_target_m')]:
            site[group]=[{key:r[key],**{m:receipt(r[m]) for m in ['p1-local','hybrid-local']},'prior':{m:receipt(r['prior'][m],True) for m in ['p1','ruled','hybrid']}} for r in c[group]]
        v['cases'].append(site)
    return (json.dumps(v,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n').encode('utf8')
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--check',action='store_true');a=parser.parse_args();b=derive()
    if a.check:
        if OUTPUT.read_bytes()!=b:raise ValueError('Compact view changed')
    else:OUTPUT.write_bytes(b)
    print(f'Complete deduplicated UI receipts: {len(b)} bytes')
