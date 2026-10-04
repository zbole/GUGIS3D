"""Request-bound city workspaces; selecting a city never changes global state."""
import hashlib
import json
import math
import re
import threading
from functools import lru_cache
from contextvars import ContextVar
from pathlib import Path

from fastapi import APIRouter, HTTPException
from .workspace_catalog import CITY_DEFAULTS


ACTIVE_CITY: ContextVar[str] = ContextVar('gugis_request_city', default='bristol')
router = APIRouter(prefix='/cities', tags=['Independent city workspaces'])


async def select_workspace(city_id: str):
    """Async dependency preserves context through Starlette's threadpool calls."""
    if city_id not in CITY_DEFAULTS:
        raise HTTPException(404, '城市工作区不存在')
    token = ACTIVE_CITY.set(city_id)
    try:
        yield
    finally:
        ACTIVE_CITY.reset(token)


def directory(bristol_directory: Path, city_id: str | None = None) -> Path:
    selected = city_id or ACTIVE_CITY.get()
    if selected not in CITY_DEFAULTS:
        raise HTTPException(404, '城市工作区不存在')
    # Keep existing Bristol paths and histories exactly where they were.
    return bristol_directory if selected == 'bristol' else bristol_directory.parent / 'cities' / selected


def seed_path(bristol_seed: Path, city_id: str | None = None) -> Path:
    selected = city_id or ACTIVE_CITY.get()
    if selected not in CITY_DEFAULTS:
        raise HTTPException(404, '城市工作区不存在')
    return bristol_seed if selected == 'bristol' else bristol_seed.parent / 'cities' / f'{selected}.gugis.json'


def empty_document():
    """Missing data is an empty project, never a borrowed or fabricated city."""
    from ..city_models import CityDocument
    selected = ACTIVE_CITY.get()
    entry = CITY_DEFAULTS[selected]
    return CityDocument(format='gugis-city', version='1.0', coordinate_system='ENU_METERS_WGS84',
                        name=f"{entry['name']} · 待导入城市工作区", assets={}, instances=[],
                        metadata={'city_id': selected, 'coverage_kind': 'sample-area',
                                  'coverage_label': entry['coverage_label'], 'data_status': 'pending',
                                  'coverage_bbox_wgs84': json.dumps(entry['query_bbox_wgs84']),
                                  'source': '尚未导入建筑数据'})


def valid_bounds(value):
    try:
        if isinstance(value, str) and len(value) > _CATALOG_BOUNDS_LIMIT:
            return None
        bounds = json.loads(value) if isinstance(value, str) else value
        if len(bounds) != 4 or any(not isinstance(n, (int, float)) or not math.isfinite(n) for n in bounds):
            return None
        w, s, e, n = bounds
        if -180 <= w < e <= 180 and -85 <= s < n <= 85:
            return list(bounds)
    except (ValueError, TypeError):
        pass
    return None


# Cache small, fully validated summaries, not expanded city geometry. A stat
# fingerprint avoids reparsing city archives on every catalogue/DEM
# request. Atomic replacements and in-place edits both invalidate the summary.
_summary_lock = threading.RLock()
_MAX_CITY_BYTES = 128 * 1024 * 1024
_CATALOG_TEXT_LIMIT = 2048
_CATALOG_BOUNDS_LIMIT = 512
# Never truncate machine-readable values into different coordinates/URLs, or
# partially quote a height policy. Omit overlong values and use existing defaults.
_CATALOG_DROP_LIMITS = {'coverage_bbox_wgs84': _CATALOG_BOUNDS_LIMIT,
                        'data_bbox_wgs84': _CATALOG_BOUNDS_LIMIT,
                        'height_policy': _CATALOG_TEXT_LIMIT,
                        'source_url': _CATALOG_TEXT_LIMIT,
                        'coverage_kind': 128, 'source_retrieved_at': 128}
