"""Versioned, self-contained 3D authoring format; not the legacy C++ binary format."""
from collections import Counter
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Number = Annotated[float, Field(allow_inf_nan=False, ge=-10000, le=10000)]
Vector = tuple[Number, Number, Number]
Identifier = Annotated[str, Field(pattern=r"^[a-zA-Z0-9_-]{1,64}$")]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class BuildingParameters(StrictModel):
    name: str = Field(default="语义住宅示范楼", min_length=1, max_length=80)
    kind: Literal["tower", "villa", "georgian", "victorian", "wills", "cabot", "cathedral", "tudor", "warehouse", "chapel", "civic", "footprint", "urban"] = "tower"
    scale: float = Field(default=1, ge=0.5, le=2)
    floors: int = Field(default=12, ge=1, le=30)
    units: int = Field(default=2, ge=1, le=4)
    floor_height: float = Field(default=3.2, ge=2.5, le=4.5)
    longitude: float = Field(default=-2.5879, ge=-180, le=180)
    latitude: float = Field(default=51.4545, ge=-85, le=85)
    altitude: float = Field(default=0, ge=-500, le=9000)
    heading: float = Field(default=0, ge=-180, le=180)

    @model_validator(mode="after")
    def style_limits(self):
        if self.kind == 'warehouse' and self.floors > 8:
            raise ValueError('精细仓库支持最多 8 层，以保持整栋组件数量在可编辑范围内')
        if self.kind == 'warehouse' and self.floors*self.units > 16:
            raise ValueError('精细仓库的楼层数乘单元数不能超过 16')
        if self.kind == 'civic' and self.units > 3:
            raise ValueError('钟楼市政厅支持最多 3 个单元')
        if self.kind in {"georgian", "victorian", "tudor", "warehouse", "chapel", "civic"} and self.floors > 12:
            raise ValueError("Detailed British residential styles support at most 12 floors")
        return self


class SolidTemplate(StrictModel):
    kind: Literal["box", "mesh"]
    color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")
    size: Vector | None = None
    vertices: list[Vector] | None = Field(default=None, min_length=4, max_length=256)
    triangles: list[tuple[int, int, int]] | None = Field(default=None, min_length=4, max_length=512)

    @model_validator(mode="after")
    def validate_solid(self):
        if self.kind == "box":
            if self.size is None or min(self.size) <= 0 or self.vertices is not None or self.triangles is not None:
                raise ValueError("Box requires three positive sizes and no mesh fields")
        else:
            if self.size is not None or self.vertices is None or self.triangles is None:
                raise ValueError("Mesh requires vertices and triangles, with no box size")
            edges = Counter()
            directed = Counter()
            volume = 0.0
            for face in self.triangles:
                if len(set(face)) != 3 or min(face) < 0 or max(face) >= len(self.vertices):
                    raise ValueError("Invalid triangle indices")
                a, b, c = (self.vertices[i] for i in face)
                ab = [b[i] - a[i] for i in range(3)]
                ac = [c[i] - a[i] for i in range(3)]
                cross = (ab[1]*ac[2]-ab[2]*ac[1], ab[2]*ac[0]-ab[0]*ac[2], ab[0]*ac[1]-ab[1]*ac[0])
                if sum(v*v for v in cross) < 1e-12:
                    raise ValueError("Degenerate triangle")
                volume += sum(a[i]*cross[i] for i in range(3))/6
                for i, j in ((face[0], face[1]), (face[1], face[2]), (face[2], face[0])):
                    edges[tuple(sorted((i, j)))] += 1
                    directed[(i, j)] += 1
            if any(count != 2 for count in edges.values()) or any(directed[(a,b)] != directed[(b,a)] for a,b in edges):
                raise ValueError("Mesh must be a closed, consistently oriented solid")
            if volume <= 1e-9:
                raise ValueError("Mesh must enclose positive volume with outward faces")
        return self


