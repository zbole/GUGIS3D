"""Bounded read-only catalogue of two audited, non-active source candidates.

The manifest pins the exact original/source/candidate/receipt/notice bytes. Paths
are an application allowlist, never input from the manifest or an HTTP request.
Serving neither expands geometry nor consults/initializes any user workspace.
"""
from functools import lru_cache
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import zipfile


DATA_ROOT = Path(__file__).resolve().parents[2] / 'data' / 'cities'
AUDIT_NAME = 'source-candidates-audit-v1.json'
# Updating the audit requires code review, including decoded-geometry tests.
AUDIT_SHA256 = 'f91daf40f2bc0e161da88c8849d48a70a86a90080a940e1a524e170babecb0e9'
MAX_AUDIT_BYTES = 64 * 1024
MAX_DOCUMENT_BYTES = 4 * 1024 * 1024
MAX_RECEIPT_BYTES = 64 * 1024
MAX_BUNDLE_BYTES = 5 * 1024 * 1024
MAX_SUMMARY_BYTES = 64 * 1024
REVISION_RE = re.compile(r'[0-9a-f]{64}\Z')
CANDIDATE_CITIES = frozenset(('london', 'birmingham'))
KNOWN_CITIES = CANDIDATE_CITIES | {'bristol'}
KINDS = frozenset(('provenance', 'archive', 'report'))
FORMAT = 'gugis-source-candidates'
COMPARISON_BASIS = 'original-seed-vs-non-active-candidate'


class CandidateNotFound(ValueError):
    """A request is outside the fixed published candidate allowlist."""


class CandidateIntegrityError(ValueError):
    """No content is served if immutable inputs no longer match the audit."""


def digest(content):
    return hashlib.sha256(content).hexdigest()


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')


def input_paths(city_id):
    if city_id not in CANDIDATE_CITIES:
        raise CandidateNotFound('No audited source candidate for this city')
    return {
        'baseline_archive': (f'baselines/v1/{city_id}.gugis.json', MAX_DOCUMENT_BYTES),
        'baseline_receipt': (f'{city_id}-import.json', MAX_RECEIPT_BYTES),
        'candidate_archive': (f'candidates/v2/{city_id}.gugis.json', MAX_DOCUMENT_BYTES),
        'candidate_receipt': (f'candidates/v2/{city_id}-import.json', MAX_RECEIPT_BYTES),
        'source': (f'{city_id}-osm.json', MAX_DOCUMENT_BYTES),
        'source_receipt': (f'{city_id}-source.json', MAX_RECEIPT_BYTES),
        'readme': ('candidates/v2/README.md', MAX_RECEIPT_BYTES),
        'licence': ('DATA_LICENSE.md', MAX_RECEIPT_BYTES),
    }


def _signature(value):
    return (value.st_dev, value.st_ino, value.st_mode, value.st_size,
            value.st_mtime_ns, value.st_ctime_ns)


def _same_opened_file(path_signature, descriptor_signature, *, platform=os.name):
    # CPython on Windows can report creation time for lstat().st_ctime_ns and
    # metadata-change time for fstat().st_ctime_ns on the same unchanged file.
    # Keep identity, mode, length and modification time checks across the open;
    # compare full signatures within each API before/after reading below.
    fields = 5 if platform == 'nt' else 6
    return path_signature[:fields] == descriptor_signature[:fields]


def _is_link(value):
    # Windows junctions and other reparse points must also fail closed. Merely
    # checking S_ISLNK is insufficient for directory junctions on Windows.
    reparse = getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 0x400)
    return stat.S_ISLNK(value.st_mode) or bool(getattr(value, 'st_file_attributes', 0) & reparse)


def _chain(root, relative):
    parts = relative.split('/')
    if (not parts or any(not part or part in ('.', '..') or '\\' in part or ':' in part for part in parts)
            or Path(relative).is_absolute()):
        raise CandidateIntegrityError('Unsafe immutable input path')
    path = root
    signatures = []
    for index, part in enumerate((None, *parts)):
        if part is not None:
            path = path / part
        value = path.lstat()
        if _is_link(value):
            raise CandidateIntegrityError('Immutable inputs cannot use symlinks or reparse points')
        directory = index < len(parts)
        if not (stat.S_ISDIR(value.st_mode) if directory else stat.S_ISREG(value.st_mode)):
            raise CandidateIntegrityError('Immutable inputs must be regular files in real directories')
        signatures.append(_signature(value))
    return path, signatures


