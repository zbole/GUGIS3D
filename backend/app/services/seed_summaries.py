"""Pinned summaries of fully validated bundled bytes; unknown files use validation."""
from functools import lru_cache
import hashlib
import json
from pathlib import Path
import sys

import pydantic
import pydantic_core

ROOT = Path(__file__).resolve().parents[3]
RECEIPT_PATH = ROOT / 'backend/data/cities/validated-seed-summaries.json'
# Updated deliberately only after the offline builder fully validates all seeds.
RECEIPT_SHA256 = '2528eae0990e8d037a57f00411cc0f7024d20310fa743be201680e7723c38a2c'
MAX_RECEIPT_BYTES = 65536


def validation_dependencies():
    """Conservative source set, normalized for Git LF/CRLF checkout differences."""
    paths = sorted((ROOT / 'backend/app').rglob('*.py'))
    paths = [path for path in paths if path.resolve() != Path(__file__).resolve()]
    paths += [ROOT / 'shared/box-topology.json', ROOT / 'shared/city-workspaces.json']
    return {path.relative_to(ROOT).as_posix(): hashlib.sha256(
        path.read_text('utf-8').replace('\r\n', '\n').encode()).hexdigest() for path in paths}


def validation_runtime():
    return {'python': list(sys.version_info[:3]), 'pydantic': pydantic.__version__,
            'pydantic_core': pydantic_core.__version__}


@lru_cache(maxsize=1)
def _trusted_records():
    """An invalid/stale receipt disables the shortcut, never marks a city ready."""
    try:
        with RECEIPT_PATH.open('rb') as handle:
            content = handle.read(MAX_RECEIPT_BYTES + 1)
        if len(content) > MAX_RECEIPT_BYTES or hashlib.sha256(content).hexdigest() != RECEIPT_SHA256:
            return None
        report = json.loads(content)
        if (report.get('schema') != 'gugis-validated-seed-summaries-v1'
                or report.get('dependencies') != validation_dependencies()
                or report.get('runtime') != validation_runtime()):
            return None
        records = report['records']
        if not isinstance(records, list) or not 1 <= len(records) <= 76:
            return None
        result = {}
        for record in records:
            sha, size, summary = record['sha256'], record['bytes'], record['summary']
            if (not isinstance(sha, str) or len(sha) != 64 or sha in result
                    or type(size) is not int or not 1 <= size <= 128 * 1024 * 1024
                    or not isinstance(summary, dict) or summary.get('corrupt') is not False
                    or summary.get('revision') != sha):
                return None
            result[sha] = (size, summary)
        return result
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        return None


def trusted_seed_summary(content, revision):
    """Exact bytes + exact validation environment. Never trusts file names/stat alone."""
    records = _trusted_records()
    record = records.get(revision) if records else None
    if record is None or record[0] != len(content):
        return None
    # Keep process-cached records isolated from response mutation.
    return json.loads(json.dumps(record[1]))