_CATALOG_METADATA = {'coverage_bbox_wgs84', 'data_bbox_wgs84', 'coverage_kind',
                     'coverage_label', 'source', '来源', 'source_url', 'license',
                     'source_retrieved_at', 'height_policy'}
_SOURCE_AUDIT_PATH = Path(__file__).resolve().parents[2] / 'data' / 'cities' / 'source-audit.json'


@lru_cache(maxsize=1)
def _source_audit():
    """Validate a bounded static audit once; never take its path from a request.

    Immutable tuple records prevent a returned API warning from mutating this
    process-wide cache. None means the audit failed, not that data was cleared.
    """
    try:
        with _SOURCE_AUDIT_PATH.open('rb') as handle:
            content = handle.read(65537)
        if len(content) > 65536:
            raise ValueError('Source audit exceeds 64 KiB')
        payload = json.loads(content)
        if not isinstance(payload, dict) or payload.get('schema') != 'gugis-city-source-audit-v1':
            raise ValueError('Invalid source audit schema')
        revisions = payload.get('revisions')
        if not isinstance(revisions, dict) or len(revisions) > 64:
            raise ValueError('Invalid source audit revisions')
        checked = {}
        for revision, entry in revisions.items():
            if not isinstance(revision, str) or not re.fullmatch('[0-9a-f]{64}', revision) or not isinstance(entry, dict):
                raise ValueError('Invalid source audit revision')
            city_id, warnings = entry.get('city_id'), entry.get('warnings')
            if city_id not in CITY_DEFAULTS or not isinstance(warnings, list) or len(warnings) > 20:
                raise ValueError('Invalid source audit entry')
            records = []
            for warning in warnings:
                if not isinstance(warning, dict):
                    raise ValueError('Invalid source audit warning')
                code, message, ids = warning.get('code'), warning.get('message'), warning.get('osm_ids')
                if not isinstance(code, str) or not re.fullmatch('[a-z0-9-]{1,64}', code):
                    raise ValueError('Invalid warning code')
                if not isinstance(message, str) or not 1 <= len(message) <= 500:
                    raise ValueError('Invalid warning message')
                if (not isinstance(ids, list) or len(ids) > 1000 or
                    any(isinstance(i, bool) or not isinstance(i, int) or i <= 0 for i in ids) or len(ids) != len(set(ids))):
                    raise ValueError('Invalid warning object identifiers')
                records.append((code, message, tuple(ids)))
            checked[revision] = (city_id, tuple(records))
        return checked
    except (OSError, ValueError, TypeError):
        return None


def quality_warnings(city_id, revision):
    if revision is None:
        return []
    audit = _source_audit()
    if audit is None:
        return [{'code': 'source-audit-unavailable', 'message': '来源质量清单暂不可用；不能据此认定当前版本的楼高已核验', 'osm_ids': []}]
    entry = audit.get(revision)
    if entry is None or entry[0] != city_id:
        return []
    return [{'code': code, 'message': message, 'osm_ids': list(ids)} for code, message, ids in entry[1]]


def _bounded_catalog_metadata(metadata):
    """Keep summaries small without changing the saved provenance/document."""
    result = {}
    for key in _CATALOG_METADATA:
        value = metadata.get(key)
        if value is None:
            continue
        limit = _CATALOG_DROP_LIMITS.get(key)
        if limit is not None:
            if len(value) <= limit:
                result[key] = value
        else:
            result[key] = (value if len(value) <= _CATALOG_TEXT_LIMIT else
                           value[:_CATALOG_TEXT_LIMIT - 1] + '…')
    return result


def _fingerprint(path):
    stat = path.stat()
    return (stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)


class _SnapshotChanged(OSError):
    pass


