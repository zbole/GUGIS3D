from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import analysis, export, layers, objects

app = FastAPI(
    title="gugis-webgis API",
    description="FastAPI backend for a GUGIS-style 3D WebGIS MVP.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_origin_regex=r"http://.*:5173",
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