def bounded_read(root, relative, limit, expected_length=None):
    """Portable checked reads, bounded before and during IO, with no writes.

    O_NOFOLLOW/O_NONBLOCK strengthen POSIX opens when available, but are not
    required on Windows. lstat/reparse checks, descriptor identity checks, and
    before/after path checks work on both. Callers always verify the exact-byte
    pinned hash too: a stat fingerprint is never proof of content integrity.
    """
    if (type(limit) is not int or limit <= 0 or limit > MAX_BUNDLE_BYTES or
            (expected_length is not None and
             (type(expected_length) is not int or not 0 < expected_length <= limit))):
        raise CandidateIntegrityError('Invalid immutable input size limit')
    path, before = _chain(root, relative)
    length = before[-1][3]
    if length > limit or (expected_length is not None and length != expected_length):
        raise CandidateIntegrityError('Immutable input size differs from the audit')
    flags = os.O_RDONLY | getattr(os, 'O_BINARY', 0) | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0)
    descriptor = os.open(path, flags)
    with os.fdopen(descriptor, 'rb') as source:
        opened = os.fstat(source.fileno())
        opened_signature = _signature(opened)
        if (_is_link(opened) or not stat.S_ISREG(opened.st_mode) or
                not _same_opened_file(before[-1], opened_signature)):
            raise CandidateIntegrityError('Immutable input changed before opening')
        content = source.read((expected_length if expected_length is not None else limit) + 1)
        after = os.fstat(source.fileno())
    _, paths_after = _chain(root, relative)
    if (_signature(after) != opened_signature or paths_after != before or len(content) != length or
            len(content) > limit or (expected_length is not None and len(content) != expected_length)):
        raise CandidateIntegrityError('Immutable input changed during reading')
    return content


def _descriptor_valid(value, limit):
    return (isinstance(value, dict) and set(value) == {'sha256', 'byte_length'} and
            isinstance(value['sha256'], str) and REVISION_RE.fullmatch(value['sha256']) and
            type(value['byte_length']) is int and 0 < value['byte_length'] <= limit)


def read_audit():
    content = bounded_read(DATA_ROOT, AUDIT_NAME, MAX_AUDIT_BYTES)
    if digest(content) != AUDIT_SHA256:
        raise CandidateIntegrityError('Candidate audit hash does not match the reviewed manifest')
    audit = json.loads(content)
    if (not isinstance(audit, dict) or audit.get('format') != 'gugis-source-candidate-audit' or
            type(audit.get('schema_version')) is not int or audit['schema_version'] != 1 or
            not isinstance(audit.get('cities'), dict) or set(audit['cities']) != CANDIDATE_CITIES):
        raise CandidateIntegrityError('Invalid candidate audit schema')
    return audit


def verified_inputs(city_id):
    entry = read_audit()['cities'][city_id]
    paths = input_paths(city_id)
    if set(entry['files']) != set(paths):
        raise CandidateIntegrityError('Candidate audit input set is invalid')
    inputs = {}
    for role, (path, maximum) in paths.items():
        descriptor = entry['files'][role]
        if not _descriptor_valid(descriptor, maximum):
            raise CandidateIntegrityError('Invalid candidate audit input descriptor')
        content = bounded_read(DATA_ROOT, path, maximum, descriptor['byte_length'])
        if digest(content) != descriptor['sha256']:
            raise CandidateIntegrityError('Immutable input hash differs from the audit')
        inputs[role] = content
    _check_receipts(city_id, entry, inputs)
    return entry, inputs


