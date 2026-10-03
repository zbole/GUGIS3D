"""Offline, lossless render-only packages. Never imported by a city write path.

The source revision is the SHA-256 of the exact validated input bytes. Package
files are immutable, bounded derivatives, not editable CityDocuments.
"""
from __future__ import annotations

import hashlib
import itertools
import json
import math
import os
from pathlib import Path
import re
import shutil
import tempfile
from dataclasses import dataclass, asdict

from ..city_models import GeometryBinding, Placement, SharedGeometry
from .city_archive import encode, load_city
from .city_workspaces import CITY_DEFAULTS, quality_warnings

PACKAGE_FORMAT = 'gugis-render-package-v1'
TILE_FORMAT = 'gugis-render-tile-v1'
REVISION_RE = re.compile(r'^[a-f0-9]{64}$')
TILE_RE = re.compile(r'^x-?[0-9]{1,8}_y-?[0-9]{1,8}$')
MAX_SOURCE_BYTES = 128 * 1024 * 1024
PROVENANCE_FIELDS = frozenset({
    'city_id', 'source', 'source_url', 'source_sha256', 'source_retrieved_at',
    'license', 'coverage_kind', 'coverage_label', 'coverage_bbox_wgs84',
    'data_bbox_wgs84', 'height_policy', 'data_status', '范围', '轮廓数据',
    '许可', '数据库许可', '数据时间', '精度说明', '采样说明', '细化说明',
    '配色说明', '显示方式',
})
MAX_MANIFEST_BYTES = 4 * 1024 * 1024
MAX_POINTER_BYTES = 4096
WGS84_A = 6378137.0
WGS84_E2 = 6.6943799901413165e-3


class RenderPackageError(ValueError):
    """A failed build never publishes a partial package or changes its source."""


class RenderTileOverflow(RenderPackageError):
    def __init__(self, tiles):
        self.tiles = tiles
        super().__init__('Render tile limits exceeded: ' + json.dumps(tiles, ensure_ascii=False))


@dataclass(frozen=True)
class TileLimits:
    max_buildings: int = 256
    max_primitives: int = 12000
    max_bytes: int = 2 * 1024 * 1024
    max_tiles: int = 20000

    def __post_init__(self):
        if any(type(v) is not int or v <= 0 for v in asdict(self).values()):
            raise RenderPackageError('Tile limits must be positive integers')
        # Read requests have a hard byte ceiling independent of an untrusted
        # on-disk manifest. More generous packages require a schema revision.
        if self.max_bytes > 16 * 1024 * 1024:
            raise RenderPackageError('Tile byte limit cannot exceed 16 MiB')


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def check_city(city_id: str) -> None:
    if city_id not in CITY_DEFAULTS:
        raise RenderPackageError('Unknown city workspace')


def file_signature(path: Path) -> dict:
    value = path.stat()
    return {key: getattr(value, 'st_' + key) for key in ('dev', 'ino', 'size', 'mtime_ns', 'ctime_ns')}


def bounded_read(path: Path, limit: int) -> bytes:
    # Reject symlinks, including directory symlinks, so malformed local caches
    # cannot turn these read-only endpoints into arbitrary-file reads.
    if path.is_symlink() or any(p.is_symlink() for p in path.parents):
        raise RenderPackageError('Render cache symlinks are not supported')
    with path.open('rb') as stream:
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise RenderPackageError('Render cache file exceeds its bounded read limit')
    return data


def ecef(longitude, latitude, altitude=0):
    lon, lat = math.radians(longitude), math.radians(latitude)
    sin_lat, cos_lat = math.sin(lat), math.cos(lat)
    n = WGS84_A / math.sqrt(1 - WGS84_E2 * sin_lat * sin_lat)
    return ((n + altitude) * cos_lat * math.cos(lon),
            (n + altitude) * cos_lat * math.sin(lon),
            (n * (1 - WGS84_E2) + altitude) * sin_lat)


