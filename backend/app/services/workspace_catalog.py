"""One bundled catalogue shared with the client; names are not coverage claims."""
import json
import math
from pathlib import Path
import re

CATALOG_PATH = Path(__file__).resolve().parents[3] / 'shared' / 'city-workspaces.json'


def read_catalog():
    records = json.loads(CATALOG_PATH.read_bytes())
    if not isinstance(records, list) or not 1 <= len(records) <= 76:
        raise ValueError('Invalid bundled workspace catalogue')
    seen = set()
    for record in records:
        if (not isinstance(record, dict) or set(record) != {'id', 'name', 'city_name', 'coverage_label',
                                                           'query_bbox_wgs84', 'related_registry_id'}):
            raise ValueError('Invalid workspace catalogue fields')
        city_id = record['id']
        if not isinstance(city_id, str) or not re.fullmatch(r'[a-z][a-z0-9-]{0,60}', city_id) or city_id in seen:
            raise ValueError('Invalid or duplicate workspace identifier')
        seen.add(city_id)
        for key in ['name', 'city_name', 'coverage_label', 'related_registry_id']:
            if not isinstance(record[key], str) or not 1 <= len(record[key]) <= 150:
                raise ValueError('Invalid workspace name or sample association')
        bounds = record['query_bbox_wgs84']
        if (not isinstance(bounds, list) or len(bounds) != 4
            or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in bounds)
            or not -180 <= bounds[0] < bounds[2] <= 180 or not -85 <= bounds[1] < bounds[3] <= 85):
            raise ValueError('Invalid workspace crop bounds')
    return records


WORKSPACES = read_catalog()
CITY_DEFAULTS = {record['id']: {key: record[key] for key in ['name', 'city_name', 'coverage_label', 'query_bbox_wgs84']}
                 for record in WORKSPACES}
CITY_NAMES = {record['id']: record['name'] for record in WORKSPACES}
