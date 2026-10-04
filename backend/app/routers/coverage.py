"""Read-only readiness inventory. Membership, samples and coverage stay separate."""
import stat
from pathlib import Path

from fastapi import APIRouter

from ..services import city_workspaces, uk_city_registry
from ..services.workspace_catalog import WORKSPACES

router = APIRouter(prefix='/coverage', tags=['UK city readiness'])
BOUNDARY_RECEIPTS_ROOT = Path(__file__).resolve().parents[3] / '.local' / 'coverage' / 'boundaries'
# Associations are labels, not spatial assertions; no new workspace is created.
_SAMPLES = tuple((record['id'], 'Westminster / Whitehall sample (legacy London workspace)' if record['id'] == 'london'
                 else f"{record['city_name']} sample", record['related_registry_id']) for record in WORKSPACES)
_SAMPLE_NOTE = 'Name-based sample association only; membership within a city boundary has not been verified.'
_LONDON_NOTE = ('The legacy london workspace is a Westminster / Whitehall sample. Its association with Westminster '
                'is not verified against a city boundary and does not establish City of London coverage.')


def _sample_summary(workspace_id, display_name, related_city_id):
    """Use existing cached archive summaries; never call current/initialization."""
    sample = {'workspace_id': workspace_id, 'display_name': display_name,
              'status': 'unavailable', 'building_count': None, 'road_count': None,
              'data_revision': None, 'related_city_id': related_city_id,
              'boundary_membership_verified': False,
              'association_note': _LONDON_NOTE if workspace_id == 'london' else _SAMPLE_NOTE}
    try:
        entry = city_workspaces.workspace_entry(workspace_id)
        status = {'ready': 'available', 'pending': 'missing', 'invalid': 'invalid'}[entry['status']]
        counts = ({} if entry['status'] == 'invalid' else
                  {'building_count': entry['building_count'], 'road_count': entry['road_count'],
                   'data_revision': entry['data_revision']})
        sample.update(status=status, **counts)
    except Exception:
        # Each legacy archive is an independent optional source. A parser/read
        # failure must not hide national membership or leak paths/error details.
        pass
    return sample


def _boundary_summary(city_id):
    """An optional valid local receipt records structure, not coverage/authority."""
    # Caller supplies only validated registry IDs. No request path or receipt
    # metadata can select a source file or activate a render/import workflow.
    from ..services.boundary_receipts import (MAX_RECEIPT_BYTES, UnsupportedPlatformError,
                                               read_bounded_file, validate_receipt)
    path = BOUNDARY_RECEIPTS_ROOT / f'{city_id}.json'
    try:
        if any(parent.is_symlink() for parent in path.parents):
            raise ValueError('Symlink receipt directories are not accepted')
        if not stat.S_ISREG(path.lstat().st_mode):
            raise ValueError('Receipt is not a regular file')
    except FileNotFoundError:
        return {'state': 'not-recorded', 'receipt': None}
    except (OSError, ValueError):
        return {'state': 'validation-failed', 'receipt': None}
    try:
        content = read_bounded_file(path, MAX_RECEIPT_BYTES)
        receipt = validate_receipt(content, city_id)
        # Do not reflect arbitrary provenance metadata, file paths, or geometry.
        safe = {'schema': receipt['schema'], 'city_id': receipt['city_id'],
                'checksum_sha256': receipt['checksum_sha256'],
                'source_sha256': receipt['source']['sha256'],
                'geometry_sha256': receipt['geometry']['sha256'],
                'validation_level': receipt['checker']['validation_level'],
                'topology': receipt['topology'],
                'city_boundary_authority': receipt['city_boundary_authority']}
        return {'state': 'receipt-recorded', 'receipt': safe}
    except UnsupportedPlatformError:
        return {'state': 'validation-failed', 'receipt': None, 'reason_code': 'unsupported-platform'}
    except (OSError, ValueError, TypeError, KeyError):
        return {'state': 'validation-failed', 'receipt': None}


@router.get('/uk-cities')
def uk_cities():
    registry = uk_city_registry.read_registry()
    samples = [_sample_summary(*sample) for sample in _SAMPLES]
    related = {sample['related_city_id']: sample for sample in samples}
    cities = []
    for record in registry['cities']:
        sample = related.get(record['id'])
        cities.append({**record,
                       'sample': {'state': sample['status'] if sample else 'none',
                                  'workspace_ids': [sample['workspace_id']] if sample else [],
                                  'boundary_membership_verified': False},
                       'boundary': _boundary_summary(record['id']),
                       'import': {'state': 'not-imported', 'scope': 'full-boundary'},
                       'coverage': {'state': 'not-assessed'}})
    return {'schema': 'gugis-uk-readiness-v1',
            'summary': {'registered_cities': len(cities), 'sample_workspaces': len(samples),
                        'available_sample_workspaces': sum(sample['status'] == 'available' for sample in samples),
                        'coverage_assessment': 'not-assessed'},
            'source': registry['source'], 'country_counts': registry['country_counts'],
            'samples': samples, 'cities': cities}
