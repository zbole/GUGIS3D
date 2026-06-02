from fastapi import APIRouter

from ..database import get_repository
from ..services.gugis_adapter import to_gugis_collection

router = APIRouter(prefix="/export", tags=["export"])


@router.post("/gugis-json")
def export_gugis_json() -> dict[str, object]:
    return to_gugis_collection(get_repository().list_objects())
