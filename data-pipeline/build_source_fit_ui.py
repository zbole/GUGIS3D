"""Small immutable UI transport; full report/models/receipts remain separately published."""
import argparse,json
from source_band_benchmark import ROOT,sha,packed
SOURCE=ROOT/'shared/source-global-fit-display-v1.json';OUTPUT=ROOT/'shared/source-global-fit-ui-v1.json'
FIELDS=['method','binary_filename','binary_bytes','binary_sha256','e2_m2','continuous_bound_m','ruled_cells','p1_triangles','original_e2_m2']
def derive():
    raw=SOURCE.read_bytes();s=json.loads(raw);cases=[]
    for c in s['cases']:
        site={k:c[k] for k in ['id','name','origin_bng','regular_grid','byte_pairs','target_pairs']};site['models']={id:[e.get(k) for k in FIELDS] for id,e in c['models'].items()};cases.append(site)
    return {'schema':'gugis-source-global-fit-ui-v1','source_summary_sha256':sha(raw),'report_sha256':s['report_sha256'],'fields':FIELDS,'native_models':s['native_models'],'native_queries':s['native_queries'],'seam_height_pairs':s['seam_height_pairs'],'aggregates':s['aggregates'],'cases':cases,'package':s['package']}
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--check',action='store_true');a=p.parse_args();b=packed(derive())
    if a.check:
        if OUTPUT.read_bytes()!=b:raise ValueError('Compact shared-fit UI differs from complete publication')
    else:
        if OUTPUT.exists():raise FileExistsError('Immutable UI transport already exists')
        OUTPUT.write_bytes(b)
    print('Complete-model-derived UI transport: '+str(len(b))+' bytes')
