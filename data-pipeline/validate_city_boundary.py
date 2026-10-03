"""Make an offline integrity/structure receipt from an explicitly supplied boundary.

This does not validate topology, verify city-boundary authority or assess coverage.
"""
import argparse
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from app.services.boundary_receipts import (
    MAX_METADATA_BYTES, MAX_SOURCE_BYTES, build_receipt, publish_receipt,
    read_bounded_file, receipt_bytes,
)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--city-id', required=True, help='UK registry ID, for example uk-eng-bristol')
    parser.add_argument('--input', type=Path, required=True, help='Local single-feature GeoJSON')
    parser.add_argument('--metadata', type=Path, required=True, help='Local provenance JSON with expected source SHA-256')
    parser.add_argument('--output', type=Path, required=True, help='Separate .json file in an existing directory')
    args = parser.parse_args(argv)
    try:
        source = read_bounded_file(args.input, MAX_SOURCE_BYTES)
        metadata = read_bounded_file(args.metadata, MAX_METADATA_BYTES)
        receipt = build_receipt(source, metadata, args.city_id)
        created = publish_receipt(args.output, receipt_bytes(receipt), args.input, args.metadata)
    except (ValueError, OSError) as error:
        parser.exit(2, f'Boundary receipt rejected: {error}\n')
    print(f"{'Recorded' if created else 'Already recorded (identical)'}: {receipt['city_id']} "
          f"{receipt['checksum_sha256']}\n"
          'Integrity and structure only; topology not checked; city-boundary authority not verified; coverage not assessed.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
