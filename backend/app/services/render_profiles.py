"""Observed cell sizes, never a permission to relax package limits."""
import json
import math
from pathlib import Path
from .workspace_catalog import CITY_DEFAULTS

PROFILE_PATH = Path(__file__).resolve().parents[3] / 'shared' / 'render-package-profiles.json'


def read_profiles(path=PROFILE_PATH):
    with path.open('rb') as handle:
        content = handle.read(16385)
    if len(content) > 16384:
        raise ValueError('Render profiles exceed 16 KiB')
    payload = json.loads(content)
    if (not isinstance(payload, dict) or set(payload) != {'schema', 'tile_size_m'}
        or payload['schema'] != 'gugis-render-package-profiles-v1'):
        raise ValueError('Invalid render profile schema')
    sizes = payload['tile_size_m']
    if not isinstance(sizes, dict) or set(sizes) != set(CITY_DEFAULTS):
        raise ValueError('Render profiles must cover exactly the bundled workspaces')
    if any(type(v) not in (int, float) or not math.isfinite(v) or not 10 <= v <= 10000 for v in sizes.values()):
        raise ValueError('Invalid render profile cell size')
    return sizes


RENDER_TILE_SIZES = read_profiles()


def resolve_tile_size(value, city_id):
    if city_id not in CITY_DEFAULTS:
        raise ValueError('Unknown city workspace')
    if value == 'auto':
        return float(RENDER_TILE_SIZES[city_id])
    if isinstance(value, bool):
        raise ValueError('Tile size must be auto or a finite number from 10 to 10000 m')
    try:
        result = float(value)
    except (ValueError, TypeError):
        raise ValueError('Tile size must be auto or a finite number from 10 to 10000 m') from None
    if not math.isfinite(result) or not 10 <= result <= 10000:
        raise ValueError('Tile size must be auto or a finite number from 10 to 10000 m')
    return result
