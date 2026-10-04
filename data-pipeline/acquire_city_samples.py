"""Acquire bounded, attributed OSM ways; never overwrite retained sources or local projects."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
import uuid

ROOT = Path(__file__).resolve().parents[1]
ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']
MAX_BYTES = 48 * 1024 * 1024
EXPANDED = {
    'bristol': [-2.621, 51.443, -2.587, 51.466],
    'london': [-0.151, 51.491, -0.114, 51.513],
    'birmingham': [-1.927, 52.469, -1.888, 52.494],
}


def atomic_new(path, content):
    if path.exists():
        raise FileExistsError(f'Retained source already exists; choose a new output directory: {path}')
    temporary = path.with_name(f'.{path.name}.{uuid.uuid4().hex}.tmp')
    try:
        with temporary.open('xb') as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        # Hard-link publication is atomic and exclusive on the same filesystem.
        # A failed write never leaves a partial retained source under its final name.
        os.link(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def acquire(record, output, expanded=False):
    city_id = record['id']
    paths = [output / f'{city_id}-osm.json', output / f'{city_id}-source.json']
    if any(path.exists() for path in paths):
        raise FileExistsError(f'Retained files for {city_id} already exist; nothing overwritten')
    west, south, east, north = EXPANDED[city_id] if expanded else record['query_bbox_wgs84']
    query = (f'[out:json][timeout:120][maxsize:268435456];('
             f'way["building"]({south},{west},{north},{east});'
             f'way["highway"]["name"]({south},{west},{north},{east}););out tags geom;')
    attempts = []
    for endpoint in ENDPOINTS:
        started = time.perf_counter()
        try:
            request = Request(endpoint, data=urlencode({'data': query}).encode(),
                              headers={'User-Agent': 'GUGIS3D reproducible bounded city samples',
                                       'Content-Type': 'application/x-www-form-urlencoded'})
            with urlopen(request, timeout=145) as response:
                content = response.read(MAX_BYTES + 1)
            if len(content) > MAX_BYTES:
                raise ValueError('OSM response exceeds the bounded acquisition budget')
            osm = json.loads(content)
            if not isinstance(osm, dict) or not isinstance(osm.get('elements'), list) or osm.get('remark'):
                raise ValueError('Overpass returned an incomplete or invalid result')
            ways = [item for item in osm['elements'] if item.get('type') == 'way']
            buildings = sum(bool(item.get('tags', {}).get('building')) for item in ways)
            if not buildings:
                raise ValueError('No building ways returned; no empty sample published')
            manifest = {
                'city_id': city_id, 'coverage_label': f"{record['city_name']} {'expanded district' if expanded else 'city centre'}",
                'bbox': [west, south, east, north], 'centre_lon_lat': [(west+east)/2, (south+north)/2],
                'query_bbox_south_west_north_east': [south, west, north, east], 'query': query,
                'source_url': endpoint, 'downloaded_at': datetime.now(timezone.utc).isoformat(),
                'osm_timestamp': osm.get('osm3s', {}).get('timestamp_osm_base'),
                'sha256': hashlib.sha256(content).hexdigest(), 'bytes': len(content), 'elements': len(osm['elements']),
                'building_ways': buildings, 'road_ways': sum(bool(item.get('tags', {}).get('highway')) for item in ways),
                'scope': 'Bounded district sample, not administrative or city-wide coverage; complete intersecting ways retained. Multipolygon relations, real terrain and building interiors are not acquired.',
                'licence': 'ODbL 1.0', 'licence_url': 'https://opendatacommons.org/licenses/odbl/1-0/',
                'attribution': '© OpenStreetMap contributors', 'attribution_url': 'https://www.openstreetmap.org/copyright',
                'elapsed_seconds': round(time.perf_counter()-started, 3), 'previous_attempts': attempts,
            }
            output.mkdir(parents=True, exist_ok=True)
            atomic_new(paths[0], content)
            atomic_new(paths[1], (json.dumps(manifest, ensure_ascii=False, indent=2)+'\n').encode())
            return {key: manifest[key] for key in ['city_id', 'building_ways', 'road_ways', 'bytes', 'sha256', 'source_url']}
        except (HTTPError, URLError, TimeoutError, ValueError) as error:
            attempts.append({'endpoint': endpoint, 'error': str(error)[:200]})
    raise RuntimeError(f'{city_id} acquisition failed: {attempts}')


def main():
    records = json.loads((ROOT / 'shared/city-workspaces.json').read_text(encoding='utf-8'))
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cities', nargs='+', required=True, choices=[record['id'] for record in records])
    parser.add_argument('--expanded', action='store_true')
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    if args.expanded and any(city not in EXPANDED for city in args.cities):
        parser.error('Expanded bounds are only configured for the three existing workspaces')
    selected = {record['id']: record for record in records}
    for city_id in dict.fromkeys(args.cities):
        print(json.dumps(acquire(selected[city_id], args.output_dir, args.expanded), ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
