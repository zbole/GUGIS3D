"""Read-only, pinned EA data candidate. Never creates or overwrites city archives."""
import hashlib
import json
from pathlib import Path

from fastapi import HTTPException
from ..environment_models import Terrain

ROOT = Path(__file__).resolve().parents[3]
MANIFEST_PATH = ROOT / 'shared/public-terrain-sources.json'
MANIFEST_SHA256 = '7b077385e2dd06d269d04fec1788c180b5445e080d3968a1fe93c78db6695608'
FILES = {'raster': ('bristol-ea-dtm-1m.tif', 16 * 1024 * 1024),
         'model': ('bristol-ea-dtm-preview.gugis-terrain.json', 8 * 1024 * 1024)}


def _read_bounded(path, limit):
    with path.open('rb') as handle:
        content = handle.read(limit + 1)
    if len(content) > limit:
        raise ValueError('Public terrain file exceeds its read limit')
    return content


def source_info(city_id):
    if city_id != 'bristol':
        return {'status': 'pending', 'source': None}
    try:
        content = _read_bounded(MANIFEST_PATH, 65536)
        if hashlib.sha256(content).hexdigest() != MANIFEST_SHA256:
            raise ValueError('Public terrain manifest changed')
        report = json.loads(content)
        if report['schema'] != 'gugis-public-terrain-sources-v1' or len(report['sources']) != 1:
            raise ValueError('Invalid public terrain catalogue')
        info = report['sources'][0]
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
    filename, limit = FILES[kind]
    content = _read_bounded(ROOT / 'backend/data/terrain' / filename, limit)
    if len(content) != info[f'{kind}_bytes'] or hashlib.sha256(content).hexdigest() != info[f'{kind}_sha256']:
        raise ValueError('Public terrain candidate bytes changed')
    return content


def candidate(city_id, kind):
    result = source_info(city_id)
    if result['status'] != 'available':
        raise HTTPException(404, '当前城市尚无已取得的公开 DTM，不借用其他城市地形。')
    try:
        content = _candidate_bytes(result['source'], kind)
        if kind == 'model':
            terrain = Terrain.model_validate_json(content)
            if terrain.demonstration or terrain.vertical_datum != 'ODN':
                raise ValueError('Unexpected public terrain identity')
        return content
    except (OSError, ValueError, TypeError, KeyError) as error:
        raise HTTPException(503, '公开地形文件校验失败；正式城市未改动。') from error
