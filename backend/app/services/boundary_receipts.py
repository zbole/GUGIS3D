"""Bounded offline integrity/structure receipts, never boundary or coverage proof.

No topology engine is used. A receipt records an operator's provenance claim and
structural checks of supplied bytes; it cannot establish geographic authority.
"""
from contextlib import contextmanager
from datetime import date
import hashlib
import json
import math
import os
from pathlib import Path
import re
import secrets
import stat
from urllib.parse import urlsplit

SCHEMA = 'boundary-receipt/v1'
CHECKER_VERSION = '1.0.0'
VALIDATION_LEVEL = 'integrity_and_structure'
MAX_SOURCE_BYTES = 16 * 1024 * 1024
MAX_METADATA_BYTES = 64 * 1024
MAX_RECEIPT_BYTES = 128 * 1024
MAX_COORDINATES = 200_000
MAX_RINGS = 10_000
MAX_JSON_DEPTH = 32
REPO_ROOT = Path(__file__).resolve().parents[3]
_SHA256 = re.compile(r'[0-9a-f]{64}\Z')
_CRS = {
    'EPSG:4326': 'EPSG:4326',
    'urn:ogc:def:crs:EPSG::4326': 'EPSG:4326',
    'OGC:CRS84': 'OGC:CRS84',
    'urn:ogc:def:crs:OGC:1.3:CRS84': 'OGC:CRS84',
}
_METADATA_KEYS = {
    'city_id', 'boundary_definition', 'publisher', 'dataset_title',
    'dataset_version', 'effective_date', 'feature_identifier', 'source_url',
    'retrieval_date', 'license_url', 'attribution', 'declared_crs',
    'coordinate_order', 'expected_source_sha256',
}


class UnsupportedPlatformError(ValueError):
    """Secure file I/O is unavailable; this says nothing about input geometry."""


def canonical_bytes(value):
    """The versioned canonical encoding used for hashes (not RFC 8785 JCS)."""
    try:
        return json.dumps(value, sort_keys=True, separators=(',', ':'),
                          ensure_ascii=True, allow_nan=False).encode('ascii')
    except (TypeError, ValueError, RecursionError) as error:
        raise ValueError('Content cannot be canonically encoded') from error


def _sha(content):
    return hashlib.sha256(content).hexdigest()


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate JSON object key')
        result[key] = value
    return result


def _finite_float(value):
    number = float(value)
    if not math.isfinite(number):
        raise ValueError('Non-finite JSON number')
    return number


def _reject_constant(value):
    raise ValueError('Non-finite JSON constant')


def _parse(content, limit):
    if isinstance(content, str):
        if len(content) > limit:
            raise ValueError('JSON exceeds byte limit')
        try:
            content = content.encode('utf-8')
        except UnicodeError as error:
            raise ValueError('JSON must be valid UTF-8') from error
    if not isinstance(content, bytes) or not content or len(content) > limit:
        raise ValueError('JSON is empty, unsupported, or exceeds byte limit')
    # Bound nesting before the recursive JSON decoder sees the document. Ignore
    # braces inside strings, including escaped quotes and backslashes.
    depth, quoted, escaped = 0, False, False
    for char in content:
        if quoted:
            if escaped:
                escaped = False
            elif char == 92:
                escaped = True
            elif char == 34:
                quoted = False
        elif char == 34:
            quoted = True
        elif char in (91, 123):
            depth += 1
            if depth > MAX_JSON_DEPTH:
                raise ValueError('JSON nesting exceeds limit')
        elif char in (93, 125):
            depth -= 1
    try:
        value = json.loads(content.decode('utf-8'), object_pairs_hook=_unique_object,
                           parse_float=_finite_float, parse_constant=_reject_constant)
    except (UnicodeError, json.JSONDecodeError, RecursionError) as error:
        raise ValueError('Invalid UTF-8 JSON') from error
    if not isinstance(value, dict):
        raise ValueError('JSON root must be an object')
    return value


def _keys(value, expected, label):
    if not isinstance(value, dict) or set(value) != set(expected):
        raise ValueError(f'{label} has missing or unsupported fields')


