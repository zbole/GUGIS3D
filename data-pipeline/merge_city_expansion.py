"""Prepare an additive expansion for review; never overwrite a formal city."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from app.services.city_archive import load_city, archive_bytes
from app.services.city_expansion import merge_expansion
from app.services.workspace_catalog import CITY_NAMES
from acquire_city_samples import atomic_new


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--city', required=True, choices=list(CITY_NAMES))
    parser.add_argument('--baseline', required=True, type=Path)
    parser.add_argument('--incoming', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--report', required=True, type=Path)
    args = parser.parse_args()
    outputs = [args.output.resolve(), args.report.resolve()]
    if len(set(outputs)) != 2 or any(path.exists() for path in outputs):
        parser.error('Output and report must be distinct new files; existing data is never replaced')
    baseline, incoming = args.baseline.read_bytes(), args.incoming.read_bytes()
    merged, report = merge_expansion(load_city(baseline), load_city(incoming), args.city)
    content = archive_bytes(merged)
    # Canonical revisions in the merge report are distinct from exact input bytes.
    report.update(baseline_file_sha256=hashlib.sha256(baseline).hexdigest(),
                  incoming_file_sha256=hashlib.sha256(incoming).hexdigest(),
                  output_sha256=hashlib.sha256(content).hexdigest(), output_bytes=len(content),
                  total_buildings=len(merged.instances), total_roads=len(merged.roads),
                  status='prepared-for-review; no formal city or history updated')
    for path in outputs:
        path.parent.mkdir(parents=True, exist_ok=True)
    atomic_new(outputs[0], content)
    atomic_new(outputs[1], (json.dumps(report, ensure_ascii=False, indent=2)+'\n').encode('utf-8'))
    print(json.dumps({key: report[key] for key in
                     ['city_id', 'retained_buildings', 'added_buildings', 'total_buildings',
                      'total_roads', 'output_sha256', 'status']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