def enu_axes(longitude, latitude):
    lon, lat = math.radians(longitude), math.radians(latitude)
    sl, cl, sp, cp = math.sin(lon), math.cos(lon), math.sin(lat), math.cos(lat)
    return ((-sl, cl, 0), (-sp * cl, -sp * sl, cp), (cp * cl, cp * sl, sp))


def bounds(points):
    points = list(points)
    return [min(p[k] for p in points) for k in range(3)] + [max(p[k] for p in points) for k in range(3)]


def union_bounds(items, dimensions=3):
    items = list(items)
    if not items:
        return None
    return [min(b[k] for b in items) for k in range(dimensions)] + [max(b[k + dimensions] for b in items) for k in range(dimensions)]


def geometry_points(geometry, size=None):
    if geometry['kind'] == 'box':
        return [(x * size[0] / 2, y * size[1] / 2, z * size[2] / 2)
                for x, y, z in itertools.product((-1, 1), repeat=3)]
    if geometry['kind'] == 'box-set':
        return [p for b in geometry['bounds'] for p in itertools.product(*[(b[k], b[k + 3]) for k in range(3)])]
    return geometry['vertices']


def primitive_points(primitive, library):
    angle = math.radians(primitive['rotation_z'])
    c, s = math.cos(angle), math.sin(angle)
    ox, oy, oz = primitive['position']
    return [(x * c - y * s + ox, x * s + y * c + oy, z + oz)
            for x, y, z in geometry_points(library[primitive['geometry']], primitive.get('size'))]


def instance_bounds(instance, points, origin, axes):
    """Exact affine vertex extrema in package ENU, like Cesium's ENU * Rz(-heading)."""
    placement = ecef(instance['longitude'], instance['latitude'], instance['altitude'])
    local_axes = enu_axes(instance['longitude'], instance['latitude'])
    c, s = math.cos(math.radians(-instance['heading'])), math.sin(math.radians(-instance['heading']))
    result = []
    for x, y, z in points:
        local = (x * c - y * s, x * s + y * c, z)
        world = [placement[k] - origin[k] + sum(local[j] * local_axes[j][k] for j in range(3)) for k in range(3)]
        result.append([sum(world[j] * axes[k][j] for j in range(3)) for k in range(3)])
    exact = bounds(result)
    # Include a small outward numerical tolerance in the index, not geometry.
    exact = [v - 1e-6 if k < 3 else v + 1e-6 for k, v in enumerate(exact)]
    # A sphere centred on the original placement encloses every transformed
    # solid, including triangle interiors. Conservative angular bounds avoid
    # treating a placement centre or corner sample as the complete footprint.
    radius = max(math.sqrt(sum(v * v for v in p)) for p in points) + 1e-5
    min_radius = 6330000 - abs(instance['altitude']) - radius
    latitude_delta = math.degrees(math.asin(min(1, radius / min_radius)))
    horizontal_radius = math.hypot(placement[0], placement[1])
    longitude_delta = math.degrees(math.asin(min(1, radius / horizontal_radius))) if radius < horizontal_radius else 180
    geographic = [max(-180, instance['longitude'] - longitude_delta),
                  max(-90, instance['latitude'] - latitude_delta),
                  min(180, instance['longitude'] + longitude_delta),
                  min(90, instance['latitude'] + latitude_delta)]
    # Dateline-crossing geographic bounds deliberately cover all longitudes.
    if abs(instance['longitude']) + longitude_delta > 180:
        geographic[0], geographic[2] = -180, 180
    return exact, geographic