def _text(value, label, limit=2048):
    if (not isinstance(value, str) or not value or value != value.strip()
            or len(value) > limit or any(ord(c) < 32 or 0xD800 <= ord(c) <= 0xDFFF for c in value)):
        raise ValueError(f'{label} must be non-empty bounded text')
    return value


def _hash(value, label):
    if not isinstance(value, str) or not _SHA256.fullmatch(value):
        raise ValueError(f'{label} must be a lowercase SHA-256 digest')


def _url(value, label):
    _text(value, label)
    try:
        parsed = urlsplit(value)
        if (parsed.scheme not in {'http', 'https'} or not parsed.hostname
                or parsed.username is not None or parsed.password is not None
                or '@' in parsed.netloc or '\\' in value or any(c.isspace() for c in value)):
            raise ValueError
        _ = parsed.port
    except ValueError as error:
        raise ValueError(f'{label} must be a credential-free HTTP(S) URL') from error


def _date(value, label):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        raise ValueError(f'{label} must be an ISO calendar date (YYYY-MM-DD)')
    try:
        date.fromisoformat(value)
    except ValueError as error:
        raise ValueError(f'{label} must be a valid calendar date') from error


def _identity(value):
    if type(value) is int:
        if abs(value) > 2**53 - 1:
            raise ValueError('Feature identifier integer exceeds interoperable range')
    elif isinstance(value, str):
        _text(value, 'Feature identifier', 512)
    else:
        raise ValueError('Feature identifier must be a string or an integer')


def _validate_metadata(metadata, expected_city_id):
    _keys(metadata, _METADATA_KEYS, 'Metadata')
    if len(canonical_bytes(metadata)) > MAX_METADATA_BYTES:
        raise ValueError('Metadata exceeds byte limit')
    _text(expected_city_id, 'Expected registry city ID', 100)
    if metadata['city_id'] != expected_city_id:
        raise ValueError('Metadata city ID does not match expected registry city ID')
    # Lazy import avoids cycles when the read-only registry router uses receipts.
    from .uk_city_registry import get_city
    get_city(expected_city_id)
    definition = metadata['boundary_definition']
    _keys(definition, {'kind', 'name'}, 'Boundary definition')
    if definition['kind'] not in ('administrative', 'built-up', 'settlement', 'other'):
        raise ValueError('Unsupported boundary definition kind')
    _text(definition['name'], 'Boundary definition name', 512)
    for key in ('publisher', 'dataset_title', 'dataset_version', 'attribution'):
        _text(metadata[key], key)
    for key in ('effective_date', 'retrieval_date'):
        _date(metadata[key], key)
    for key in ('source_url', 'license_url'):
        _url(metadata[key], key)
    if metadata['declared_crs'] not in ('EPSG:4326', 'OGC:CRS84'):
        raise ValueError('Declared CRS must be EPSG:4326 or OGC:CRS84')
    if metadata['coordinate_order'] != 'lon-lat':
        raise ValueError('Coordinate order must explicitly be lon-lat')
    _hash(metadata['expected_source_sha256'], 'Expected source SHA-256')
    identifier = metadata['feature_identifier']
    if not isinstance(identifier, dict):
        raise ValueError('Explicit feature identifier is required')
    if identifier.get('type') == 'feature-id':
        _keys(identifier, {'type', 'value'}, 'Feature identifier')
    elif identifier.get('type') == 'property':
        _keys(identifier, {'type', 'key', 'value'}, 'Feature identifier')
        _text(identifier['key'], 'Feature identifier property key', 256)
    else:
        raise ValueError('Feature identifier type must be feature-id or property')
    _identity(identifier['value'])


def _crs(document, metadata):
    if 'crs' not in document:
        return
    crs = document['crs']
    _keys(crs, {'type', 'properties'}, 'GeoJSON CRS')
    _keys(crs['properties'], {'name'}, 'GeoJSON CRS properties')
    name = crs['properties']['name']
    if (crs['type'] != 'name' or not isinstance(name, str)
            or _CRS.get(name) != metadata['declared_crs']):
        raise ValueError('GeoJSON CRS is unsupported or differs from declared CRS')


def _number(value, low, high):
    return type(value) in (int, float) and low <= value <= high and math.isfinite(value)


