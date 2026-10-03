"""Request-bound city workspaces; selecting a city never changes global state."""
import hashlib
import json
import math
import threading
from functools import lru_cache
from contextvars import ContextVar
from pathlib import Path

from fastapi import APIRouter, HTTPException


ACTIVE_CITY: ContextVar[str] = ContextVar('gugis_request_city', default='bristol')
CITY_DEFAULTS = {
    'bristol': {
        'name': '布里斯托', 'city_name': 'Bristol',
        'coverage_label': '布里斯托中心样本街区（非全城覆盖）',
        'query_bbox_wgs84': [-2.614, 51.446, -2.592, 51.462],
    },
    'london': {
        'name': '伦敦', 'city_name': 'London',
        'coverage_label': '伦敦中心样本街区（非全城覆盖）',
        'query_bbox_wgs84': [-0.138, 51.496, -0.123, 51.508],
    },
    'birmingham': {
        'name': '伯明翰', 'city_name': 'Birmingham',
        'coverage_label': '伯明翰中心样本街区（非全城覆盖）',
        'query_bbox_wgs84': [-1.914, 52.476, -1.901, 52.488],
    },
}
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
# fingerprint avoids reparsing Bristol's 32 MiB archive on every catalogue/DEM
# request. Atomic replacements and in-place edits both invalidate the summary.
_summary_lock = threading.RLock()
_MAX_CITY_BYTES = 128 * 1024 * 1024
_CATALOG_METADATA = {'coverage_bbox_wgs84', 'data_bbox_wgs84', 'coverage_kind',
                     'coverage_label', 'source', '来源', 'source_url', 'license',
                     'source_retrieved_at', 'height_policy'}


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
            'metadata': {key: value for key, value in document.metadata.items() if key in _CATALOG_METADATA},
            'count': len(instances),
            'extent': extent, 'road_count': len(document.roads),
            'revision': hashlib.sha256(content).hexdigest()}


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
    source_path = current if current.is_file() else seed_path(city.SEED, city_id)
    summary = (_source_summary(source_path) if source_path.is_file() else
               {'corrupt': False, 'metadata': {}, 'count': 0, 'extent': None, 'road_count': 0})
    corrupt, metadata = summary['corrupt'], summary['metadata']
    count, extent = summary['count'], summary['extent']
    bounds = valid_bounds(metadata.get('coverage_bbox_wgs84')) or defaults['query_bbox_wgs84']
    return {
        'id': city_id, **defaults,
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
