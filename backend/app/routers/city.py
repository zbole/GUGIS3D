import hashlib
import json
import os
import threading
import uuid
from pathlib import Path
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, Response
from fastapi import Query
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool
from ..services.building_generator import document_bytes
from ..studio_models import BuildingDocument
from ..city_models import CityWrite, GeoJSONImport
from ..services.city_generator import seed_city, footprint_document
from ..services.city_archive import CITY_ADAPTER, load_city, expand_city, archive_bytes, pack_city
from ..services import city_workspaces

router=APIRouter(prefix="/city",tags=["Persistent city projects"])
CITY_DIR=Path(__file__).resolve().parents[3]/".local"/"city"
SEED=Path(__file__).resolve().parents[2]/"data"/"bristol.gugis.json"
lock=threading.RLock()
_validated_snapshot = None
_archive_snapshot = None


def current_directory():
    return city_workspaces.directory(CITY_DIR)


def current_seed():
    return city_workspaces.seed_path(SEED)


def benchmark_directory():
    # Preserve Bristol's existing immutable experiment packages.
    return CITY_DIR.parent / 'benchmark' if city_workspaces.ACTIVE_CITY.get() == 'bristol' else current_directory() / 'benchmark'


def project_bounds():
    return city_workspaces.crop_bounds()


def project_center():
    west, south, east, north = project_bounds()
    return ((west + east) / 2, (south + north) / 2)


def revision(content):return hashlib.sha256(content).hexdigest()


def atomic_write(path, content):
    temp=path.with_suffix(path.suffix+".tmp")
    with temp.open("wb") as f:
        f.write(content);f.flush();os.fsync(f.fileno())
    os.replace(temp,path)


def read_current():
    global _validated_snapshot
    current_directory().mkdir(parents=True,exist_ok=True)
    path=current_directory()/"current.gugis.json"
    if not path.exists():
        source=current_seed()
        if source.exists():
            initial=load_city(source.read_bytes())
        else:
            initial=seed_city() if city_workspaces.ACTIVE_CITY.get() == 'bristol' else city_workspaces.empty_document()
        content=archive_bytes(initial)
        atomic_write(path,content)
    content=path.read_bytes()
    digest=revision(content)
    if _validated_snapshot is not None and _validated_snapshot[0]==digest:
        doc=_validated_snapshot[1]
    else:
        try: doc=load_city(content)
        except ValidationError as e:raise HTTPException(500,f"Saved city is invalid. Recover a version from {current_directory() / 'versions'}; current file was not overwritten.") from e
        _validated_snapshot=(digest,doc)
    return content,doc


async def parse(request,model):
    data=bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data)>128*1024*1024:raise HTTPException(413,"City file exceeds 128 MiB")
    try:
        validator = model.model_validate_json if hasattr(model, "model_validate_json") else model.validate_json
        return await run_in_threadpool(validator, bytes(data))
    except ValidationError as error:
        raise HTTPException(422,[{"loc":e["loc"],"msg":e["msg"]} for e in error.errors()[:8]]) from error


@router.get("/current")
def current():
    global _archive_snapshot
    with lock:
        content,doc=read_current()
        digest=revision(content)
        if _archive_snapshot is None or _archive_snapshot[0]!=digest:
            packed,stats=pack_city(doc)
            _archive_snapshot=(digest,packed,stats)
        _,packed,stats=_archive_snapshot
        # Return already encoded JSON; recursively re-encoding 100k+ semantic
        # nodes through FastAPI's generic encoder needlessly stalls city loads.
        return Response(b'{"revision":"'+digest.encode()+b'","document":'+packed+b',"storage":'+json.dumps(stats).encode()+b'}',media_type="application/json")


@router.get("/revision")
def current_revision():
    """Lightweight freshness check for published benchmark snapshots."""
    with lock:
        path=current_directory()/"current.gugis.json"
        if not path.exists():
            read_current()
        return {"revision": revision(path.read_bytes())}


@router.post("/current")
async def update(request:Request):
    edit=await parse(request,CityWrite)
    return await run_in_threadpool(apply_update, edit)


def apply_update(edit):
    document=expand_city(edit.document)
    content,stats=pack_city(document)
    return write_snapshot(document, content, stats, edit.base_revision)


