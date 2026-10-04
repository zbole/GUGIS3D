"""Fully validate public city seeds offline and create a bounded catalogue receipt."""
import hashlib
import json
from pathlib import Path
import sys
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from app.services import city_workspaces, seed_summaries
from app.services.workspace_catalog import CITY_DEFAULTS


def main():
    records = []
    # The builder must never reuse an old receipt while producing a new one.
    with patch.object(seed_summaries, 'trusted_seed_summary', return_value=None):
        city_workspaces._validated_summary.cache_clear()
        for city_id in CITY_DEFAULTS:
            path = ROOT / ('backend/data/bristol.gugis.json' if city_id == 'bristol'
                           else f'backend/data/cities/{city_id}.gugis.json')
            before = hashlib.sha256(path.read_bytes()).hexdigest()
            summary = city_workspaces._source_summary(path)
            if summary.get('corrupt') or summary.get('revision') != before:
                raise ValueError(f'{city_id}: seed invalid or changed during validation')
            assert hashlib.sha256(path.read_bytes()).hexdigest() == before
            records.append({'city_id': city_id, 'path': path.relative_to(ROOT).as_posix(),
                            'bytes': path.stat().st_size, 'sha256': before, 'summary': summary})
            print(json.dumps({'city_id': city_id, 'validated_buildings': summary['count']}), flush=True)
    report = {'schema': 'gugis-validated-seed-summaries-v1',
              'runtime': seed_summaries.validation_runtime(),
              'dependencies': seed_summaries.validation_dependencies(),
              'builder_sha256': hashlib.sha256(Path(__file__).read_text('utf-8').replace('\r\n', '\n').encode()).hexdigest(),
              'records': records}
    content = (json.dumps(report, ensure_ascii=False, indent=2)+'\n').encode()
    if len(content) > seed_summaries.MAX_RECEIPT_BYTES:
        raise ValueError('Receipt exceeds bounded read limit')
    # Separate immutable release artifact, never a formal city or history file.
    seed_summaries.RECEIPT_PATH.write_bytes(content)
    print(json.dumps({'receipt_bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()}))


if __name__ == '__main__':
    main()
