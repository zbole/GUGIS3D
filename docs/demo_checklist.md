# Demo Checklist

Use this before a supervisor demo.

## Backend Health Check

- Start backend:
  `cd ~/gugis-webgis/backend && conda activate webgis-backend && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`
- Open or curl:
  `http://localhost:8000/health`
- Expected: `{"status":"ok","service":"gugis-webgis"}`

## Frontend Open Check

- Start frontend:
  `cd ~/gugis-webgis/frontend && conda activate webgis-node && npm run dev -- --host 0.0.0.0`
- Open:
  `http://localhost:5173/`
- Expected: Cesium viewer appears with Bristol sample objects.

## Object Visible Check

- Buildings, roads, green area, and template objects are visible near Bristol.
- Status bar shows object count and camera position.

## Layer Toggle Check

- Toggle Buildings visibility off and on.
- Move Buildings opacity slider and confirm Cesium objects update immediately.
- Confirm layer groups appear: Base, 3D Objects, Analysis, AI Placeholder.

## Object Picking Check

- Click a building.
- Expected: selected object becomes highlighted, property panel updates, and attribute table row highlights.
- Click empty space.
- Expected: selection clears.

## Property Panel Check

- Confirm selected object shows IDs, shape label, structure type, types, coordinate mode, height/floors/usage, HybridBox, geometry type, attributes JSON preview, and GUGIS Mapping note.

## Attribute Table Check

- Search by object name or usage.
- Filter by layer.
- Filter by structure type.
- Click a row.
- Expected: object is selected and camera flies to it.

## Measurement Check

- Enable distance measurement.
- Click two map positions.
- Expected: yellow polyline and distance label appear.
- Click clear measurement.
- Enable height measurement with a selected building.
- Expected: status bar reports object height when available.

## Build Check

- Run:
  `cd ~/gugis-webgis/frontend && conda activate webgis-node && npm run build`
- Expected: TypeScript and Vite build complete without errors.