def write_snapshot(document, content, stats, base_revision):
    """One writer lock and atomic current-file replacement; both versions are retained."""
    global _validated_snapshot, _archive_snapshot
    with lock:
        previous,_=read_current()
        if revision(previous)!=base_revision and revision(previous)!=revision(content):
            raise HTTPException(409,"City changed in another window. Reload the saved project before retrying; your draft has not been applied.")
        versions=current_directory()/"versions";versions.mkdir(exist_ok=True)
        for snapshot in (previous,content):
            path=versions/f"{revision(snapshot)}.gugis.json"
            if path.exists():
                # A filename is not proof that a recoverable copy exists. Do
                # not overwrite the formal city or silently repair user files.
                if path.read_bytes() != snapshot:
                    raise HTTPException(409, detail={
                        'code': 'snapshot_integrity',
                        'message': f'历史快照校验失败（{path.name}），正式城市未覆盖。请先导出当前项目备份，再检查 {versions} 中的损坏版本。',
                    })
            else:atomic_write(path,snapshot)
        atomic_write(current_directory()/"current.gugis.json",content)
        _validated_snapshot=(revision(content),document)
        _archive_snapshot=(revision(content),content,stats)
        return {"revision":revision(content),"bytes":len(content),"storage":stats,"directory":str(current_directory()),"filename":"current.gugis.json"}


@router.post("/validate")
async def validate(request:Request):
    doc=expand_city(await parse(request,CITY_ADAPTER))
    packed,stats=pack_city(doc)
    return Response(b'{"document":'+packed+b',"storage":'+json.dumps(stats).encode()+b'}',media_type="application/json")


@router.get("/export")
def export():
    with lock:
        content,_=read_current()
        digest=revision(content)
    # Serve the exact validated formal snapshot, not an unchecked history file.
    # Immutable response bytes also remain consistent if another request saves.
    return Response(content, media_type="application/json", headers={
        'Content-Disposition': f'attachment; filename="{city_workspaces.ACTIVE_CITY.get()}-city.gugis.json"',
        'X-GUGIS-City-Revision': digest,
    })


@router.get("/schema")
def schema():return CITY_ADAPTER.json_schema()


@router.get('/terrain/demo')
def terrain_demo():
    from ..services.terrain_builder import demo_terrain
    workspace = city_workspaces.workspace_entry(city_workspaces.ACTIVE_CITY.get())
    return {'terrain':demo_terrain(center=workspace['center_wgs84'],
                                  name=f"{workspace['name']}范围 · 方法演示地形（非实测）").model_dump(mode='json',exclude_none=True)}


@router.post('/terrain/upgrade')
async def terrain_upgrade(request: Request):
    """Offer an explicit, face-preserving conversion of legacy fan terrain."""
    from ..environment_models import Terrain
    from ..services.terrain_builder import upgrade_legacy_fans
    terrain = await parse(request, Terrain)
    upgraded = await run_in_threadpool(upgrade_legacy_fans, terrain)
    return {'terrain': upgraded.model_dump(mode='json', exclude_none=True)}


@router.get('/terrain/benchmark.zip')
async def terrain_benchmark_download(snapshot: str | None = Query(default=None, pattern=r'^[0-9a-f]{64}$')):
    """Build an ArcGIS-readable MultiPatch baseline from this project revision."""
    from ..services.terrain_multipatch import export_multipatch
    with lock:
        content, document = read_current()
        if snapshot and snapshot != revision(content):
            version = current_directory() / 'versions' / f'{snapshot}.gugis.json'
            if not version.exists():
                raise HTTPException(404, '对比快照不存在；当前项目不能替代历史测量数据')
            content = version.read_bytes()
            if revision(content) != snapshot:
                raise HTTPException(409, '历史快照校验失败')
            document = load_city(content)
        terrain = document.environment.terrain if document.environment else None
        digest = revision(content)
    if terrain is None:
        raise HTTPException(404, '当前城市没有地形')
    directory = benchmark_directory()
    directory.mkdir(parents=True, exist_ok=True)
    package = directory / f'terrain-{digest[:16]}.zip'
    if not package.exists():
        temporary = directory / f'terrain-{digest[:16]}.{uuid.uuid4().hex}.zip.tmp'
        try:
            await run_in_threadpool(export_multipatch, terrain, temporary, city_revision=digest)
            os.replace(temporary, package)
        finally:
            temporary.unlink(missing_ok=True)
    return FileResponse(package, media_type='application/zip', filename=f'{city_workspaces.ACTIVE_CITY.get()}-terrain-MultiPatch.zip')