def _geometry_summary(geometry):
    if not isinstance(geometry, dict) or geometry.get('type') not in ('Polygon', 'MultiPolygon'):
        raise ValueError('Only Polygon or MultiPolygon geometry is supported')
    coordinates = geometry.get('coordinates')
    if not isinstance(coordinates, list) or not coordinates:
        raise ValueError('Geometry coordinates must be a non-empty array')
    polygons = [coordinates] if geometry['type'] == 'Polygon' else coordinates
    if len(polygons) > MAX_RINGS:
        raise ValueError('Polygon count exceeds ring limit')
    ring_count = coordinate_count = 0
    extrema = [180, 90, -180, -90]
    for polygon in polygons:
        if not isinstance(polygon, list) or not polygon:
            raise ValueError('Each polygon requires an exterior ring')
        ring_count += len(polygon)
        if ring_count > MAX_RINGS:
            raise ValueError('Ring count exceeds limit')
        for ring in polygon:
            if not isinstance(ring, list) or len(ring) < 4:
                raise ValueError('Each ring needs at least four positions including closure')
            coordinate_count += len(ring)
            if coordinate_count > MAX_COORDINATES:
                raise ValueError('Coordinate count exceeds limit')
            distinct = set()
            for position in ring:
                if (not isinstance(position, list) or len(position) != 2
                        or not _number(position[0], -180, 180) or not _number(position[1], -90, 90)):
                    raise ValueError('Positions must be finite, non-boolean 2D WGS84 lon-lat coordinates')
                x, y = position
                # Only three distinct positions are needed for this cardinality
                # check; do not allocate a second copy of a large ring.
                if len(distinct) < 3:
                    distinct.add((x, y))
                extrema = [min(extrema[0], x), min(extrema[1], y),
                           max(extrema[2], x), max(extrema[3], y)]
            if ring[0] != ring[-1]:
                raise ValueError('Ring is not explicitly closed; no repair is performed')
            if len(distinct) < 3:
                raise ValueError('Ring needs at least three distinct positions')
    selected = {'type': geometry['type'], 'coordinates': coordinates}
    return {'type': geometry['type'], 'sha256': _sha(canonical_bytes(selected)),
            'polygon_count': len(polygons), 'ring_count': ring_count,
            'coordinate_count': coordinate_count, 'extrema': extrema}


def build_receipt(source_content, metadata_content, expected_city_id):
    """Check supplied source/metadata bytes and return a deterministic receipt.

    Source identity comes only from the explicit metadata selector. The receipt
    excludes source coordinates, filesystem paths, and execution timestamps.
    """
    metadata = _parse(metadata_content, MAX_METADATA_BYTES)
    _validate_metadata(metadata, expected_city_id)
    if not isinstance(source_content, bytes) or not source_content or len(source_content) > MAX_SOURCE_BYTES:
        raise ValueError('Source must be bounded, non-empty bytes')
    source_sha = _sha(source_content)
    if source_sha != metadata['expected_source_sha256']:
        raise ValueError('Source SHA-256 does not match expected input SHA-256')
    document = _parse(source_content, MAX_SOURCE_BYTES)
    _crs(document, metadata)
    if document.get('type') == 'FeatureCollection':
        features = document.get('features')
        if not isinstance(features, list) or len(features) != 1:
            raise ValueError('FeatureCollection must contain exactly one Feature')
        feature = features[0]
    else:
        feature = document
    if not isinstance(feature, dict) or feature.get('type') != 'Feature':
        raise ValueError('Input must be one Feature or an exactly-one-feature collection')
    _crs(feature, metadata)
    if 'properties' not in feature or (feature['properties'] is not None and not isinstance(feature['properties'], dict)):
        raise ValueError('Feature properties must be an object or null')
    identifier = metadata['feature_identifier']
    identity = (feature.get('id') if identifier['type'] == 'feature-id'
                else (feature['properties'] or {}).get(identifier['key']))
    if type(identity) is not type(identifier['value']) or identity != identifier['value']:
        raise ValueError('Source feature identity does not match explicit metadata selector')
    geometry = feature.get('geometry')
    if isinstance(geometry, dict):
        _crs(geometry, metadata)
    summary = _geometry_summary(geometry)
    receipt = {'schema': SCHEMA, 'city_id': expected_city_id, 'metadata': metadata,
               'source': {'sha256': source_sha, 'bytes': len(source_content)},
               'geometry': summary,
               'checker': {'version': CHECKER_VERSION, 'validation_level': VALIDATION_LEVEL},
               'topology': 'not_checked', 'city_boundary_authority': 'not_verified',
               'coverage': 'not_assessed'}
    receipt['checksum_sha256'] = _sha(canonical_bytes(receipt))
    return receipt


