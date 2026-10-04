from fastapi import APIRouter, HTTPException, Request, Response
from pathlib import Path
from tempfile import NamedTemporaryFile
import hashlib
import json
import os
import re
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

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
        document = await run_in_threadpool(BuildingDocument.model_validate_json, bytes(data))
    except ValidationError as error:
        # Do not echo the whole uploaded document or raw context in a validation error.
        details = [{"loc": item["loc"], "msg": item["msg"]} for item in error.errors()[:8]]
        raise HTTPException(422, detail=details) from error
    return document


@router.post("/validate")
async def validate(request: Request):
    document = await read_document(request)
    return await run_in_threadpool(validation_response, document)


def validation_response(document: BuildingDocument):
    counts = json.dumps(statistics(document), ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    return Response(b'{"document":' + document.model_dump_json(exclude_none=True).encode("utf-8") + b',"statistics":' + counts + b'}',
                    media_type="application/json")


@router.post("/save")
async def save(request: Request):
    document = await read_document(request)
    return await run_in_threadpool(save_document, document)


def save_document(document: BuildingDocument):
    content = document_bytes(document)
    file_id = hashlib.sha256(content).hexdigest()
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    destination = EXPORT_DIR / f"{file_id}.gugis.json"
    # A hash filename alone is not proof that an earlier save finished intact.
    if destination.exists():
        if destination.read_bytes() != content:
            raise HTTPException(409, "Stored object file integrity check failed; the existing file was not overwritten")
    else:
        temporary = None
        try:
            # Publish only a complete file. Close before replace for Windows support.
            with NamedTemporaryFile(mode="wb", dir=EXPORT_DIR, prefix=f".{file_id}.",
                                    suffix=".tmp", delete=False) as output:
                temporary = Path(output.name)
                output.write(content)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, destination)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
    return {"id": file_id, "filename": destination.name, "directory": str(EXPORT_DIR),
            "bytes": len(content), "download_path": f"/studio/files/{file_id}"}


@router.get("/files/{file_id}")
def download(file_id: str):
    if not re.fullmatch(r"[a-f0-9]{64}", file_id):
        raise HTTPException(404, "Object file not found")
    path = EXPORT_DIR / f"{file_id}.gugis.json"
    if not path.is_file():
        raise HTTPException(404, "Object file not found")
    content = path.read_bytes()
    if hashlib.sha256(content).hexdigest() != file_id:
        raise HTTPException(409, "Stored object file integrity check failed; the file was left unchanged")
    # Serve the bytes we verified, rather than reopening the path later.
    return Response(content, media_type="application/json", headers={
        "Content-Disposition": f'attachment; filename="{path.name}"',
    })


@router.get("/example")
def example():
    return Response(document_bytes(generate_building(BuildingParameters())), media_type="application/json")


@router.get("/schema")
def schema():
    return BuildingDocument.model_json_schema()