def render_assets(raw, document):
    """Keep pooled prototypes byte-value exact; legacy solids get hashed IDs."""
    pooled = raw['version'] in ('1.1', '1.2')
    library = raw.get('geometry_library', {}).copy() if pooled else {}
    assets = {}
    for asset_id in sorted({p.asset for p in document.instances}):
        original = raw['assets'][asset_id]
        # Empty overview is intentionally the same as absent overview.
        overview = original.get('overview') or None
        entries = ([{'id': 'overview_' + key, 'template': key, 'position': [0, 0, 0],
                     'rotation_z': 0, 'category': 'roof' if key == 'roof' else 'wall'}
                    for key in sorted(overview)] if overview else
                   [node for node in original['nodes'] if node.get('template') and node.get('position') is not None])
        primitives = []
        for node in entries:
            key = node['template']
            binding = (overview or original['templates'])[key]
            if not pooled:
                geometry = ({'kind': 'box'} if binding['kind'] == 'box' else
                            {'kind': 'mesh', 'vertices': binding['vertices'], 'triangles': binding['triangles']})
                geometry_id = 'g' + digest(encode(geometry))[:40]
                if geometry_id in library and library[geometry_id] != geometry:
                    raise RenderPackageError('Geometry hash collision')
                library[geometry_id] = geometry
                binding = {'geometry': geometry_id, 'color': binding['color'],
                           **({'size': binding['size']} if binding['kind'] == 'box' else {})}
            primitive = {'id': node['id'], 'template_id': key, 'node_id': None if overview else node['id'],
                         'category': node['category'], 'position': node.get('position', [0, 0, 0]),
                         'rotation_z': node.get('rotation_z', 0), **binding}
            primitives.append(primitive)
        if not primitives:
            raise RenderPackageError(f'Building asset has no renderable primitives: {asset_id}')
        assets[asset_id] = {'quality': 'overview' if overview else 'full-fallback',
                            'kind': original['parameters']['kind'], 'primitives': primitives}
    used = {p['geometry'] for a in assets.values() for p in a['primitives']}
    return assets, {key: library[key] for key in sorted(used)}


