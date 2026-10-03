"""Convert retained, attributed OSM ways into reproducible local city samples."""
import hashlib
import json
import math
import re
from pathlib import Path
from ..city_models import CityDocument, Road
from .city_generator import footprint_document

CITY_NAMES = {'london': '伦敦', 'birmingham': '伯明翰'}


def height_from_tags(tags):
    value = str(tags.get('height', '')).strip()
    match = re.fullmatch(r'([0-9]+(?:\.[0-9]+)?)\s*(m|metres|meters|ft|feet|\')?', value, re.I)
    if match:
        height = float(match[1]) * (0.3048 if match[2] and match[2].lower() in ('ft', 'feet', "'") else 1)
        if 1 <= height <= 150:
            return height, 'OSM height 标签（未独立测量核验）', 'height-tag'
    try:
        height = float(tags.get('building:levels', '')) * 3.2
        if math.isfinite(height) and 1 <= height <= 150:
            return height, 'OSM building:levels × 3.2 m（推算）', 'levels-derived'
    except (ValueError, TypeError):
        pass
    return 9.6, '缺少或不支持的高度：假设 9.6 m', 'assumed'


def build_osm_sample(osm, source, city_id):
    if city_id not in CITY_NAMES or source.get('city_id') != city_id:
        raise ValueError('City/source identifiers do not match a supported sample')
    bbox = source['bbox']
    if (len(bbox) != 4 or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in bbox)
        or not -180 <= bbox[0] < bbox[2] <= 180 or not -85 <= bbox[1] < bbox[3] <= 85):
        raise ValueError('Source query bounds must be WGS84 west/south/east/north')
    assets, instances, roads, omitted, road_omitted, points = {}, [], [], [], [], []
    heights = {'height-tag': 0, 'levels-derived': 0, 'assumed': 0}
    building_count = 0
    for element in sorted(osm.get('elements', []), key=lambda e: (str(e.get('type')), e.get('id', 0))):
        if element.get('type') != 'way':
            continue
        tags = element.get('tags', {})
        geometry = element.get('geometry', [])
        if tags.get('building') and tags['building'] != 'no':
            building_count += 1
            try:
                ring = [[p['lon'], p['lat']] for p in geometry]
                if len(ring) < 4 or ring[0] != ring[-1]:
                    raise ValueError('Only closed building ways are supported')
                height, reason, policy = height_from_tags(tags)
                name = (tags.get('name') or ' '.join(str(tags[k]) for k in ('addr:housenumber', 'addr:street') if tags.get(k))
                        or f"OSM 建筑 · {element['id']}")
                identifier = f"osm{element['id']}"
                if identifier in assets:
                    raise ValueError('Duplicate OSM building identifier')
                doc = footprint_document(ring, str(name), height,
                    f"© OpenStreetMap contributors · way/{element['id']} · ODbL 1.0", reason)
                assets[identifier] = doc
                instances.append(dict(id=identifier, asset=identifier, name=doc.parameters.name,
                    longitude=doc.parameters.longitude, latitude=doc.parameters.latitude, altitude=0, heading=0))
                heights[policy] += 1
                points.extend(ring)
            except (ValueError, TypeError, KeyError) as error:
                omitted.append({'osm_way': element.get('id'), 'reason': str(error)[:250]})
        if tags.get('highway') and tags.get('area') != 'yes':
            try:
                coordinates = [(p['lon'], p['lat']) for p in geometry]
                road = Road(id=f"r{element['id']}", name=str(tags.get('name', 'OSM 道路'))[:100],
                    width=3 if tags['highway'] in {'footway', 'path', 'steps', 'pedestrian'} else 7,
                    coordinates=coordinates)
                roads.append(road)
                points.extend(coordinates)
            except (ValueError, TypeError, KeyError) as error:
                road_omitted.append({'osm_way': element.get('id'), 'reason': str(error)[:250]})
    if not instances:
        raise ValueError('No supported buildings were imported; keep the workspace pending')
    extent = [min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points)]
    label = f"{source['coverage_label']} 中心街区样本（非全城覆盖）"
    metadata = {
        'city_id': city_id, 'coverage_kind': 'sample-area', 'coverage_label': label, '范围': label,
        'coverage_bbox_wgs84': json.dumps(bbox, separators=(',', ':')),
        'data_bbox_wgs84': json.dumps(extent, separators=(',', ':')),
        'source': '© OpenStreetMap contributors · ODbL 1.0', 'source_url': source['source_url'],
        'license': 'ODbL 1.0', '许可': 'https://www.openstreetmap.org/copyright',
        '数据库许可': 'https://opendatacommons.org/licenses/odbl/1-0/',
        'source_retrieved_at': source.get('downloaded_at', ''),
        '数据时间': osm.get('osm3s', {}).get('timestamp_osm_base', ''),
        'source_sha256': source.get('sha256', ''), 'data_status': 'ready',
        'height_policy': json.dumps(heights, separators=(',', ':')),
        '精度说明': '真实 OSM 轮廓 LoD1 体量；高度标签未独立核验，缺失高度按楼层或 9.6 m 推算。无实测地形与内部、立面复原。道路宽度为显示假设。',
        '采样说明': f'保留查询范围内全部可转换闭合建筑 way：{len(instances)}/{building_count}；跳过 {len(omitted)} 栋、{len(road_omitted)} 条道路。未取得 multipolygon relations。跨界 way 保留完整几何，查询窗口不等于实际几何边界。',
    }
    city = CityDocument(format='gugis-city', version='1.0', coordinate_system='ENU_METERS_WGS84',
        name=f'{CITY_NAMES[city_id]} · 中心街区样本', assets=assets, instances=instances, roads=roads, metadata=metadata)
    return city, {'city_id': city_id, 'source_sha256': source.get('sha256', ''),
        'source_building_ways': building_count, 'imported_buildings': len(instances), 'imported_roads': len(roads),
        'query_bbox_wgs84': bbox, 'actual_data_bbox_wgs84': extent, 'height_policy': heights,
        'omitted_buildings': omitted, 'omitted_roads': road_omitted, 'license': 'ODbL 1.0'}


def load_sample(source_path: Path, manifest_path: Path, city_id: str):
    content = source_path.read_bytes()
    manifest = json.loads(manifest_path.read_bytes())
    if hashlib.sha256(content).hexdigest() != manifest.get('sha256'):
        raise ValueError('Retained OSM source SHA-256 does not match its acquisition manifest')
    return build_osm_sample(json.loads(content), manifest, city_id)
