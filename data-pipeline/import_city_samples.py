"""Rebuild public central-district samples from retained, hash-checked OSM sources."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from app.services.city_sample_import import load_sample
from app.services.city_archive import archive_bytes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--city', choices=['london', 'birmingham', 'all'], default='all')
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'backend/data/cities')
    args = parser.parse_args()
    for city_id in ['london', 'birmingham'] if args.city == 'all' else [args.city]:
        city, report = load_sample(ROOT / f'backend/data/cities/{city_id}-osm.json',
                                  ROOT / f'backend/data/cities/{city_id}-source.json', city_id)
        content = archive_bytes(city)
        report.update(gugis_bytes=len(content), gugis_sha256=hashlib.sha256(content).hexdigest())
        args.output_dir.mkdir(parents=True, exist_ok=True)
        (args.output_dir / f'{city_id}.gugis.json').write_bytes(content)
        (args.output_dir / f'{city_id}-import.json').write_bytes(
            (json.dumps(report, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))
        print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
