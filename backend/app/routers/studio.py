from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse
from pathlib import Path
import hashlib
import re
from pydantic import ValidationError

from ..studio_models import BuildingDocument, BuildingParameters
from ..services.building_generator import document_bytes, generate_building, statistics

router = APIRouter(prefix="/studio", tags=["3D object studio"])
EXPORT_DIR = Path(__file__).resolve().parents[3] / ".local" / "exports"


@router.post("/generate")
def generate(parameters: BuildingParameters):
    try:
        return Response(document_bytes(generate_building(parameters)), media_type="application/json")
    except ValueError as error:
        raise HTTPException(422, str(error)[:400]) from error


async def read_document(request: Request) -> BuildingDocument:
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > 8 * 1024 * 1024:
            raise HTTPException(413, "Object file exceeds 8 MiB")
    try:
        document = BuildingDocument.model_validate_json(bytes(data))
    except ValidationError as error:
        # Do not echo the whole uploaded document or raw context in a validation error.
        details = [{"loc": item["loc"], "msg": item["msg"]} for item in error.errors()[:8]]
        raise HTTPException(422, detail=details) from error
    return document


@router.post("/validate")
async def validate(request: Request):
    document = await read_document(request)
    return {"document": document.model_dump(mode="json", exclude_none=True), "statistics": statistics(document)}


@router.post("/save")
async def save(request: Request):
    document = await read_document(request)
    content = document_bytes(document)
    file_id = hashlib.sha256(content).hexdigest()
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    destination = EXPORT_DIR / f"{file_id}.gugis.json"
    # Content-addressed files: saving again is idempotent and never overwrites another version.
    if not destination.exists():
        with destination.open("xb") as output:
            output.write(content)
    return {"id": file_id, "filename": destination.name, "directory": str(EXPORT_DIR),
            "bytes": len(content), "download_path": f"/studio/files/{file_id}"}


@router.get("/files/{file_id}")
def download(file_id: str):
    if not re.fullmatch(r"[a-f0-9]{64}", file_id):
        raise HTTPException(404, "Object file not found")
    path = EXPORT_DIR / f"{file_id}.gugis.json"
    if not path.is_file():
        raise HTTPException(404, "Object file not found")
    return FileResponse(path, media_type="application/json", filename=path.name)


@router.get("/example")
def example():
    return Response(document_bytes(generate_building(BuildingParameters())), media_type="application/json")


@router.get("/schema")
def schema():
    return BuildingDocument.model_json_schema()
