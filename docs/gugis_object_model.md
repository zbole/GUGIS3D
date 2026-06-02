# GUGIS Object Model

The MVP uses object-level GIS records rather than file-level layers as the primary semantic unit.

## ShapeType

- `Null = 0`
- `Point = 10000`
- `Line = 20000`
- `Surface = 30000`
- `Body = 40000`
- `ComplexObject = 50000`
- `Mix = 60000`
- `Template = 70000`

## StructureType

- `FunctionStructure`: compact procedural or parametric geometry.
- `TemplateStructure`: prototype plus repeated instances.
- `DiscreteStructure`: mesh, polygon, vertices/faces, or other sampled geometry.
- `CompositeStructure`: grouped objects.
- `BooleanStructure`: future union, difference, and intersection objects.

## Required Object Fields

- `object_id`, `layer_id`, `name`
- `shape_type`, `structure_type`, `main_type`, `sub_type`
- `coordinate_mode`, `base_point`, `pose`
- `hybrid_box`
- `geometry`
- `attributes`
- `visible`, `opacity`

## HybridBox / BallBox

`hybrid_box` stores:

- `center`: `[longitude, latitude, height]`
- `radius_xyz`: local axis radii in meters
- `radius_2d`: horizontal search radius in meters
- `radius_3d`: full spatial search radius in meters

It is used for quick filtering, selection context, and future acceleration.
