from fastapi import APIRouter

from ..database import get_repository
from ..schemas import Layer

router = APIRouter(prefix="/layers", tags=["layers"])


@router.get("", response_model=list[Layer])
def list_layers() -> list[Layer]:
    return get_repository().list_layers()