class SemanticNode(StrictModel):
    id: Identifier
    parent: Identifier | None = None
    name: str = Field(min_length=1, max_length=100)
    category: Literal["building", "unit", "floor", "dwelling", "room", "slab", "wall", "window", "door", "balcony", "railing", "roof", "stair", "column", "ornament"]
    floor: int | None = Field(default=None, ge=1, le=30)
    unit: int | None = Field(default=None, ge=1, le=4)
    template: Identifier | None = None
    position: Vector | None = None
    rotation_z: float = Field(default=0, ge=-180, le=180)
    attributes: dict[Annotated[str, Field(max_length=60)], Annotated[str, Field(max_length=200)]] = Field(default_factory=dict, max_length=20)


class BuildingDocument(StrictModel):
    format: Literal["gugis-studio"]
    version: Literal["1.0", "1.1", "1.2"]
    coordinate_system: Literal["ENU_METERS_WGS84"]
    parameters: BuildingParameters
    templates: dict[Identifier, SolidTemplate] = Field(min_length=1, max_length=1024)
    nodes: list[SemanticNode] = Field(min_length=1, max_length=12000)
    overview: dict[Identifier, SolidTemplate] | None = Field(default=None, max_length=8)

    @model_validator(mode="after")
    def validate_graph(self):
        seen = {}
        roots = 0
        render_parts = 0
        allowed = {"unit": {"building"}, "floor": {"unit"}, "dwelling": {"floor"},
                   "slab": {"floor"}, "stair": {"floor"}, "roof": {"floor"},
                   "wall": {"dwelling"}, "window": {"dwelling"}, "door": {"dwelling"},
                   "balcony": {"dwelling"}, "railing": {"dwelling"}}
        allowed["room"] = {"floor"}
        for category in ("wall", "window", "door", "balcony", "railing", "column", "ornament"):
            allowed.setdefault(category, set()).update({"room"})
        for node in self.nodes:
            if node.id in seen:
                raise ValueError(f"Duplicate node id: {node.id}")
            if node.parent is None:
                roots += 1
                if node.category != "building" or node.floor is not None or node.unit is not None:
                    raise ValueError("Root must be a building without floor or unit")
            else:
                parent = seen.get(node.parent)
                if parent is None:
                    raise ValueError("Parents must exist before children; cycles are not allowed")
                if parent.category not in allowed.get(node.category, set()):
                    raise ValueError("Invalid semantic parent/category relationship")
                if node.unit is None or (parent.unit is not None and node.unit != parent.unit):
                    raise ValueError("Unit metadata must agree with the parent")
                if node.category != "unit" and (node.floor is None or (parent.floor is not None and node.floor != parent.floor)):
                    raise ValueError("Floor metadata must agree with the parent")
            if node.floor is not None and node.floor > self.parameters.floors:
                raise ValueError("Floor exceeds document parameters")
            if node.unit is not None and node.unit > self.parameters.units:
                raise ValueError("Unit exceeds document parameters")
            is_group = node.category in {"building", "unit", "floor", "dwelling", "room"}
            if is_group and node.rotation_z != 0:
                raise ValueError("Only solid components may have a local rotation")
            if self.version != "1.2" and (node.rotation_z != 0 or self.overview is not None):
                raise ValueError("Local rotations and overview solids require Studio 1.2")
            if is_group != (node.template is None and node.position is None):
                raise ValueError("Groups have no geometry; components require template and position")
            if not is_group and (node.template not in self.templates or node.position is None):
                raise ValueError("Missing template or component position")
            if node.template:
                template = self.templates[node.template]
                render_parts += 1 if template.kind == "box" else len(template.triangles)
            seen[node.id] = node
        if roots != 1:
            raise ValueError("Exactly one building root is required")
        if render_parts == 0:
            raise ValueError("Building must contain at least one solid component")
        limit = 120000 if self.version == "1.2" else 20000
        if self.version != "1.2" and len(self.templates) > 256:
            raise ValueError("Studio 1.0 / 1.1 support at most 256 templates")
        if render_parts > limit:
            raise ValueError(f"Document exceeds the {limit:,} render-part limit")
        return self
