"""Read-only bounded access to explicitly prebuilt immutable render packages."""
import json
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response

from ..services import city_workspaces
from ..services.render_tiles import (MAX_MANIFEST_BYTES, MAX_POINTER_BYTES, REVISION_RE, TILE_RE,
    RenderPackageError, bounded_read, digest, file_signature, validate_manifest)

router = APIRouter(prefix='/cities/{city_id}/render', tags=['Read-only render tiles'])
CACHE_ROOT = Path(__file__).resolve().parents[3] / '.local' / 'render-cache'


def unavailable(code='render_package_unavailable', message='Build this city render package offline before requesting it'):
    return HTTPException(404, detail={'code': code, 'message': message})


def package_manifest(city_id, revision):
    if city_id not in city_workspaces.CITY_DEFAULTS or not REVISION_RE.fullmatch(revision):
        raise unavailable()
    try:
        data = bounded_read(CACHE_ROOT / city_id / revision / 'manifest.json', MAX_MANIFEST_BYTES)
        manifest = validate_manifest(json.loads(data), city_id, revision)
        return data, manifest
    except (OSError, ValueError, TypeError, KeyError) as error:
        raise unavailable('render_package_invalid', 'Render package is missing or invalid; rebuild offline') from error


def reply(data, request, *, immutable, extra_headers=None):
    etag = '"' + digest(data) + '"'
    headers = {'ETag': etag, 'Cache-Control': 'private, max-age=31536000, immutable' if immutable else 'no-cache',
               'X-Content-Type-Options': 'nosniff', **(extra_headers or {})}
    # If-None-Match permits a comma-separated list and weak validators for GET.
    values = [v.strip().removeprefix('W/') for v in request.headers.get('if-none-match', '').split(',')]
    if etag in values or '*' in values:
        return Response(status_code=304, headers=headers)
    return Response(data, media_type='application/json', headers=headers)


@router.get('/manifest')
def manifest(city_id: str, request: Request):
    if city_id not in city_workspaces.CITY_DEFAULTS:
        raise unavailable()
    try:
        pointer = json.loads(bounded_read(CACHE_ROOT / city_id / 'active.json', MAX_POINTER_BYTES))
        revision = pointer['revision']
        if not isinstance(revision, str) or not REVISION_RE.fullmatch(revision):
            raise RenderPackageError('Invalid active revision')
    except (OSError, ValueError, TypeError, KeyError) as error:
        raise unavailable() from error
    data, value = package_manifest(city_id, revision)
    if digest(data) != pointer.get('manifest_sha256'):
        raise unavailable('render_package_invalid', 'Manifest hash differs from the published pointer')
    # Only an exact file identity match proves the offline source is unchanged.
    # Changed stats alone cannot prove a new content revision; do not claim stale.
    from . import city
    formal = city_workspaces.directory(city.CITY_DIR, city_id) / 'current.gugis.json'
    source = formal if formal.is_file() else city_workspaces.seed_path(city.SEED, city_id)
    freshness = 'unknown'
    try:
        if file_signature(source) == pointer.get('source_signature'):
            freshness = 'current'
    except OSError:
        pass
    return reply(data, request, immutable=False, extra_headers={'X-Render-Freshness': freshness,
        'X-Render-Revision': value['revision'], 'Access-Control-Expose-Headers': 'ETag, X-Render-Freshness, X-Render-Revision'})


@router.get('/{revision}/tiles/{tile_id}')
def tile(city_id: str, revision: str, tile_id: str, request: Request):
    if not TILE_RE.fullmatch(tile_id):
        raise unavailable('render_tile_unavailable', 'Unknown render tile')
    _, value = package_manifest(city_id, revision)
    descriptor = next((item for item in value['tiles'] if item['id'] == tile_id), None)
    if descriptor is None:
        raise unavailable('render_tile_unavailable', 'Unknown render tile')
    try:
        data = bounded_read(CACHE_ROOT / city_id / revision / 'tiles' / f'{tile_id}.json', descriptor['byte_length'])
        if len(data) != descriptor['byte_length'] or digest(data) != descriptor['sha256']:
            raise RenderPackageError('Invalid tile content')
    except (OSError, ValueError) as error:
        raise unavailable('render_tile_invalid', 'Render tile hash or size validation failed') from error
    return reply(data, request, immutable=True, extra_headers={'Access-Control-Expose-Headers': 'ETag'})
