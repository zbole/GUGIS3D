from typing import Any, Literal

from pydantic import BaseModel, Field


Coordinate3 = tuple[float, float, float]


class Pose(BaseModel):
    strike: float = 0
    dip: float = 0
    roll: float | None = 0


class HybridBox(BaseModel):
    center: Coordinate3
    radius_xyz: Coordinate3
    radius_2d: float
    radius_3d: float


class GugisObject(BaseModel):
    object_id: str
    layer_id: str
    name: str
    shape_type: int
    structure_type: str
    main_type: int
    sub_type: int
    coordinate_mode: Literal["global", "local"]
    base_point: Coordinate3
    pose: Pose = Field(default_factory=Pose)
    hybrid_box: HybridBox
    geometry: dict[str, Any]
    attributes: dict[str, Any] = Field(default_factory=dict)
    visible: bool = True
    opacity: float = Field(default=1.0, ge=0, le=1)


class Layer(BaseModel):
    layer_id: str
    name: str
    object_count: int
    visible: bool = True
    opacity: float = Field(default=1.0, ge=0, le=1)
    placeholder: bool = False


class ObjectQuery(BaseModel):
    layer_id: str | None = None
    structure_type: str | None = None
    text: str | None = None
    attributes: dict[str, Any] | None = None


class HybridBoxQuery(BaseModel):
    center: Coordinate3
    radius_2d: float | None = None
    radius_3d: float | None = None
    layer_id: str | None = None


class MeasureDistanceRequest(BaseModel):
    start: Coordinate3
    end: Coordinate3


class MeasureDistanceResponse(BaseModel):
    distance_meters_2d: float
    distance_meters_3d: float
