"""Build a bounded read-only render cache from one validated CityDocument snapshot."""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from app.services.render_tiles import RenderPackageError, TileLimits, build_package
from app.services.city_workspaces import CITY_DEFAULTS


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path, help='One immutable source snapshot; never modified')
    parser.add_argument('--city', required=True, choices=sorted(CITY_DEFAULTS))
    parser.add_argument('--output', type=Path, default=ROOT / '.local' / 'render-cache', help='Cache root (not a city document)')
    parser.add_argument('--tile-size', type=float, default=250)
    parser.add_argument('--max-buildings', type=int, default=256)
    parser.add_argument('--max-primitives', type=int, default=12000)
    parser.add_argument('--max-bytes', type=int, default=2 * 1024 * 1024)
    parser.add_argument('--max-tiles', type=int, default=20000)
    args = parser.parse_args()
    try:
        manifest = build_package(args.input, args.output, args.city, tile_size_m=args.tile_size,
            limits=TileLimits(args.max_buildings, args.max_primitives, args.max_bytes, args.max_tiles))
    except (RenderPackageError, OSError) as error:
        parser.exit(2, f'Render package was not published: {error}\n')
    print(json.dumps({'city_id': args.city, 'revision': manifest['revision'],
        'package_sha256': manifest['package_sha256'], 'source_bytes': manifest['source_byte_length'],
        'counts': manifest['counts'], 'max_tile_bytes': max((t['byte_length'] for t in manifest['tiles']), default=0),
        'manifest_bytes': (args.output / args.city / manifest['revision'] / 'manifest.json').stat().st_size,
        'path': str(args.output / args.city / manifest['revision'])}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