@lru_cache(maxsize=64)
def _validated_summary(path, fingerprint):
    from .city_archive import load_city
    invalid = {'corrupt': True, 'metadata': {}, 'count': 0, 'extent': None, 'road_count': 0}
    if fingerprint[2] > _MAX_CITY_BYTES:
        return invalid
    # Bound reads too: the file may have grown after stat(). Never rewrite a
    # corrupt file or fall back to a seed when the saved project is invalid.
    with path.open('rb') as source:
        content = source.read(_MAX_CITY_BYTES + 1)
    if _fingerprint(path) != fingerprint:
        raise _SnapshotChanged('City changed while reading its summary')
    if len(content) > _MAX_CITY_BYTES:
        return invalid
    revision = hashlib.sha256(content).hexdigest()
    from .seed_summaries import trusted_seed_summary
    trusted = trusted_seed_summary(content, revision)
    if trusted is not None:
        return trusted
    try:
        document = load_city(content)
    except (ValueError, TypeError, KeyError):
        return invalid
    instances = document.instances
    extent = None
    if instances:
        longitudes = [p.longitude for p in instances]
        latitudes = [p.latitude for p in instances]
        extent = [min(longitudes), min(latitudes), max(longitudes), max(latitudes)]
    return {'corrupt': False,
            'metadata': _bounded_catalog_metadata(document.metadata),
            'count': len(instances),
            'extent': extent, 'road_count': len(document.roads),
            'revision': revision}


def _source_summary(path):
    # One cold validation per snapshot, even for simultaneous requests. The
    # cache is bounded and retains summaries only; it never retains the model.
    with _summary_lock:
        for _ in range(2):
            try:
                return _validated_summary(path.resolve(), _fingerprint(path))
            except _SnapshotChanged:
                continue
            except OSError:
                break
    return {'corrupt': True, 'metadata': {}, 'count': 0, 'extent': None, 'road_count': 0}


def workspace_entry(city_id: str):
    from ..routers import city
    defaults = CITY_DEFAULTS[city_id]
    current = directory(city.CITY_DIR, city_id) / 'current.gugis.json'
    saved = current.is_file()
    source_path = current if saved else seed_path(city.SEED, city_id)
    summary = (_source_summary(source_path) if source_path.is_file() else
               {'corrupt': False, 'metadata': {}, 'count': 0, 'extent': None, 'road_count': 0})
    corrupt, metadata = summary['corrupt'], summary['metadata']
    count, extent = summary['count'], summary['extent']
    bounds = valid_bounds(metadata.get('coverage_bbox_wgs84')) or defaults['query_bbox_wgs84']
    return {
        'id': city_id, **defaults,
        'data_origin': 'saved-project' if saved else ('public-seed' if source_path.is_file() else 'missing'),
        'status': 'invalid' if corrupt else ('ready' if count else 'pending'),
        'coverage_kind': metadata.get('coverage_kind', 'sample-area'),
        'coverage_label': metadata.get('coverage_label', defaults['coverage_label']),
        'query_bbox_wgs84': bounds,
        'center_wgs84': [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2],
        # OSM returns complete ways intersecting the query, so their true
        # footprint extent can cross the requested rectangle.
        'actual_data_bbox_wgs84': valid_bounds(metadata.get('data_bbox_wgs84')),
        'building_extent_wgs84': extent, 'building_count': count,
        'road_count': summary['road_count'],
        'data_revision': summary.get('revision'),
        'quality_warnings': quality_warnings(city_id, summary.get('revision')),
        'source': metadata.get('source') or metadata.get('来源', '样本复现项目' if city_id == 'bristol' else '等待公开建筑数据导入'),
        'source_url': metadata.get('source_url', ''), 'license': metadata.get('license', ''),
        'source_retrieved_at': metadata.get('source_retrieved_at', ''),
        'height_policy': metadata.get('height_policy', '建筑模型包含演示或推算高度，不能作为实测城市成果'),
        'api_prefix': f'/cities/{city_id}/city',
    }


@router.get('')
def catalog():
    # The catalogue only reads summaries. It never initializes other projects.
    return {'cities': [workspace_entry(city_id) for city_id in CITY_DEFAULTS]}


def crop_bounds():
    return workspace_entry(ACTIVE_CITY.get())['query_bbox_wgs84']
