"""Create a small, byte-bound result view; keep complete research evidence intact."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
MODEL_KEYS=('family','target_m','filename','bytes','sha256','points','patches',
            'native_triangles','ruled_quads','e2_m2','rms_integral_m',
            'continuous_bound_m','target_met','integrated_area_m2')
CASE_KEYS=('id','city_id','site_id','source_raster_sha256')

def result_view(content):
    report=json.loads(content)
    cases=[]
    for case in report['cases']:
        record={k:case[k] for k in CASE_KEYS}
        record['models']=[]
        for model in case['models']:
            row={k:model[k] for k in MODEL_KEYS}
            if 'multipatch' in model:
                mp=model['multipatch']
                row['multipatch']={k:mp[k] for k in ('five_component_bytes','exact_xyz_and_parts','files')}
            record['models'].append(row)
        cases.append(record)
    return {'schema':'gugis-terrain-result-view-v1',
            'publication_sha256':hashlib.sha256(content).hexdigest(),
            'builder_sha256':hashlib.sha256(Path(__file__).read_bytes().replace(b'\r\n',b'\n')).hexdigest(),
            'targets_m':report['targets_m'],'cases':cases,'packages':report['packages'],
            'scope':'Display subset only; original report, models, query and geometry evidence remain unchanged and downloadable.'}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('publication',type=Path);p.add_argument('output',type=Path);a=p.parse_args()
    if a.output.exists():raise FileExistsError('Keep existing display receipt; choose a new version')
    raw=a.publication.read_bytes()
    a.output.write_bytes((json.dumps(result_view(raw),ensure_ascii=False,separators=(',',':'))+'\n').encode())
    print(f'View {a.output.stat().st_size} / complete publication {len(raw)} bytes')
