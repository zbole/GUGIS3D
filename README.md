# gugis-webgis

A web-based 3D GIS MVP for testing a GUGIS-style object model.

The project uses **React + TypeScript + CesiumJS** for the interactive 3D frontend and **FastAPI** for the backend API. The current version uses synthetic Bristol-area sample objects and JSON fallback data, with PostGIS schema files prepared for later database deployment.

## Current Features

* Interactive CesiumJS 3D viewer.
* Synthetic Bristol-area 3D objects.
* GUGIS-compatible object schema:

  * `FunctionStructure`
  * `TemplateStructure`
  * `DiscreteStructure`
  * `HybridBox`
  * object attributes, pose, visibility, and opacity.
* Layer management.
* Layer groups for Base, 3D Objects, Analysis, and AI Placeholder.
* Object picking, clear selection, and stronger selected-object highlighting.
* Property panel and searchable/filterable attribute table.
* Reset to Bristol and fly-to-object tools.
* Distance and height measurement.
* Camera longitude, latitude, and height in the status bar.
* Visibility and transparency controls.
* Clean clipping/slicing placeholder for future 3D Tiles / mesh objects.
* FastAPI endpoints for:

  * health check
  * layers
  * objects
  * object query
  * HybridBox query
  * distance measurement
  * GUGIS JSON export.
* PostGIS schema and seed SQL for future deployment.

## Project Layout

```text
gugis-webgis/
├── frontend/       # React + TypeScript + Vite + CesiumJS
├── backend/        # FastAPI backend
├── database/       # PostGIS schema and sample seed SQL
├── data-pipeline/  # sample data and converter scripts
├── docs/           # architecture, API, object model, roadmap
└── README.md
```

## Quick Start

Run the backend and frontend in two separate terminals.

### Backend

Use the `webgis-backend` conda environment.

```bash
cd ~/gugis-webgis/backend
conda activate webgis-backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Check the backend:

```bash
curl http://localhost:8000/health
```

Expected result:

```json
{"status":"ok","service":"gugis-webgis"}
```

API docs:

```text
http://localhost:8000/docs
```

### Frontend

Use the `webgis-node` conda environment.

```bash
cd ~/gugis-webgis/frontend
conda activate webgis-node
npm run dev -- --host 0.0.0.0
```

Open:

```text
http://localhost:5173/
```

The frontend reads the backend URL from:

```text
VITE_API_BASE_URL=http://localhost:8000
```

See `frontend/.env.example`.

On a remote server, use VS Code Port Forwarding for:

```text
5173 -> frontend
8000 -> backend
```

Then open the forwarded local address:

```text
http://localhost:5173/
```

## Build Check

Run this after frontend changes:

```bash
cd ~/gugis-webgis/frontend
conda activate webgis-node
npm run build
```

## Backend vs Frontend

The frontend is the actual WebGIS page.

```text
Frontend: http://localhost:5173
Backend API: http://localhost:8000
Backend docs: http://localhost:8000/docs
```

The backend is required when using API-based object loading, object query, export, and future PostGIS functions.

## GUGIS Object Model

Each object is represented as a GIS entity rather than only a rendered mesh.

Main fields include:

* `object_id`
* `layer_id`
* `shape_type`
* `structure_type`
* `main_type`
* `sub_type`
* `coordinate_mode`
* `base_point`
* `pose`
* `hybrid_box`
* `geometry`
* `attributes`
* `visible`
* `opacity`

Supported structure types in the MVP:

```text
FunctionStructure
TemplateStructure
DiscreteStructure
CompositeStructure
BooleanStructure
```

See:

```text
docs/gugis_object_model.md
```

## Development Roadmap

### V0.1 Current MVP

* Synthetic Bristol sample city.
* CesiumJS interactive viewer.
* FastAPI JSON backend.
* Basic ArcGIS-like interaction tools.
* GUGIS-style object schema.

### V0.2 Frontend Validation

* Fix UI/runtime bugs.
* Improve object picking.
* Improve measurement tools.
* Improve clipping/slicing.

### V0.3 Real Data Import

* Import Bristol OSM / Overture buildings.
* Convert footprints and attributes into GUGIS JSON.
* Generate LoD1 building objects.

### V0.4 Stronger GUGIS Adapter

* Better separation of:

  * FunctionStructure
  * TemplateStructure
  * DiscreteStructure
* Add stronger HybridBox query logic.
* Add object-level spatial filtering.

### V0.5 3D Tiles / glTF Export

* Export render cache.
* Support larger 3D scenes.
* Prepare for web-scale streaming.

### V0.6 AI Integration

* Add point cloud / remote sensing result layers.
* Connect building extraction or semantic segmentation outputs.
* Convert AI results into GUGIS objects.

## Notes

This project currently does **not** depend on 51Earth or any closed cloud-rendering platform.

The goal is to first build a minimal open-source 3D WebGIS prototype, then gradually extend it toward a full GUGIS-compatible data engine.
