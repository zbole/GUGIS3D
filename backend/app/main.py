from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import analysis, export, layers, objects, studio, city, workspace, render_tiles, coverage
from .services import city_workspaces

app = FastAPI(
    title="gugis-webgis API",
    description="FastAPI backend for a GUGIS-style 3D WebGIS MVP.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "gugis-webgis"}


app.include_router(layers.router)
app.include_router(objects.router)
app.include_router(analysis.router)
app.include_router(export.router)
app.include_router(studio.router)
app.include_router(city.router)
app.include_router(workspace.router)

# Every prefixed request retains its own context in async and worker-thread code.
# Legacy /city endpoints continue to target Bristol for existing clients.
app.include_router(city_workspaces.router)
app.include_router(city.router, prefix='/cities/{city_id}', dependencies=[Depends(city_workspaces.select_workspace)])
app.include_router(workspace.router, prefix='/cities/{city_id}', dependencies=[Depends(city_workspaces.select_workspace)])

# Prebuilt read-only derivatives never initialize or rewrite formal projects.
app.include_router(render_tiles.router)

# National membership and optional receipts are read-only readiness metadata.
app.include_router(coverage.router)

from app.routers import source_candidates
app.include_router(source_candidates.router)

from app.routers import public_city_datasets
app.include_router(public_city_datasets.router)