@router.get('/terrain/benchmark-suite.zip')
def terrain_comparison_download(snapshot: str = Query(pattern=r'^[0-9a-f]{64}$'),
                                bundle: str | None = Query(default=None, pattern=r'^[0-9a-f]{64}$')):
    """The multi-resolution package is tied to the displayed evidence snapshot."""
    from zipfile import BadZipFile, ZipFile
    suffix = f'-{bundle}' if bundle else ''
    package = benchmark_directory() / f'terrain-suite-{snapshot[:16]}{suffix}.zip'
    if not package.exists():
        raise HTTPException(404, '该修订号尚未生成地形对比实验包')
    try:
        with ZipFile(package) as archive:
            if archive.getinfo('comparison-report.json').file_size > 4 * 1024 * 1024:
                raise ValueError('Oversized manifest')
            manifest = json.loads(archive.read('comparison-report.json'))
        if (manifest.get('schema') != 'gugis-terrain-comparison-suite-v1' or manifest.get('cityRevision') != snapshot
            or not isinstance(manifest.get('bundleId'), str) or len(manifest['bundleId']) != 64
            or any(c not in '0123456789abcdef' for c in manifest['bundleId'])
            or (bundle and manifest['bundleId'] != bundle)):
            raise ValueError('Snapshot or experiment mismatch')
    except (BadZipFile, KeyError, ValueError, TypeError, AttributeError, OSError) as error:
        raise HTTPException(409, '实验包与展示修订或实验标识不一致，请重新生成对比数据') from error
    return FileResponse(package, media_type='application/zip', filename=f'GUGIS-ArcGIS-terrain-{snapshot[:12]}.zip',
        headers={'X-GUGIS-City-Revision': snapshot, 'X-GUGIS-Experiment-ID': manifest['bundleId']})


@router.post('/terrain/import')
async def terrain_import(request: Request, filename: str = Query(max_length=200), source_crs: str = Query(default='',max_length=60),
                         datum: str = Query(default='unknown',pattern='^(ODN|ellipsoidal|local|unknown)$'),
                         stride: int = Query(default=10,ge=1,le=100)):
    from ..services.terrain_builder import import_dem
    from starlette.concurrency import run_in_threadpool
    content=bytearray()
    async for chunk in request.stream():
        content.extend(chunk)
        if len(content)>128*1024*1024: raise HTTPException(413,'DEM 超过 128 MiB，请先裁剪栅格')
    try:
        workspace = await run_in_threadpool(city_workspaces.workspace_entry, city_workspaces.ACTIVE_CITY.get())
        terrain=await run_in_threadpool(import_dem,bytes(content),filename,source_crs,datum,stride,
                                       clip_bounds=workspace['query_bbox_wgs84'],
                                       center=workspace['center_wgs84'], coverage_label=workspace['coverage_label'])
        return {'terrain':terrain.model_dump(mode='json',exclude_none=True)}
    except Exception as error:
        raise HTTPException(422,str(error)[:350]) from error


@router.post("/refine")
async def refine(request: Request):
    from ..services.urban_detail import refine_document
    document = await parse(request, BuildingDocument)
    try:
        result = refine_document(document)
    except ValueError as error:
        raise HTTPException(422, str(error)[:250]) from error
    return {"document": json.loads(document_bytes(result))}


@router.post("/geojson")
async def import_geojson(request:Request):
    collection=await parse(request,GeoJSONImport)
    return await run_in_threadpool(convert_geojson,collection)


def convert_geojson(collection):
    """Convert the complete batch and encode its response outside the event loop."""
    documents=[];issues=[]
    for index,feature in enumerate(collection.features):
        try:
            if feature.get("type") != "Feature":
                raise ValueError("每个要素必须声明 type 为 Feature")
            geometry=feature.get("geometry");properties=feature.get("properties")
            if properties is None:properties={}
            if not isinstance(geometry,dict) or not isinstance(properties,dict):
                raise ValueError("geometry 和 properties 必须是对象；properties 可为 null")
            if geometry.get("type") != "Polygon":
                raise ValueError("仅支持单 Polygon；请先拆分 MultiPolygon")
            rings=geometry.get("coordinates",[])
            if not isinstance(rings,list) or any(not isinstance(ring,list) for ring in rings):
                raise ValueError("Polygon coordinates 必须是坐标环数组")
            if len(rings)!=1:raise ValueError("内环 / 庭院需拆分为无孔多边形后导入")
            ring=rings[0]
            if len(ring)<4 or ring[0]!=ring[-1]:raise ValueError("多边形必须首尾闭合")
            name=str(properties.get("name",f"{collection.name} {index+1}"))[:80]
            height=float(properties.get("height",9.6))
            if not 1<=height<=150:raise ValueError("height 应为 1–150 米")
            reason="GeoJSON height 字段（未核验）" if "height" in properties else "缺少高度：假设 9.6 m"
            doc=footprint_document(ring,name,height,"用户导入 GeoJSON / WGS84",reason)
            documents.append(json.loads(document_bytes(doc)))
        except (ValueError,TypeError,KeyError,IndexError,OverflowError) as error:
            issues.append(f"要素 {index+1}：{str(error)[:180]}")
    if issues:
        # Fail the complete batch so an incomplete neighbourhood is never silently saved.
        raise HTTPException(422,"导入未应用。"+"；".join(issues[:8]))
    return Response(json.dumps({"documents":documents},ensure_ascii=False,allow_nan=False,
                               separators=(",",":")).encode("utf-8"),media_type="application/json")