def receipt_bytes(receipt):
    """Stable on-disk representation: canonical JSON plus one LF."""
    return canonical_bytes(receipt) + b'\n'


def validate_receipt(content, expected_city_id):
    """Validate only receipt integrity, identity, bounds and non-claim flags.

    Does not open the source, rerun geometry checks, authenticate its publisher,
    or establish topology, boundary authority, or coverage. Checksums are not
    signatures: an author can edit content and recompute its checksum.
    """
    receipt = _parse(content, MAX_RECEIPT_BYTES)
    _keys(receipt, {'schema', 'city_id', 'metadata', 'source', 'geometry', 'checker',
                    'topology', 'city_boundary_authority', 'coverage', 'checksum_sha256'}, 'Receipt')
    if receipt['schema'] != SCHEMA or receipt['city_id'] != expected_city_id:
        raise ValueError('Receipt schema or registry city ID mismatch')
    if (receipt['topology'] != 'not_checked' or receipt['city_boundary_authority'] != 'not_verified'
            or receipt['coverage'] != 'not_assessed'):
        raise ValueError('Receipt cannot upgrade topology, authority, or coverage claims')
    _keys(receipt['checker'], {'version', 'validation_level'}, 'Checker')
    if receipt['checker'] != {'version': CHECKER_VERSION, 'validation_level': VALIDATION_LEVEL}:
        raise ValueError('Unsupported checker version or validation level')
    _validate_metadata(receipt['metadata'], expected_city_id)
    source = receipt['source']
    _keys(source, {'sha256', 'bytes'}, 'Source record')
    _hash(source['sha256'], 'Source SHA-256')
    if source['sha256'] != receipt['metadata']['expected_source_sha256']:
        raise ValueError('Source hash does not match receipt metadata')
    if type(source['bytes']) is not int or not 1 <= source['bytes'] <= MAX_SOURCE_BYTES:
        raise ValueError('Source byte count is out of bounds')
    geometry = receipt['geometry']
    _keys(geometry, {'type', 'sha256', 'polygon_count', 'ring_count', 'coordinate_count', 'extrema'}, 'Geometry record')
    _hash(geometry['sha256'], 'Geometry SHA-256')
    if geometry['type'] not in ('Polygon', 'MultiPolygon'):
        raise ValueError('Unsupported receipt geometry type')
    for key, maximum in (('polygon_count', MAX_RINGS), ('ring_count', MAX_RINGS), ('coordinate_count', MAX_COORDINATES)):
        if type(geometry[key]) is not int or not 1 <= geometry[key] <= maximum:
            raise ValueError('Geometry structure count is out of bounds')
    if (geometry['polygon_count'] > geometry['ring_count']
            or geometry['ring_count'] * 4 > geometry['coordinate_count']
            or (geometry['type'] == 'Polygon' and geometry['polygon_count'] != 1)):
        raise ValueError('Geometry structure counts are inconsistent')
    extrema = geometry['extrema']
    if (not isinstance(extrema, list) or len(extrema) != 4
            or not _number(extrema[0], -180, 180) or not _number(extrema[2], -180, 180)
            or not _number(extrema[1], -90, 90) or not _number(extrema[3], -90, 90)
            or extrema[0] > extrema[2] or extrema[1] > extrema[3]):
        raise ValueError('Geometry extrema are invalid')
    _hash(receipt['checksum_sha256'], 'Receipt checksum')
    payload = {key: value for key, value in receipt.items() if key != 'checksum_sha256'}
    if receipt['checksum_sha256'] != _sha(canonical_bytes(payload)):
        raise ValueError('Receipt checksum mismatch')
    return receipt


def _absolute_path(path):
    path = Path(path)
    if '..' in path.parts:
        raise ValueError('Parent traversal is not permitted in file paths')
    return path if path.is_absolute() else Path.cwd() / path


