"""Add retained source objects without replacing existing edits or environment."""
import hashlib
import json
from collections import Counter
from ..city_models import CityDocument
from .city_archive import archive_bytes


def merge_expansion(current, incoming, city_id):
    if incoming.metadata.get('city_id') != city_id or current.metadata.get('city_id', 'bristol') != city_id:
        raise ValueError('Expansion must belong to the same workspace')
    if incoming.environment is not None:
        raise ValueError('An object expansion must not replace city terrain or function features')
    original = current.model_dump(mode='json')
    assets = dict(current.assets)
    instances = list(current.instances)
    instance_ids = {item.id for item in instances}
    added, skipped, collisions = [], [], []
    resolved_assets = {}
    heights = Counter()
    for placement in incoming.instances:
        if placement.id in instance_ids:
            skipped.append(placement.id)
            continue
        source_asset_id = placement.asset
        asset_id = resolved_assets.get(source_asset_id, source_asset_id)
        document = incoming.assets[source_asset_id]
        if source_asset_id not in resolved_assets:
            if asset_id in assets and assets[asset_id] != document:
                replacement = f'exp_{asset_id}'
                suffix = 2
                while replacement in assets:
                    replacement = f'exp{suffix}_{asset_id}'
                    suffix += 1
                collisions.append({'source_asset': asset_id, 'added_asset': replacement})
                asset_id = replacement
            resolved_assets[source_asset_id] = asset_id
        assets[asset_id] = document
        instances.append(placement.model_copy(update={'asset': asset_id}))
        instance_ids.add(placement.id)
        added.append(placement.id)
        reason = next((n.attributes.get('高度依据', '') for n in document.nodes if n.category == 'building'), '')
        heights['assumed' if '假设' in reason else 'levels-derived' if 'building:levels' in reason
                else 'height-tag' if 'height 标签' in reason else 'unspecified'] += 1
    road_ids = {road.id for road in current.roads}
    added_roads = [road for road in incoming.roads if road.id not in road_ids]
    metadata = dict(current.metadata)
    metadata.update(city_id=city_id, coverage_kind='sample-area',
        coverage_label=f'{incoming.metadata.get("coverage_label", city_id)} · 保留原项目对象的扩展',
        coverage_bbox_wgs84=incoming.metadata['coverage_bbox_wgs84'],
        source=f'保留原项目对象 + 新增 © OpenStreetMap contributors · ODbL 1.0',
        source_url='https://www.openstreetmap.org/copyright',
        license='新增 OSM 数据：ODbL 1.0；保留对象沿用其原来源许可',
        source_retrieved_at=incoming.metadata.get('source_retrieved_at', ''),
        height_policy=f'保留 {len(current.instances)} 栋原项目对象及其高度依据；新增 {len(added)} 栋：'
                      f'{heights["height-tag"]} 高度标签 / {heights["levels-derived"]} 楼层推算 / '
                      f'{heights["assumed"]} 假设9.6m / {heights["unspecified"]} 其他依据；均未整体实测核验',
        expansion_source_revision=hashlib.sha256(archive_bytes(incoming)).hexdigest(),
        expansion_note='仅按对象ID去重；保留原对象、道路、地形、函数地物和编辑。不同ID可能空间重叠，不代表行政区全覆盖。')
    # Actual geometry bounds of a mixed project are not established merely by a
    # source query rectangle. Let the catalogue show actual placement extrema.
    metadata.pop('data_bbox_wgs84', None)
    merged = (CityDocument.model_validate({**original, 'assets': assets, 'instances': instances,
                                          'roads': [*current.roads, *added_roads], 'metadata': metadata})
              if added or added_roads else current)
    report = {'schema': 'gugis-additive-city-expansion-v1', 'city_id': city_id,
        'baseline_sha256': hashlib.sha256(archive_bytes(current)).hexdigest(),
        'incoming_sha256': hashlib.sha256(archive_bytes(incoming)).hexdigest(),
        'retained_buildings': len(current.instances), 'added_buildings': len(added), 'skipped_existing_ids': skipped,
        'added_roads': len(added_roads), 'retained_roads': len(current.roads), 'asset_collisions': collisions,
        'added_height_policy': dict(heights), 'query_bbox_wgs84': json.loads(incoming.metadata['coverage_bbox_wgs84']),
        'preserved': ['all original assets', 'all original placements', 'all original roads', 'entire original environment'],
        'limitations': ['ID deduplication only; distinct IDs may overlap spatially', 'sample region, not complete administrative coverage',
                       'retained legacy heights are not corrected or verified', 'OSM building ways only; multipolygon relations excluded']}
    return merged, report
