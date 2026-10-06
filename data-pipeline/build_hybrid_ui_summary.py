"""Derive a small UI view without changing immutable hybrid research evidence."""
import argparse,hashlib,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
INPUT=ROOT/'shared/hybrid-source-display-v1.json'
OUTPUT=ROOT/'shared/hybrid-source-ui-v1.json'
def sha(raw):return hashlib.sha256(raw).hexdigest()
def derive():
    raw=INPUT.read_bytes();source=json.loads(raw);base=ROOT/'frontend/public/research/hybrid-source-v1'
    if raw!=(base/'publication.json').read_bytes() or sha((base/'results.json').read_bytes())!=source['report_sha256']:raise ValueError('Immutable hybrid evidence changed')
    view={k:source[k] for k in ['native_models','native_queries','seam_height_pairs','report_sha256','package']}
    view.update(schema='gugis-hybrid-source-ui-v1',source_summary_sha256=sha(raw),cases=[])
    fields=['method','binary_filename','binary_bytes','binary_sha256','ruled_cells','p1_triangles','stored_points','e2_m2','continuous_bound_m']
    validated=set()
    for c in source['cases']:
        site={k:c[k] for k in ['id','name','origin_bng','regular_grid','full_source_ruled_bytes']}
        for group,key in [('byte_pairs','byte_ceiling'),('target_pairs','height_target_m')]:
            rows=[]
            for row in c[group]:
                v={key:row[key]}
                for family in ['p1','ruled','hybrid']:
                    e=row[family];v[family]=None if e is None else {k:e[k] for k in fields}
                    if e is not None:
                        p=base/c['id']/e['binary_filename']
                        if p not in validated:
                            b=p.read_bytes()
                            if len(b)!=e['binary_bytes'] or sha(b)!=e['binary_sha256']:raise ValueError('Selected native file changed')
                            validated.add(p)
                rows.append(v)
            site[group]=rows
        view['cases'].append(site)
    return (json.dumps(view,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n').encode('utf8')
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--check',action='store_true');args=parser.parse_args();raw=derive()
    if args.check:
        if OUTPUT.read_bytes()!=raw:raise ValueError('Compact UI summary differs from fixed evidence')
    else:OUTPUT.write_bytes(raw)
    print(f'Exact compact view: {len(raw)} bytes; immutable evidence preserved')
