"""A lean UI view derived only from the complete immutable published manifest."""
import argparse,hashlib,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUTPUT=ROOT/'shared/paper-coordinate-sharing-display-v1.json'
def body():
    raw=(ROOT/'shared/paper-coordinate-sharing-v1.json').read_bytes();view=json.loads(raw)
    for case in view['cases']:
        for entry in case['models'].values():entry['original']={key:entry['original'][key] for key in ('binary_sha256','binary_bytes')}
    view['schema']='gugis-paper-coordinate-sharing-display-v1';view['source_manifest_sha256']=hashlib.sha256(raw).hexdigest()
    return (json.dumps(view,ensure_ascii=False,separators=(',',':'))+'\n').encode()
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--check',action='store_true');args=p.parse_args();blob=body()
    if args.check:
        if OUTPUT.read_bytes()!=blob:raise ValueError('Display differs from immutable full manifest')
    else:
        with OUTPUT.open('xb') as handle:handle.write(blob)
    print(f'Complete-result UI view verified: {len(blob)} bytes')