def build_package(source: Path, cache_root: Path, city_id: str, *, tile_size_m=250.0,
                  limits: TileLimits | None = None) -> dict:
    """Validate one snapshot, build every tile, then atomically publish its pointer."""
    check_city(city_id)
    limits = limits or TileLimits()
    if not math.isfinite(tile_size_m) or not 10 <= tile_size_m <= 10000:
        raise RenderPackageError('Tile size must be between 10 and 10000 metres')
    source, cache_root = Path(source), Path(cache_root)
    before = file_signature(source)
    with source.open('rb') as stream:
        content = stream.read(MAX_SOURCE_BYTES + 1)
    if len(content) > MAX_SOURCE_BYTES:
        raise RenderPackageError('Source city exceeds 128 MiB')
    after = file_signature(source)
    if before != after:
        raise RenderPackageError('Source changed while reading; retry a stable snapshot')
    revision = digest(content)
    document = load_city(content)  # Existing edit validation/caps stay unchanged.
    raw = json.loads(content)
    if document.metadata.get('city_id', city_id) != city_id:
        raise RenderPackageError('Source metadata city_id does not match requested workspace')
    if document.environment and document.environment.drape_buildings:
        raise RenderPackageError('Terrain-draped buildings are not supported by render package v1; source was not modified')
    assets, library = render_assets(raw, document)
    instances = [p.model_dump(mode='json') for p in sorted(document.instances, key=lambda p: p.id)]
    if instances:
        origin_wgs84 = [(min(p[k] for p in instances) + max(p[k] for p in instances)) / 2 for k in ('longitude', 'latitude')] + [0]
    else:
        w, s, e, n = CITY_DEFAULTS[city_id]['query_bbox_wgs84']
        origin_wgs84 = [(w + e) / 2, (s + n) / 2, 0]
    origin, axes = ecef(*origin_wgs84), enu_axes(*origin_wgs84[:2])
    points_by_asset = {key: [point for p in asset['primitives'] for point in primitive_points(p, library)] for key, asset in assets.items()}
    instance_envelopes, geographic_envelopes, buckets = {}, {}, {}
    for instance in instances:
        envelope, geographic = instance_bounds(instance, points_by_asset[instance['asset']], origin, axes)
        instance_envelopes[instance['id']], geographic_envelopes[instance['id']] = envelope, geographic
        min_x, min_y, max_x, max_y = [math.floor(envelope[k] / tile_size_m) for k in (0, 1, 3, 4)]
        if (max_x - min_x + 1) * (max_y - min_y + 1) > limits.max_tiles:
            raise RenderTileOverflow([{'instance_id': instance['id'], 'reason': 'single-building tile coverage exceeds max_tiles'}])
        for cell in itertools.product(range(min_x, max_x + 1), range(min_y, max_y + 1)):
            buckets.setdefault(cell, []).append(instance)
        if len(buckets) > limits.max_tiles:
            raise RenderTileOverflow([{'reason': 'package max_tiles exceeded', 'tile_count': len(buckets)}])
    tile_data, descriptors, overflows = {}, [], []
    for (x, y), placements in sorted(buckets.items()):
        tile_id = f'x{x}_y{y}'
        tile_assets = {key: assets[key] for key in sorted({p['asset'] for p in placements})}
        used = {p['geometry'] for asset in tile_assets.values() for p in asset['primitives']}
        tile = {'format': TILE_FORMAT, 'city_id': city_id, 'revision': revision, 'tile_id': tile_id,
                'geometry_library': {key: library[key] for key in sorted(used)},
                'assets': tile_assets, 'instances': placements}
        data = encode(tile)
        count = sum(len(tile_assets[p['asset']]['primitives']) for p in placements)
        descriptor = {'id': tile_id, 'grid': [x, y],
                      'cell_bounds_enu': [x * tile_size_m, y * tile_size_m, (x + 1) * tile_size_m, (y + 1) * tile_size_m],
                      'bounds_enu': union_bounds(instance_envelopes[p['id']] for p in placements),
                      'bounds_wgs84': union_bounds((geographic_envelopes[p['id']] for p in placements), 2),
                      'building_count': len(placements), 'primitive_count': count,
                      'byte_length': len(data), 'sha256': digest(data),
                      'url': f'/cities/{city_id}/render/{revision}/tiles/{tile_id}'}
        exceeded = [key for key, value, maximum in [('buildings', len(placements), limits.max_buildings),
                    ('primitives', count, limits.max_primitives), ('bytes', len(data), limits.max_bytes)] if value > maximum]
        if exceeded:
            overflows.append({'tile_id': tile_id, 'exceeded': exceeded, 'building_count': len(placements),
                              'primitive_count': count, 'byte_length': len(data)})
        tile_data[tile_id] = data
        descriptors.append(descriptor)
    if overflows:
        raise RenderTileOverflow(overflows)
    overview = sum(assets[p['asset']]['quality'] == 'overview' for p in instances)
    metadata = {k: v for k, v in document.metadata.items() if k in PROVENANCE_FIELDS}
    manifest = {'format': PACKAGE_FORMAT, 'city_id': city_id, 'name': document.name,
                'revision': revision, 'source_sha256': revision, 'source_byte_length': len(content),
                'grid': {'tile_size_m': tile_size_m, 'origin_wgs84': origin_wgs84, 'coordinate_system': 'ECEF_ENU'},
                'bounds_enu': union_bounds(instance_envelopes.values()),
                'bounds_wgs84': union_bounds(geographic_envelopes.values(), 2),
                'bounds_policy': 'ENU transformed-solid vertex extrema plus 1 micrometre tolerance; WGS84 conservative enclosing-sphere bounds',
                'counts': {'buildings': len(instances), 'assets': len(assets),
                           'primitives': sum(len(assets[p['asset']]['primitives']) for p in instances),
                           'overview_buildings': overview, 'full_fallback_buildings': len(instances) - overview,
                           'tiles': len(descriptors), 'tile_building_references': sum(t['building_count'] for t in descriptors),
                           'tile_primitive_references': sum(t['primitive_count'] for t in descriptors),
                           'tile_bytes': sum(t['byte_length'] for t in descriptors), 'source_roads': len(document.roads)},
                'limits': asdict(limits),
                'quality_warnings_source_revision': revision,
                'quality_warnings': quality_warnings(city_id, revision),
                'layers': {'buildings': 'included', 'roads': 'not-included', 'terrain': 'not-included',
                           'features': 'not-included', 'semantics': 'not-included'},
                'quality_policy': {'overview': 'Use all existing nonempty overview primitives unchanged',
                                   'fallback': 'Use every original solid component only when overview is absent or empty',
                                   'overflow': 'Fail entire build; never truncate, substitute a footprint, or publish a partial package',
                                   'scope': 'Read-only building render geometry; roads, environment, semantic groups and edit operations are excluded',
                                   'terrain_draping': 'Rejected if enabled; no implicit altitude changes'},
                'dedupe_identity': ['city_id', 'revision', 'instances[].id'],
                'primitive_identity': ['instances[].id', 'assets[instance.asset].primitives[].id'],
                'attribution': {'source': metadata.get('source', metadata.get('轮廓数据', '')),
                                'license': metadata.get('license', metadata.get('数据库许可', '')),
                                'license_url': metadata.get('许可', ''), 'metadata': metadata},
                'tiles': descriptors}
    manifest['package_sha256'] = digest(encode(manifest))
    manifest_bytes = encode(manifest)
    if len(manifest_bytes) > MAX_MANIFEST_BYTES:
        raise RenderPackageError('Manifest exceeds 4 MiB limit; package was not published')
    # Cache writes must never resolve into a source or another user file.
    city_root = cache_root / city_id
    destination = city_root / revision
    if any(p.is_symlink() for p in (cache_root, city_root, destination, *cache_root.parents)):
        raise RenderPackageError('Render cache symlinks are not supported')
    if source.resolve().is_relative_to(cache_root.resolve()):
        raise RenderPackageError('Source must be outside the render cache root')
    city_root.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix='.build-', dir=city_root))
    try:
        (temporary / 'tiles').mkdir()
        for tile_id, data in tile_data.items():
            (temporary / 'tiles' / f'{tile_id}.json').write_bytes(data)
        (temporary / 'manifest.json').write_bytes(manifest_bytes)
        validate_package(temporary, expected_city=city_id, expected_revision=revision)
        if destination.exists():
            existing = validate_package(destination, expected_city=city_id, expected_revision=revision)
            if encode(existing) != manifest_bytes:
                raise RenderPackageError('Immutable revision already exists with different build settings; use another cache root')
        else:
            temporary.rename(destination)
        pointer = encode({'revision': revision, 'manifest_sha256': digest(manifest_bytes),
                          'source_signature': after})
        fd, pending = tempfile.mkstemp(prefix='.active-', suffix='.json', dir=city_root)
        try:
            with os.fdopen(fd, 'wb') as stream:
                stream.write(pointer)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(pending, city_root / 'active.json')
        finally:
            if os.path.exists(pending):
                os.unlink(pending)
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)
    return manifest


