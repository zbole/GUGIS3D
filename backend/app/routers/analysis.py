from fastapi import APIRouter

from ..database import get_repository
from ..schemas import GugisObject, HybridBoxQuery, MeasureDistanceRequest, MeasureDistanceResponse
from ..services.hybrid_box import distance_2d_meters, distance_3d_meters, intersects_hybrid_box

router = APIRouter(prefix="/analysis", tags=["analysis"])


@router.post("/hybrid-box-query", response_model=list[GugisObject])
def hybrid_box_query(payload: HybridBoxQuery) -> list[GugisObject]:
    return [obj for obj in get_repository().list_objects() if intersects_hybrid_box(obj, payload)]


@router.post("/measure-distance", response_model=MeasureDistanceResponse)
def measure_distance(payload: MeasureDistanceRequest) -> MeasureDistanceResponse:
    return MeasureDistanceResponse(
        distance_meters_2d=distance_2d_meters(payload.start, payload.end),
        distance_meters_3d=distance_3d_meters(payload.start, payload.end),
    )
