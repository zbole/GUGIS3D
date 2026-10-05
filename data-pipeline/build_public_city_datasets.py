"""Publish summaries of validated immutable seeds; never read local formal cities."""
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from app.services.city_archive import load_city
from app.services.workspace_catalog import WORKSPACES
from app.services.city_workspaces import quality_warnings


def build():
    sources = []
    for workspace in WORKSPACES:
        city_id = workspace['id']
        path = ROOT / ('backend/data/bristol.gugis.json' if city_id == 'bristol'
                       else f'backend/data/cities/{city_id}.gugis.json')
        with path.open('rb') as handle:
            content = handle.read(128 * 1024 * 1024 + 1)
        if len(content) > 128 * 1024 * 1024:
            raise ValueError('Public seed exceeds download limit')
        city = load_city(content)
        if city.metadata.get('city_id') != city_id:
            raise ValueError('Wrong city seed')
        metadata = city.metadata
        raw_policy = metadata.get('height_policy', '')
        try:
            policy = json.loads(raw_policy)
        except (ValueError, TypeError):
            policy = None
        if policy is not None:
            if (not isinstance(policy, dict) or set(policy) != {'height-tag', 'levels-derived', 'assumed'}
                    or any(type(n) is not int or n < 0 for n in policy.values())
                    or sum(policy.values()) != len(city.instances)):
                raise ValueError('Height provenance does not cover all imported buildings')
        actual = metadata.get('data_bbox_wgs84')
        sources.append({
            'city_id': city_id, 'name': workspace['name'],
            'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest(),
            'building_count': len(city.instances), 'road_count': len(city.roads),
            'feature_count': len(city.environment.features) if city.environment else 0,
            'terrain_included': bool(city.environment and city.environment.terrain),
            'terrain_note': 'Seed terrain is not an imported EA DTM; inspect native provenance before analysis.'
                if city.environment and city.environment.terrain else 'No terrain in this seed; DTM is a separate dataset.',
            'coverage_label': metadata.get('coverage_label', workspace['coverage_label']),
            'query_bbox_wgs84': workspace['query_bbox_wgs84'],
            'actual_data_bbox_wgs84': json.loads(actual) if actual else None,
            'height_counts': policy, 'height_policy': raw_policy,
            'source': metadata.get('source', ''), 'license': metadata.get('license', ''),
            'source_retrieved_at': metadata.get('source_retrieved_at', ''),
            'quality_warnings': quality_warnings(city_id, hashlib.sha256(content).hexdigest()),
            'scope': 'Immutable public seed, not the local saved project or its history.',
        })
        print(json.dumps({'city_id': city_id, 'buildings': len(city.instances)}), flush=True)
    report = {'schema': 'gugis-public-city-datasets-v1', 'sources': sources,
              'builder_sha256': hashlib.sha256(Path(__file__).read_bytes().replace(b'\r\n', b'\n')).hexdigest()}
    path = ROOT / 'shared/public-city-datasets.json'
    content = (json.dumps(report, ensure_ascii=False, indent=2) + '\n').encode()
    if len(content) > 65536:
        raise ValueError('Public catalogue exceeds its bounded metadata read')
    path.write_bytes(content)
    print(json.dumps({'manifest_sha256': hashlib.sha256(content).hexdigest()}))


if __name__ == '__main__':
    build()