def validate_manifest(manifest, expected_city, expected_revision):
    if not isinstance(manifest, dict) or manifest.get('format') != PACKAGE_FORMAT:
        raise RenderPackageError('Invalid render manifest format')
    if manifest.get('city_id') != expected_city or manifest.get('revision') != expected_revision:
        raise RenderPackageError('Render manifest identity mismatch')
    if manifest.get('source_sha256') != expected_revision:
        raise RenderPackageError('Render manifest source hash mismatch')
    unsigned = {k: v for k, v in manifest.items() if k != 'package_sha256'}
    if manifest.get('package_sha256') != digest(encode(unsigned)):
        raise RenderPackageError('Render package hash mismatch')
    try:
        limits = TileLimits(**manifest['limits'])
        tiles = manifest['tiles']
        if not isinstance(tiles, list) or len(tiles) > limits.max_tiles or len(tiles) != manifest['counts']['tiles']:
            raise RenderPackageError('Invalid tile count')
        seen = set()
        for item in tiles:
            tile_id = item['id']
            if not TILE_RE.fullmatch(tile_id) or tile_id in seen:
                raise RenderPackageError('Invalid or duplicate render tile ID')
            seen.add(tile_id)
            if not REVISION_RE.fullmatch(item['sha256']):
                raise RenderPackageError('Invalid tile digest')
            for key, maximum in [('building_count', limits.max_buildings), ('primitive_count', limits.max_primitives), ('byte_length', limits.max_bytes)]:
                if type(item[key]) is not int or not 0 < item[key] <= maximum:
                    raise RenderPackageError('Invalid tile bounds or limits')
            if item['url'] != f'/cities/{expected_city}/render/{expected_revision}/tiles/{tile_id}':
                raise RenderPackageError('Invalid render tile URL')
    except (KeyError, TypeError) as error:
        raise RenderPackageError('Invalid render manifest structure') from error
    return manifest


