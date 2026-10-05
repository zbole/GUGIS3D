from fastapi import APIRouter
from fastapi.responses import Response
from ..services import public_city_datasets

router = APIRouter(prefix='/cities/{city_id}', tags=['Read-only public city datasets'])


@router.get('/public-dataset')
def metadata(city_id: str):
    source, _ = public_city_datasets.read(city_id)
    return {'status': 'available', 'source': source}


@router.get('/public-dataset.gugis.json')
def download(city_id: str):
    source, content = public_city_datasets.read(city_id)
    return Response(content, media_type='application/json', headers={
        'Content-Disposition': f'attachment; filename="{city_id}-public-seed.gugis.json"',
        'X-GUGIS-Source-SHA256': source['sha256'], 'Cache-Control': 'no-store',
    })
