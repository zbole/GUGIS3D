# Architecture

`gugis-webgis` is split into a browser-first visualization client and a small API backend.

## Frontend

The frontend is a React + TypeScript + Vite app. `CesiumViewer.tsx` owns the Cesium `Viewer` lifecycle and renders GUGIS objects as Cesium entities:

- `FunctionStructure` boxes become oriented `box` entities.
- `FunctionStructure` extruded polygons and `DiscreteStructure` surfaces become polygon entities.
- `TemplateStructure` instances become lightweight cylinder and ellipsoid entities.

React owns application state for selected object, layer visibility, layer opacity, measurement mode, clipping mode, and table filters.

## Backend

The backend is FastAPI with a JSON repository by default. The repository validates records through Pydantic schemas before exposing API responses. The database module is intentionally thin so a PostGIS repository can replace the JSON fallback later.

## Data Flow

1. Frontend requests `/objects` and `/layers`.
2. Backend loads and validates `backend/data/sample_gugis_objects.json`.
3. Cesium renders visible objects according to layer state.
4. Picking and table clicks update React selection state.
5. Analysis endpoints support HybridBox filtering and distance measurement.

## Extension Points

- Add PostGIS repository implementation behind the current repository interface.
- Replace entity rendering with glTF or 3D Tiles caches for large datasets.
- Add BooleanStructure operations in backend services.
- Add AI extraction outputs as a new layer using the same `GugisObject` contract.
