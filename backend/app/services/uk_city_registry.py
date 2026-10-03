"""Read-only national membership snapshot, independent of active workspaces.

This registry carries names and provenance, never geometry or a coverage claim.
Returned dictionaries are fresh so callers cannot mutate subsequent responses.
"""
import json
import re
from collections import Counter
from pathlib import Path

REGISTRY_PATH = Path(__file__).resolve().parents[2] / 'data' / 'uk-city-registry.json'
MAX_REGISTRY_BYTES = 128 * 1024
_COUNTRIES = {'England': 'ENG', 'Northern Ireland': 'NIR', 'Scotland': 'SCT', 'Wales': 'WLS'}
_COUNTS = {'England': 55, 'Northern Ireland': 6, 'Scotland': 8, 'Wales': 7}
_CITY_FIELDS = {'id', 'source_name', 'display_name', 'country', 'country_code', 'aliases', 'source_annotation'}


def read_registry() -> dict:
    """Read and validate the bundled 76-city snapshot without creating anything."""
    with REGISTRY_PATH.open('rb') as handle:
        content = handle.read(MAX_REGISTRY_BYTES + 1)
    if len(content) > MAX_REGISTRY_BYTES:
        raise ValueError('UK city registry exceeds the size limit')
    registry = json.loads(content)
    if not isinstance(registry, dict) or registry.get('schema') != 'gugis-uk-city-registry-v1':
        raise ValueError('Invalid UK city registry schema')
    source, cities = registry.get('source'), registry.get('cities')
    if not isinstance(source, dict) or any(not isinstance(source.get(key), str) or not source[key]
        for key in ('title', 'url', 'published_at', 'verified_at', 'license', 'license_url',
                    'attribution', 'scope', 'conferral_caveat')):
        raise ValueError('Invalid UK city registry source')
    if not isinstance(cities, list) or len(cities) != 76:
        raise ValueError('Invalid UK city registry membership')
    seen = set()
    for record in cities:
        if not isinstance(record, dict) or set(record) != _CITY_FIELDS:
            raise ValueError('Invalid UK city record')
        city_id, country = record['id'], record['country']
        if (not isinstance(country, str) or country not in _COUNTRIES or
            record['country_code'] != _COUNTRIES[country] or
            not isinstance(city_id, str) or
            not re.fullmatch(r'uk-' + _COUNTRIES[country].lower() + r'-[a-z0-9]+(?:-[a-z0-9]+)*', city_id)
            or city_id in seen):
            raise ValueError('Invalid or duplicate UK city identity')
        seen.add(city_id)
        if any(not isinstance(record[key], str) or not 1 <= len(record[key]) <= 100
               for key in ('source_name', 'display_name')):
            raise ValueError('Invalid UK city name')
        annotation = record['source_annotation']
        if annotation is not None and annotation != {'marker': '*', 'meaning': 'Also awarded a Lord Mayoralty or Lord Provostship'}:
            raise ValueError('Invalid UK city source annotation')
        aliases = record['aliases']
        if (not isinstance(aliases, list) or len(aliases) > 10 or
            any(not isinstance(alias, str) or not 1 <= len(alias) <= 100 for alias in aliases)):
            raise ValueError('Invalid UK city aliases')
    if Counter(record['country'] for record in cities) != _COUNTS or registry.get('country_counts') != _COUNTS:
        raise ValueError('Invalid UK city country totals')
    return registry


def get_city(city_id: str) -> dict:
    """Return an exact country-qualified identity; names/aliases are not IDs."""
    for city in read_registry()['cities']:
        if city['id'] == city_id:
            return city
    raise ValueError('Unknown UK city identifier')
