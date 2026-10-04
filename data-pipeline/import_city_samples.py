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
from app.services.workspace_catalog import CITY_NAMES
from acquire_city_samples import atomic_new


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--city', choices=[*CITY_NAMES, 'all'], default='all')
    parser.add_argument('--source-dir', type=Path, default=ROOT / 'backend/data/cities')
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'backend/data/cities')
    args = parser.parse_args()
    selected = ['london', 'birmingham'] if args.city == 'all' else [args.city]
    # "all" retains its original two-source meaning. New city imports are
    # explicit, and an output directory cannot silently replace city seeds.
    for city_id in selected:
        if any((args.output_dir / name).exists() for name in
               [f'{city_id}.gugis.json', f'{city_id}-import.json']):
            parser.error(f'{city_id} output exists; choose a new staging directory')
    for city_id in selected:
        city, report = load_sample(args.source_dir / f'{city_id}-osm.json',
                                  args.source_dir / f'{city_id}-source.json', city_id)
        content = archive_bytes(city)
        report.update(gugis_bytes=len(content), gugis_sha256=hashlib.sha256(content).hexdigest())
        args.output_dir.mkdir(parents=True, exist_ok=True)
        atomic_new(args.output_dir / f'{city_id}.gugis.json', content)
        atomic_new(args.output_dir / f'{city_id}-import.json',
            (json.dumps(report, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))
        print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