def _check_receipts(city_id, entry, inputs):
    """Receipts and the catalogue must agree, not just be individually hashed."""
    summary = entry['summary']
    if summary['version'] != 'v2' or summary['status'] != 'non-active':
        raise CandidateIntegrityError('Unsupported candidate version or status')
    source = json.loads(inputs['source_receipt'])
    source_digest = entry['files']['source']['sha256']
    if (source['city_id'] != city_id or source['sha256'] != source_digest or
            source['bytes'] != len(inputs['source']) or summary['source']['sha256'] != source_digest or
            summary['source']['snapshot'] != source['osm_timestamp']):
        raise CandidateIntegrityError('Source receipt and audit disagree')
    for role in ('baseline', 'candidate'):
        receipt = json.loads(inputs[f'{role}_receipt'])
        archive = entry['files'][f'{role}_archive']
        value = summary[role]
        if (receipt['city_id'] != city_id or receipt['source_sha256'] != source_digest or
                receipt['gugis_sha256'] != archive['sha256'] or receipt['gugis_bytes'] != archive['byte_length'] or
                value['revision'] != archive['sha256'] or value['building_count'] != receipt['imported_buildings'] or
                value['road_count'] != receipt['imported_roads'] or value['height_policy'] != receipt['height_policy'] or
                receipt['query_bbox_wgs84'] != summary['source']['query_bbox_wgs84'] or
                receipt['actual_data_bbox_wgs84'] != summary['source']['actual_data_bbox_wgs84'] or
                receipt['license'] != summary['source']['licence']):
            raise CandidateIntegrityError('Import receipt and audit disagree')
    for kind in KINDS:
        if not _descriptor_valid(entry['downloads'][kind], MAX_BUNDLE_BYTES):
            raise CandidateIntegrityError('Invalid download descriptor')
    if (entry['downloads']['archive'] != entry['files']['candidate_archive'] or
            entry['downloads']['report'] != entry['files']['candidate_receipt']):
        raise CandidateIntegrityError('Download and input descriptors disagree')


def package_notice(city_id):
    return (f"GUGIS {city_id} source candidate v2: provenance package\n"
        "===================================================\n\n"
        "This is a non-active, partial central-district sample, not whole-city coverage.\n"
        "Downloading or opening this ZIP does not change any project.\n\n"
        "Contents\n"
        f"- {city_id}.gugis.json: the complete candidate archive for this sample\n"
        f"- {city_id}-import.json: candidate conversion and omission receipt\n"
        f"- {city_id}-baseline-import.json: original seed conversion receipt\n"
        f"- {city_id}-source.json: retained OSM acquisition metadata (not raw OSM geometry)\n"
        "- audit-summary.json: original-seed comparison, limits and exact input hashes\n"
        "- README.md: unchanged original candidate-directory documentation\n"
        "- DATA_LICENSE.md: unchanged attribution and ODbL licence information\n"
        "- PACKAGE-README.txt: this package-specific explanation\n\n"
        "The raw OpenStreetMap extract and original seed archive are NOT bundled.\n"
        "In the originating GUGIS repository they are retained at:\n"
        f"  backend/data/cities/{city_id}-osm.json\n"
        f"  backend/data/cities/baselines/v1/{city_id}.gugis.json\n"
        "The source and seed hashes in audit-summary.json identify those exact files.\n"
        "The original README.md describes the repository layout, including sources\n"
        "two directories above; those relative paths do not describe this ZIP.\n\n"
        "Any later import is a full replacement candidate for the selected city's\n"
        "sample project, not an incremental patch or automatic fix. Preserve an\n"
        "export/recoverable copy of existing work first. An explicit manual draft\n"
        "review is required before separately deciding to commit or discard it.\n"
        "Review removed objects and source height corrections, and confirm the city.\n"
        "OSM tagged heights are not independently measured. No DEM is included.\n\n"
        "Keep the attribution, ODbL licence notices and provenance with redistributed\n"
        "candidate data. Application code has a separate licence.\n").encode('utf-8')


