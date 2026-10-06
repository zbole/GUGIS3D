"""Validate every seed in the deployment runtime, then pin that local receipt."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[2]
subprocess.run([sys.executable, str(root/'data-pipeline/build_seed_summaries.py')],
               cwd=root, check=True)
receipt = root/'backend/data/cities/validated-seed-summaries.json'
report = json.loads(receipt.read_bytes())
if not report['records'] or any(r['summary']['corrupt'] for r in report['records']):
    raise RuntimeError('Deployment seed validation failed')
source = root/'backend/app/services/seed_summaries.py'
lines = source.read_text('utf-8').replace('\r\n', '\n').splitlines()
if sum(line.startswith('RECEIPT_SHA256 = ') for line in lines) != 1:
    raise RuntimeError('Expected one explicit receipt pin')
digest = hashlib.sha256(receipt.read_bytes()).hexdigest()
source.write_text('\n'.join("RECEIPT_SHA256 = '"+digest+"'" if line.startswith(
    'RECEIPT_SHA256 = ') else line for line in lines)+'\n', encoding='utf-8')
print(json.dumps({'runtime': report['runtime'], 'validated_cities': len(report['records']),
                  'deployment_receipt_sha256': digest}))
