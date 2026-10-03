"""Read-only review/download routes, separate from all workspace state routes."""
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from ..services import source_candidates

router = APIRouter(prefix='/cities/{city_id}/source-candidates', tags=['Read-only source candidates'])


def _error(error):
    if isinstance(error, source_candidates.CandidateNotFound):
        return HTTPException(404, detail={'code': 'source_candidate_not_found', 'message': str(error)})
    return HTTPException(503, detail={'code': 'source_candidate_integrity_failed',
        'message': 'Candidate provenance validation failed. No candidate bytes were served; existing projects were not changed.'},
        headers={'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'})


def _reply(data, request, metadata=None):
    etag = '"' + source_candidates.digest(data) + '"'
    headers = {'ETag': etag, 'Cache-Control': 'private, no-cache', 'X-Content-Type-Options': 'nosniff',
        'Access-Control-Expose-Headers': 'ETag, Content-Disposition, Content-Length'}
    if metadata is not None:
        headers['Content-Disposition'] = f'attachment; filename="{metadata["filename"]}"'
    # Even hash-addressed downloads revalidate: damaged provenance must not be
    # hidden by a cached 304. Callers have verified all inputs before this point.
    validators = [item.strip().removeprefix('W/') for item in request.headers.get('if-none-match', '').split(',')]
    if etag in validators or '*' in validators:
        return Response(status_code=304, headers=headers)
    return Response(data, headers=headers, media_type=metadata['media_type'] if metadata else 'application/json')


@router.get('')
def catalogue(city_id: str, request: Request):
    try:
        data = source_candidates.catalogue(city_id)
    except (source_candidates.CandidateNotFound, source_candidates.CandidateIntegrityError) as error:
        raise _error(error) from error
    return _reply(data, request)


@router.get('/{version}/downloads/{revision}/{kind}')
def download(city_id: str, version: str, revision: str, kind: str, request: Request):
    try:
        data, metadata = source_candidates.download(city_id, version, revision, kind)
    except (source_candidates.CandidateNotFound, source_candidates.CandidateIntegrityError) as error:
        raise _error(error) from error
    return _reply(data, request, metadata)
