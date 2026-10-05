"""Read-only, pinned EA data candidate. Never creates or overwrites city archives."""
import hashlib
import json
from pathlib import Path

from fastapi import HTTPException
from ..environment_models import Terrain

ROOT = Path(__file__).resolve().parents[3]
MANIFEST_PATH = ROOT / 'shared/public-terrain-sources-v4.json'
MANIFEST_SHA256 = 'ba3da5fe8865c3a52a93cce15064e2de63a181831deb6d19537e806057ea430e'
HISTORICAL_MANIFESTS = {
    'public-terrain-sources-v3.json': 'd2892396984c564e7a7dbd99e3778fbaf60c3e5299bc27de097f1b1a46848f40',
    'public-terrain-sources.json': '7658acdf236f9b434a16f230f69f68fd35f2a9e4eb7855d8db590e378bb64866',
    'public-terrain-sources-v2.json': '8bd4a9a13e42632f3b6e76065c77710b9c75a58d8663a38be3292d3796c25626',
}
FILES = {'raster': ('bristol-ea-dtm-1m.tif', 16 * 1024 * 1024),
         'model': ('bristol-ea-dtm-preview.gugis-terrain.json', 8 * 1024 * 1024)}
CANDIDATES = {city_id: {'raster': (f'{city_id}-ea-dtm-1m.tif', 24 * 1024 * 1024),
                        'model': (f'{city_id}-ea-dtm-preview.gugis-terrain.json', 8 * 1024 * 1024)}
              for city_id in ('bristol', 'london', 'birmingham', 'manchester', 'york', 'bath', 'oxford', 'cambridge', 'liverpool')}
CANDIDATES['bristol'] = FILES


def _read_bounded(path, limit):
    with path.open('rb') as handle:
        content = handle.read(limit + 1)
    if len(content) > limit:
        raise ValueError('Public terrain file exceeds its read limit')
    return content


def source_info(city_id):
    if city_id not in CANDIDATES:
        return {'status': 'pending', 'source': None}
    try:
        content = _read_bounded(MANIFEST_PATH, 65536)
        if hashlib.sha256(content).hexdigest() != MANIFEST_SHA256:
            raise ValueError('Public terrain manifest changed')
        report = json.loads(content)
        if (report['schema'] != 'gugis-public-terrain-sources-v4'
                or report.get('parent_manifest') != {'filename':'public-terrain-sources-v3.json','sha256':HISTORICAL_MANIFESTS['public-terrain-sources-v3.json']}
                or len(report['sources']) != len(CANDIDATES)
                or sorted(s['city_id'] for s in report['sources']) != sorted(CANDIDATES)):
            raise ValueError('Invalid public terrain catalogue')
        for filename, expected_sha in HISTORICAL_MANIFESTS.items():
            if hashlib.sha256(_read_bounded(ROOT/'shared'/filename,65536)).hexdigest()!=expected_sha:
                raise ValueError('Historical terrain provenance changed')
        info = next(s for s in report['sources'] if s['city_id'] == city_id)
        if info['city_id'] != city_id:
            raise ValueError('Public terrain city mismatch')
        # No geometry retained. Check exact bytes independently on each request;
        # the small sources do not require an unbounded stat/bytes cache.
        for kind in FILES:
            _candidate_bytes(info, kind)
        return {'status': 'available', 'source': info}
    except (OSError, ValueError, TypeError, KeyError) as error:
        raise HTTPException(503, '公开地形来源校验失败；正式地形未改动，请检查本地数据包。') from error


def _candidate_bytes(info, kind):
    filename, limit = CANDIDATES[info['city_id']][kind]
    content = _read_bounded(ROOT / 'backend/data/terrain' / filename, limit)
    if len(content) != info[f'{kind}_bytes'] or hashlib.sha256(content).hexdigest() != info[f'{kind}_sha256']:
        raise ValueError('Public terrain candidate bytes changed')
    return content


def candidate(city_id, kind):
    result = source_info(city_id)
    if result['status'] != 'available':
        raise HTTPException(404, '当前城市尚无已核验的公开 DTM，不借用其他城市地形。')
    try:
        content = _candidate_bytes(result['source'], kind)
        if kind == 'model':
            terrain = Terrain.model_validate_json(content)
            if terrain.demonstration or terrain.vertical_datum != 'ODN':
                raise ValueError('Unexpected public terrain identity')
        return content
    except (OSError, ValueError, TypeError, KeyError) as error:
        raise HTTPException(503, '公开地形文件校验失败；正式城市未改动。') from error
