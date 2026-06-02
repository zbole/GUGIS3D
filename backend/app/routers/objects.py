from fastapi import APIRouter, HTTPException, Query

from ..database import get_repository
from ..schemas import GugisObject, ObjectQuery
from ..services.gugis_adapter import query_objects

router = APIRouter(prefix="/objects", tags=["objects"])


@router.get("", response_model=list[GugisObject])
def list_objects(layer_id: str | None = Query(default=None)) -> list[GugisObject]:
    return get_repository().list_objects(layer_id=layer_id)


@router.get("/{object_id}", response_model=GugisObject)
def get_object(object_id: str) -> GugisObject:
    obj = get_repository().get_object(object_id)
    if obj is None:
        raise HTTPException(status_code=404, detail=f"Object {object_id} not found")
    return obj


@router.post("/query", response_model=list[GugisObject])
def query(payload: ObjectQuery) -> list[GugisObject]:
    return query_objects(
        get_repository().list_objects(),
        layer_id=payload.layer_id,
        structure_type=payload.structure_type,
        text=payload.text,
        attributes=payload.attributes,
    )