def bundle_bytes(city_id, entry, inputs):
    """Stored ZIPs avoid zlib/platform-dependent compression and timestamp bytes."""
    members = {
        f'{city_id}.gugis.json': inputs['candidate_archive'],
        f'{city_id}-import.json': inputs['candidate_receipt'],
        f'{city_id}-source.json': inputs['source_receipt'],
        f'{city_id}-baseline-import.json': inputs['baseline_receipt'],
        'README.md': inputs['readme'],
        'PACKAGE-README.txt': package_notice(city_id),
        'DATA_LICENSE.md': inputs['licence'],
        'audit-summary.json': json_bytes({'format': 'gugis-source-candidate-audit-summary', 'schema_version': 1,
            'city_id': city_id, 'comparison_basis': COMPARISON_BASIS, 'files': entry['files'], **entry['summary']}),
    }
    if sum(len(value) for value in members.values()) + 4096 > MAX_BUNDLE_BYTES:
        raise CandidateIntegrityError('Candidate provenance bundle exceeds the size limit')
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', compression=zipfile.ZIP_STORED, allowZip64=False) as package:
        for name in sorted(members):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 0
            info.external_attr = 0x20  # DOS archive attribute, identical on Windows/POSIX.
            info.compress_type = zipfile.ZIP_STORED
            package.writestr(info, members[name])
    data = buffer.getvalue()
    if len(data) > MAX_BUNDLE_BYTES:
        raise CandidateIntegrityError('Candidate provenance bundle exceeds the size limit')
    return data


def download_metadata(city_id, entry, kind):
    descriptor = entry['downloads'][kind]
    suffix, media_type = {'provenance': ('-provenance.zip', 'application/zip'),
        'archive': ('.gugis.json', 'application/json'), 'report': ('-import.json', 'application/json')}[kind]
    return {**descriptor, 'url': f'/cities/{city_id}/source-candidates/v2/downloads/{descriptor["sha256"]}/{kind}',
            'filename': f'{city_id}-source-candidate-v2{suffix}', 'media_type': media_type}


@lru_cache(maxsize=2)
def _catalogue_bytes(city_id, summary_bytes):
    # Only bounded immutable JSON bytes are retained, never geometry or ZIPs.
    candidates = [] if city_id == 'bristol' else [json.loads(summary_bytes)]
    result = json_bytes({'format': FORMAT, 'schema_version': 1, 'city_id': city_id,
        'comparison_basis': COMPARISON_BASIS, 'candidates': candidates})
    if len(result) > MAX_SUMMARY_BYTES:
        raise CandidateIntegrityError('Candidate catalogue exceeds the size limit')
    return result


def catalogue(city_id):
    if city_id not in KNOWN_CITIES:
        raise CandidateNotFound('Unknown city')
    try:
        if city_id == 'bristol':
            return _catalogue_bytes(city_id, b'')
        entry, _ = verified_inputs(city_id)
        value = {**entry['summary'], 'downloads': {kind: download_metadata(city_id, entry, kind) for kind in sorted(KINDS)}}
        content = json_bytes(value)
        if len(content) > MAX_SUMMARY_BYTES:
            raise CandidateIntegrityError('Candidate summary exceeds the size limit')
        return _catalogue_bytes(city_id, content)
    except (OSError, ValueError, TypeError, KeyError) as error:
        raise CandidateIntegrityError('Candidate audit or one of its immutable inputs is invalid') from error


def download(city_id, version, revision, kind):
    if (city_id not in CANDIDATE_CITIES or version != 'v2' or kind not in KINDS or
            not isinstance(revision, str) or not REVISION_RE.fullmatch(revision)):
        raise CandidateNotFound('Unknown source candidate download')
    try:
        # Unknown digests are rejected before loading the much larger inputs.
        audit_entry = read_audit()['cities'][city_id]
        if revision != audit_entry['downloads'][kind]['sha256']:
            raise CandidateNotFound('Unknown source candidate download digest')
        entry, inputs = verified_inputs(city_id)
        metadata = download_metadata(city_id, entry, kind)
        content = (bundle_bytes(city_id, entry, inputs) if kind == 'provenance' else
                   inputs['candidate_archive' if kind == 'archive' else 'candidate_receipt'])
        if len(content) != metadata['byte_length'] or digest(content) != metadata['sha256']:
            raise CandidateIntegrityError('Download bytes differ from the audited download')
        return content, metadata
    except CandidateNotFound:
        raise
    except (OSError, ValueError, TypeError, KeyError) as error:
        raise CandidateIntegrityError('Candidate audit or one of its immutable inputs is invalid') from error