def validate_package(package: Path, *, expected_city: str, expected_revision: str) -> dict:
    """Offline complete hash/reference/count validation; endpoints never call this."""
    manifest = json.loads(bounded_read(package / 'manifest.json', MAX_MANIFEST_BYTES))
    validate_manifest(manifest, expected_city, expected_revision)
    identities, primitive_counts, asset_ids, geometries = {}, {}, set(), {}
    for descriptor in manifest['tiles']:
        data = bounded_read(package / 'tiles' / f"{descriptor['id']}.json", manifest['limits']['max_bytes'])
        if len(data) != descriptor['byte_length'] or digest(data) != descriptor['sha256']:
            raise RenderPackageError('Render tile hash/length mismatch')
        tile = json.loads(data)
        if (tile.get('format'), tile.get('city_id'), tile.get('revision'), tile.get('tile_id')) != (TILE_FORMAT, expected_city, expected_revision, descriptor['id']):
            raise RenderPackageError('Render tile identity mismatch')
        for key, geometry in tile['geometry_library'].items():
            SharedGeometry.model_validate(geometry)
            if key in geometries and geometries[key] != geometry:
                raise RenderPackageError('Duplicate geometry differs between tiles')
            geometries[key] = geometry
        if len({p['id'] for p in tile['instances']}) != len(tile['instances']):
            raise RenderPackageError('Duplicate instance within a tile')
        count = 0
        for instance in tile['instances']:
            Placement.model_validate(instance)
            asset = tile['assets'][instance['asset']]
            signature = encode([instance, asset])
            if instance['id'] in identities and identities[instance['id']] != signature:
                raise RenderPackageError('Duplicate instance content differs between tiles')
            identities[instance['id']] = signature
            asset_ids.add(instance['asset'])
            primitive_counts[instance['id']] = len(asset['primitives'])
            count += len(asset['primitives'])
            if len({p['id'] for p in asset['primitives']}) != len(asset['primitives']):
                raise RenderPackageError('Duplicate primitive ID')
            for primitive in asset['primitives']:
                geometry = tile['geometry_library'][primitive['geometry']]
                GeometryBinding.model_validate({k: primitive[k] for k in ('geometry', 'color', 'size') if k in primitive})
                if (geometry['kind'] == 'box') != ('size' in primitive):
                    raise RenderPackageError('Invalid box binding')
        if len(tile['instances']) != descriptor['building_count'] or count != descriptor['primitive_count']:
            raise RenderPackageError('Tile count mismatch')
    if len(identities) != manifest['counts']['buildings'] or sum(primitive_counts.values()) != manifest['counts']['primitives'] or len(asset_ids) != manifest['counts']['assets']:
        raise RenderPackageError('Package building/primitive/asset count mismatch')
    return manifest
