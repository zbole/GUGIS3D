"""Read-only fresh-process catalogue CPU measurements; never initializes cities."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
CHILD = '''
import hashlib,json,sys,time
from pathlib import Path
sys.path.insert(0,'backend')
from app.services import city_workspaces
from app.routers import city
if sys.argv[1]=='seeds':
 city.CITY_DIR=Path('.local/benchmark/catalog-empty-workspace/city')
if sys.argv[2]=='full':
 try:
  from app.services import seed_summaries
  seed_summaries.trusted_seed_summary=lambda *args:None
 except ImportError: pass
start=time.perf_counter()
result=city_workspaces.catalog()
elapsed=(time.perf_counter()-start)*1000
payload=json.dumps(result,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()
print(json.dumps({'ms':elapsed,'response_sha256':hashlib.sha256(payload).hexdigest(),
 'cities':[{k:r[k] for k in ['id','status','data_origin','building_count','road_count','data_revision']} for r in result['cities']]}))
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=['full', 'trusted'], required=True)
    parser.add_argument('--scope', choices=['seeds', 'current'], required=True)
    parser.add_argument('--repeats', type=int, default=3)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if not 1 <= args.repeats <= 5:
        parser.error('repeats must be 1..5')
    records = []
    for index in range(args.repeats):
        output = subprocess.check_output([sys.executable, '-c', CHILD, args.scope, args.mode], cwd=ROOT)
        record = json.loads(output)
        records.append(record)
        print(json.dumps({'trial': index+1, 'ms': record['ms'], 'sha256': record['response_sha256']}), flush=True)
    assert len({r['response_sha256'] for r in records}) == 1
    payload = {'schema': 'gugis-catalog-cold-cpu-v1', 'mode': args.mode, 'scope': args.scope,
               'timing': 'Fresh Python process; import/startup excluded; first read-only catalogue call; OS file cache uncontrolled',
               'records': records,
               'median_ms': sorted(r['ms'] for r in records)[len(records)//2],
               'script_sha256': hashlib.sha256(Path(__file__).read_text('utf-8').replace('\r\n','\n').encode()).hexdigest()}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes((json.dumps(payload, ensure_ascii=False, indent=2)+'\n').encode())
    print(json.dumps({'median_ms': payload['median_ms'], 'output': str(args.output)}))


if __name__ == '__main__':
    main()
