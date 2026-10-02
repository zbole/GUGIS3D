"""GUGIS environment primitives; analytic definitions survive serialization."""
from typing import Annotated, Literal
import math
from pydantic import Field, model_validator
from .studio_models import StrictModel, Identifier, Vector

Index = Annotated[int, Field(ge=0, le=300000)]


class TerrainPatch(StrictModel):
    id: Identifier
    kind: Literal['ruled-strip', 'triangle-strip', 'triangle-fan']
    left: list[Index] | None = Field(default=None, min_length=2, max_length=128)
    right: list[Index] | None = Field(default=None, min_length=2, max_length=128)
    indices: list[Index] | None = Field(default=None, min_length=3, max_length=256)
    hub: Index | None = None
    ring: list[Index] | None = Field(default=None, min_length=3, max_length=128)

    @model_validator(mode='after')
    def topology(self):
        if self.kind == 'ruled-strip':
            if self.left is None or self.right is None or len(self.left) != len(self.right) or self.indices is not None or self.hub is not None or self.ring is not None:
                raise ValueError('Ruled strip requires equally sized left/right boundary polylines only')
        elif self.kind == 'triangle-strip':
            if self.indices is None or self.left is not None or self.right is not None or self.hub is not None or self.ring is not None:
                raise ValueError('Triangle strip requires ordered indices only')
        elif self.hub is None or self.ring is None or self.left is not None or self.right is not None or self.indices is not None:
            raise ValueError('Triangle fan requires a hub and an implicitly closed ring only')
        return self

    def faces(self):
        if self.kind == 'ruled-strip':
            for a,b,c,d in zip(self.left, self.right, self.left[1:], self.right[1:]):
                yield a,c,b
                yield c,d,b
        elif self.kind == 'triangle-strip':
            for i in range(len(self.indices)-2):
                a,b,c = self.indices[i:i+3]
                yield (a,c,b) if i % 2 else (a,b,c)
        else:
            for i,a in enumerate(self.ring):
                yield self.hub,a,self.ring[(i+1)%len(self.ring)]


class Terrain(StrictModel):
    name: str = Field(min_length=1, max_length=100)
    version: Literal['1.0'] = '1.0'
    longitude: float = Field(ge=-180, le=180)
    latitude: float = Field(ge=-85, le=85)
    vertical_datum: Literal['ODN', 'ellipsoidal', 'local', 'unknown']
    reference_height: float = Field(ge=-500, le=9000)
    source: dict[str, str] = Field(max_length=30)
    demonstration: bool
    points: list[Vector] = Field(min_length=3, max_length=300000)
    patches: list[TerrainPatch] = Field(min_length=1, max_length=150000)

    @model_validator(mode='after')
    def topology(self):
        if len({p.id for p in self.patches}) != len(self.patches):
            raise ValueError('Duplicate terrain patch id')
        edges = {}
        face_count = 0
        bin_work = 0
        for patch in self.patches:
            if patch.kind == 'ruled-strip':
                for ia,ib,ic,id in zip(patch.left,patch.right,patch.left[1:],patch.right[1:]):
                    if max(ia,ib,ic,id) >= len(self.points):
                        raise ValueError('Missing ruled-surface control point')
                    a,b,c,d=[self.points[i] for i in (ia,ib,ic,id)]
                    for p,q,r in ((a,c,d),(a,d,b)):
                        if (q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]) <= 1e-8:
                            raise ValueError('Ruled patch must have a convex, nonfolded horizontal projection')
            for face in patch.faces():
                face_count += 1
                if face_count > 600000 or len(set(face)) != 3 or max(face) >= len(self.points):
                    raise ValueError('Invalid terrain index or terrain is too large')
                a,b,c = [self.points[i] for i in face]
                bin_work += (math.floor(max(a[0],b[0],c[0])/64)-math.floor(min(a[0],b[0],c[0])/64)+1)*(math.floor(max(a[1],b[1],c[1])/64)-math.floor(min(a[1],b[1],c[1])/64)+1)
                if bin_work > 4000000:
                    raise ValueError('Terrain exceeds spatial-index budget; subdivide long surface patches')
                if (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]) <= 1e-8:
                    raise ValueError('Terrain must be a nonfolded height field with upward winding')
                for i,j in zip(face, (face[1],face[2],face[0])):
                    key = (min(i,j), max(i,j))
                    prior = edges.get(key)
                    if prior is not None and (prior is False or prior == (i,j)):
                        raise ValueError('Overlapping or nonmanifold terrain edges')
                    edges[key] = (i,j) if prior is None else False
        return self


class FunctionPrimitive(StrictModel):
    id: Identifier
    category: str = Field(min_length=1, max_length=30)
    function: Literal['sphere', 'cylinder', 'annular-prism', 'arch-prism', 'box']
    parameters: dict[str, float] = Field(max_length=8)
    position: Vector
    color: str = Field(pattern=r'^#[0-9a-fA-F]{6}$')

    @model_validator(mode='after')
    def parameters_valid(self):
        required = {'sphere': {'radius'}, 'cylinder': {'radius','height'},
                    'annular-prism': {'inner_radius','outer_radius','angle','height'},
                    'arch-prism': {'inner_radius','outer_radius','depth'},
                    'box': {'width','depth','height'}}[self.function]
        if set(self.parameters) != required:
            raise ValueError('Unexpected or missing function parameters')
        for key,value in self.parameters.items():
            minimum = 0 if key == 'inner_radius' else 0.001
            if not minimum <= value <= (360 if key == 'angle' else 1000):
                raise ValueError('Function parameter out of range')
        if 'outer_radius' in required and self.parameters['outer_radius'] <= self.parameters['inner_radius']:
            raise ValueError('Outer radius must exceed inner radius')
        return self


class FeatureAsset(StrictModel):
    name: str = Field(min_length=1, max_length=80)
    kind: Literal['lamp', 'arched-door', 'curved-balcony', 'round-plaza']
    components: list[FunctionPrimitive] = Field(min_length=1, max_length=100)

    @model_validator(mode='after')
    def identifiers(self):
        if len({p.id for p in self.components}) != len(self.components):
            raise ValueError('Duplicate function component id')
        return self


class FeaturePlacement(StrictModel):
    id: Identifier
    asset: Identifier
    name: str = Field(min_length=1, max_length=80)
    longitude: float = Field(ge=-180, le=180)
    latitude: float = Field(ge=-85, le=85)
    altitude: float = Field(default=0, ge=-500, le=9000)
    heading: float = Field(default=0, ge=-180, le=180)
    scale: float = Field(default=1, ge=0.1, le=20)
    layer: Literal['surface', 'underground'] = 'surface'


class Environment(StrictModel):
    version: Literal['1.0'] = '1.0'
    terrain: Terrain | None = None
    feature_assets: dict[Identifier, FeatureAsset] = Field(default_factory=dict, max_length=1000)
    features: list[FeaturePlacement] = Field(default_factory=list, max_length=5000)
    drape_buildings: bool = True

    @model_validator(mode='after')
    def references(self):
        if len({f.id for f in self.features}) != len(self.features) or any(f.asset not in self.feature_assets for f in self.features):
            raise ValueError('Invalid feature reference or duplicate id')
        if sum(len(self.feature_assets[f.asset].components) for f in self.features) > 20000:
            raise ValueError('Environment exceeds 20,000 instanced function components')
        return self
