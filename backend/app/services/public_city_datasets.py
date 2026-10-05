"""Only pinned public seed bytes; no current archive, history, or workspace writes."""
import hashlib
import json
from pathlib import Path

from fastapi import HTTPException
from .workspace_catalog import CITY_DEFAULTS

ROOT = Path(__file__).resolve().parents[3]
MANIFEST = ROOT / 'shared/public-city-datasets.json'
MANIFEST_SHA256 = '575dbfc0071cc90376fb15e9336c86892d2fc1d0d1bbf8e94795434eb8dfcc15'
MAX_BYTES = 128 * 1024 * 1024


def _bounded(path, limit):
    with path.open('rb') as handle:
        value = handle.read(limit + 1)
    if len(value) > limit:
        raise ValueError('Published source exceeds bounded read')
    return value


def read(city_id):
    if city_id not in CITY_DEFAULTS:
        raise HTTPException(404, 'Unknown public city dataset')
    try:
        manifest = _bounded(MANIFEST, 65536)
        if hashlib.sha256(manifest).hexdigest() != MANIFEST_SHA256:
            raise ValueError('Public catalogue fingerprint changed')
        report = json.loads(manifest)
        if (report.get('schema') != 'gugis-public-city-datasets-v1'
                or len(report['sources']) != len(CITY_DEFAULTS)
                or sorted(s['city_id'] for s in report['sources']) != sorted(CITY_DEFAULTS)):
            raise ValueError('Public catalogue cities changed')
        source = next(s for s in report['sources'] if s['city_id'] == city_id)
        # Resolve the seed internally; no path from request or publication metadata.
        path = ROOT / ('backend/data/bristol.gugis.json' if city_id == 'bristol'
                       else f'backend/data/cities/{city_id}.gugis.json')
        content = _bounded(path, MAX_BYTES)
        if len(content) != source['bytes'] or hashlib.sha256(content).hexdigest() != source['sha256']:
            raise ValueError('Public seed differs from audited release')
        return source, content
    except (OSError, ValueError, TypeError, KeyError, StopIteration) as error:
        raise HTTPException(503, '公开样本与发布指纹不符，未返回文件；没有修改正式城市。') from error
