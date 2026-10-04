from typing import Annotated, Literal
from pydantic import Field, PrivateAttr, model_validator
from .studio_models import StrictModel, BuildingDocument, Identifier, SolidTemplate, BuildingParameters, SemanticNode, Number, Vector
from .environment_models import Environment

# Expanded districts keep bounded documents; render residency is limited separately.
MAX_CITY_ASSETS = 15000
MAX_CITY_INSTANCES = 15000
MAX_CITY_ROADS = 10000
MAX_INSTANCED_SEMANTIC_NODES = 300000


class Placement(StrictModel):
    id: Identifier
    asset: Identifier
    name: str = Field(min_length=1, max_length=80)
    longitude: float = Field(ge=-180, le=180)
    latitude: float = Field(ge=-85, le=85)
    altitude: float = Field(default=0, ge=-500, le=9000)
    heading: float = Field(default=0, ge=-180, le=180)


class Road(StrictModel):
    id: Identifier
    name: str = Field(max_length=100)
    width: float = Field(ge=1, le=50)
    coordinates: list[tuple[float, float]] = Field(min_length=2, max_length=1000)

    @model_validator(mode="after")
    def geographic_bounds(self):
        if any(not (-180 <= x <= 180 and -85 <= y <= 85) for x,y in self.coordinates):
            raise ValueError("Road coordinates must be WGS84 longitude / latitude")
        return self


class CityDocument(StrictModel):
    format: Literal["gugis-city"]
    version: Literal["1.0"]
    coordinate_system: Literal["ENU_METERS_WGS84"]
    name: str = Field(min_length=1, max_length=80)
    assets: dict[Identifier, BuildingDocument] = Field(max_length=MAX_CITY_ASSETS)
    instances: list[Placement] = Field(max_length=MAX_CITY_INSTANCES)
    roads: list[Road] = Field(default_factory=list, max_length=MAX_CITY_ROADS)
    metadata: dict[str, str] = Field(default_factory=dict, max_length=30)
    environment: Environment | None = None

    @model_validator(mode="after")
    def references(self):
        ids = [i.id for i in self.instances]
        if len(set(ids)) != len(ids):
            raise ValueError("Duplicate city object id")
        if any(i.asset not in self.assets for i in self.instances):
            raise ValueError("Missing city asset")
        if sum(len(self.assets[i.asset].nodes) for i in self.instances) > MAX_INSTANCED_SEMANTIC_NODES:
            raise ValueError(f"City exceeds {MAX_INSTANCED_SEMANTIC_NODES:,} instanced semantic nodes")
        if len({r.id for r in self.roads}) != len(self.roads):
            raise ValueError("Duplicate road id")
        return self


PositiveNumber = Annotated[float, Field(gt=0, le=10000, allow_inf_nan=False)]
PositiveVector = tuple[PositiveNumber, PositiveNumber, PositiveNumber]
BoxBounds = tuple[Number, Number, Number, Number, Number, Number]


class SharedGeometry(StrictModel):
    kind: Literal["box", "box-set", "mesh"]
    bounds: list[BoxBounds] | None = Field(default=None, min_length=1, max_length=32)
    vertices: list[Vector] | None = Field(default=None, min_length=4, max_length=256)
    triangles: list[tuple[int, int, int]] | None = Field(default=None, min_length=4, max_length=512)
    _solid: SolidTemplate = PrivateAttr()

    @model_validator(mode="after")
    def geometry(self):
        if self.kind == "box":
            if self.bounds is not None or self.vertices is not None or self.triangles is not None:
                raise ValueError("Unit-box prototype has no embedded dimensions or mesh data")
            self._solid = SolidTemplate(kind="box", color="#ffffff", size=(1,1,1))
        elif self.kind == "box-set":
            if self.bounds is None or self.vertices is not None or self.triangles is not None:
                raise ValueError("Box-set requires bounds only")
            if any(any(b[k] >= b[k+3] for k in range(3)) for b in self.bounds):
                raise ValueError("Box-set bounds must have strictly positive dimensions")
            from .services.box_parameters import box_set_mesh
            vertices, triangles = box_set_mesh(self.bounds)
            self._solid = SolidTemplate(kind="mesh", color="#ffffff", vertices=vertices, triangles=triangles)
        else:
            if self.bounds is not None:
                raise ValueError("Mesh cannot carry box-set parameters")
            self._solid = SolidTemplate(kind="mesh", color="#ffffff", vertices=self.vertices, triangles=self.triangles)
        return self


class GeometryBinding(StrictModel):
    geometry: Identifier
    color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")
    size: PositiveVector | None = None

    def resolve(self, library):
        if self.geometry not in library:
            raise ValueError(f"Missing shared geometry: {self.geometry}")
        record = library[self.geometry]
        if (record.kind == "box") != (self.size is not None):
            raise ValueError("Dimensions are required only for a unit-box binding")
        updates = {"color": self.color}
        if self.size is not None:
            updates["size"] = self.size
        # Geometry is already validated once in the shared library. Materials
        # are independent; mesh arrays can remain shared across buildings.
        return record._solid.model_copy(update=updates)


class PooledBuilding(StrictModel):
    format: Literal["gugis-studio"]
    version: Literal["1.0", "1.1", "1.2"]
    coordinate_system: Literal["ENU_METERS_WGS84"]
    parameters: BuildingParameters
    templates: dict[Identifier, GeometryBinding] = Field(min_length=1, max_length=1024)
    nodes: list[SemanticNode] = Field(min_length=1, max_length=12000)
    overview: dict[Identifier, GeometryBinding] | None = Field(default=None, max_length=8)

    def resolve(self, library):
        return BuildingDocument(
            format=self.format, version=self.version, coordinate_system=self.coordinate_system,
            parameters=self.parameters, nodes=self.nodes,
            templates={key:binding.resolve(library) for key,binding in self.templates.items()},
            overview={key:binding.resolve(library) for key,binding in self.overview.items()} if self.overview is not None else None,
        )


class PooledCity(StrictModel):
    format: Literal["gugis-city"]
    version: Literal["1.1", "1.2"]
    coordinate_system: Literal["ENU_METERS_WGS84"]
    name: str = Field(min_length=1, max_length=80)
    geometry_library: dict[Identifier, SharedGeometry] = Field(max_length=50000)
    assets: dict[Identifier, PooledBuilding] = Field(max_length=MAX_CITY_ASSETS)
    instances: list[Placement] = Field(max_length=MAX_CITY_INSTANCES)
    roads: list[Road] = Field(default_factory=list, max_length=MAX_CITY_ROADS)
    metadata: dict[str, str] = Field(default_factory=dict, max_length=30)
    environment: Environment | None = None
    _document: CityDocument = PrivateAttr()

    @model_validator(mode="after")
    def references(self):
        if self.environment is not None and self.version != '1.2':
            raise ValueError('Environment primitives require City 1.2')
        self._document = CityDocument(
            format=self.format, version="1.0", coordinate_system=self.coordinate_system,
            name=self.name, instances=self.instances, roads=self.roads, metadata=self.metadata,
            environment=self.environment,
            assets={key:asset.resolve(self.geometry_library) for key,asset in self.assets.items()},
        )
        return self


CityPayload = Annotated[CityDocument | PooledCity, Field(discriminator="version")]


class CityWrite(StrictModel):
    base_revision: str = Field(pattern=r"^[a-f0-9]{64}$")
    document: CityPayload


class GeoJSONImport(StrictModel):
    type: Literal["FeatureCollection"]
    features: list[dict] = Field(min_length=1, max_length=500)
    name: str = Field(default="GeoJSON 街区", max_length=80)