@contextmanager
def _safe_parent(path):
    """Open every directory without following symlinks, including ancestors."""
    path = _absolute_path(path)
    if not path.name:
        raise ValueError('A regular file path is required')
    if (not hasattr(os, 'O_NOFOLLOW') or not hasattr(os, 'O_DIRECTORY')
            or os.open not in os.supports_dir_fd):
        raise UnsupportedPlatformError('This platform lacks required no-symlink directory-descriptor support')
    descriptor = None
    try:
        descriptor = os.open(path.anchor, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        for part in path.parts[1:-1]:
            following = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = following
        yield descriptor, path.name
    except OSError as error:
        raise ValueError('File access failed: paths must exist with no symlinks or unsafe components') from error
    finally:
        if descriptor is not None:
            os.close(descriptor)


def _read_at(parent_fd, name, limit):
    if type(limit) is not int or not 1 <= limit <= MAX_SOURCE_BYTES:
        raise ValueError('Read limit must be a positive bounded byte count')
    descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent_fd)
    try:
        status = os.fstat(descriptor)
        if not stat.S_ISREG(status.st_mode) or status.st_size > limit:
            raise ValueError('Input must be a bounded regular file')
        source = os.fdopen(descriptor, 'rb')
    except BaseException:
        os.close(descriptor)
        raise
    with source:
        content = source.read(limit + 1)
        if len(content) > limit:
            raise ValueError('Input exceeds byte limit')
        return content


def read_bounded_file(path, limit):
    with _safe_parent(path) as (parent_fd, name):
        return _read_at(parent_fd, name, limit)


def _check_output_path(output, source_path, metadata_path, repo_root):
    output, source_path, metadata_path, repo_root = map(_absolute_path, (output, source_path, metadata_path, repo_root))
    if output.suffix != '.json':
        raise ValueError('Receipt output must have a .json suffix')
    if len({output, source_path, metadata_path}) != 3:
        raise ValueError('Output, source and metadata paths must be separate')
    for protected in (repo_root / 'backend' / 'data', repo_root / 'database'):
        if output == protected or protected in output.parents:
            raise ValueError('Output cannot target repository seed/data directories')
    local = repo_root / '.local'
    allowed = local / 'coverage' / 'boundaries'
    if (output == local or local in output.parents) and output.parent != allowed:
        raise ValueError('Only direct .local/coverage/boundaries receipt files may be written under .local')
    # Hard links also count as overlapping input/output paths. lstat is enough:
    # secure descriptor traversal below independently rejects every symlink.
    identities = []
    for path in (output, source_path, metadata_path):
        try:
            status = path.lstat()
            identity = (status.st_dev, status.st_ino)
            if identity in identities:
                raise ValueError('Source, metadata and output files must not alias each other')
            identities.append(identity)
        except FileNotFoundError:
            pass
    return output


def publish_receipt(output, content, source_path, metadata_path, repo_root=REPO_ROOT):
    """Atomically publish a new file, or accept byte-identical existing output.

    Never replace a file. The output directory must already exist. A temporary
    file is hard-linked into place atomically, then removed even after failure.
    """
    if not isinstance(content, bytes) or len(content) > MAX_RECEIPT_BYTES:
        raise ValueError('Receipt publication content exceeds byte limit')
    output = _check_output_path(output, source_path, metadata_path, repo_root)
    with _safe_parent(output) as (parent_fd, name):
        try:
            existing = _read_at(parent_fd, name, MAX_RECEIPT_BYTES)
        except FileNotFoundError:
            pass
        else:
            if existing != content:
                raise ValueError('Refusing to overwrite a differing existing receipt')
            return False
        temporary = f'.boundary-receipt-{secrets.token_hex(12)}.tmp'
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent_fd)
        try:
            with os.fdopen(descriptor, 'wb') as sink:
                sink.write(content)
                sink.flush()
                os.fsync(sink.fileno())
            try:
                os.link(temporary, name, src_dir_fd=parent_fd, dst_dir_fd=parent_fd, follow_symlinks=False)
            except FileExistsError:
                if _read_at(parent_fd, name, MAX_RECEIPT_BYTES) != content:
                    raise ValueError('Refusing to overwrite a concurrently created receipt') from None
                return False
            os.fsync(parent_fd)
            return True
        finally:
            os.unlink(temporary, dir_fd=parent_fd)
