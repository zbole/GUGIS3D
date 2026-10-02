"""Drafts and version recovery never replace the saved city until explicit commit."""
import json
import re
from datetime import datetime, timezone
from typing import Literal
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import Field, ValidationError
from starlette.concurrency import run_in_threadpool
from ..city_models import CityWrite
from ..studio_models import StrictModel
from ..services.city_archive import load_city, expand_city, pack_city
from . import city
from ..studio_models import BuildingParameters
from ..services.building_generator import generate_building, document_bytes
import math
import uuid

router = APIRouter(prefix='/city', tags=['Drafts and recovery'])

class BlockParameters(StrictModel):
    count: int = Field(default=24, ge=1, le=48)
    longitude: float = Field(ge=-180,le=180)
    latitude: float = Field(ge=-85,le=85)
    altitude: float = Field(default=0,ge=-500,le=9000)

@router.post('/block')
def generate_block(p: BlockParameters):
    prefix='block_'+uuid.uuid4().hex[:12]
    kinds=['georgian','victorian','tudor','warehouse']
    labels=['乔治式街屋','维多利亚街屋','都铎式街屋','港区仓库']
    assets={}
    for n in range(min(8,p.count)):
        params=BuildingParameters(kind=kinds[n%4],name=labels[n%4]+' · 设计',floors=2+n//4,units=1,longitude=p.longitude,latitude=p.latitude)
        assets[f'{prefix}_a{n}']=json.loads(document_bytes(generate_building(params)))
    cols=math.ceil(math.sqrt(p.count))
    rows=math.ceil(p.count/cols)
    instances=[]
    for n in range(p.count):
        lon=p.longitude+(n%cols-(cols-1)/2)*42/(111320*math.cos(math.radians(p.latitude)))
        lat=p.latitude+(n//cols-(rows-1)/2)*44/111320
        if not -180<=lon<=180 or not -85<=lat<=85: raise HTTPException(422,'街区范围超出支持的经纬度')
        instances.append(dict(id=f'{prefix}_{n}',asset=f'{prefix}_a{n%8}',name=f'设计街区 · {labels[n%4]} {n+1}',longitude=lon,latitude=lat,altitude=p.altitude,heading=180 if n//cols%2 else 0))
    return {'assets':assets,'instances':instances}

class DraftEditor(StrictModel):
    mode: Literal['add', 'update']
    parameters: BuildingParameters
    instance_id: str = Field(min_length=1, max_length=120)


class DraftEnvelope(CityWrite):
    label: str = Field(min_length=1, max_length=100)
    created_at: datetime
    editor: DraftEditor | None = None


class DraftWrite(CityWrite):
    base_draft_revision: str | None = Field(default=None, pattern=r'^[a-f0-9]{64}$')
    label: str = Field(min_length=1, max_length=100)
    editor: DraftEditor | None = None

class DraftToken(StrictModel):
    revision: str = Field(pattern=r'^[a-f0-9]{64}$')

def draft_path():
    return city.CITY_DIR / 'pending-draft.json'

def draft_revision():
    return city.revision(draft_path().read_bytes()) if draft_path().exists() else None


def read_envelope(content):
    try:
        return DraftEnvelope.model_validate_json(content)
    except (ValueError, ValidationError) as error:
        raise HTTPException(422, '独立草稿校验失败，原文件仍保留在 .local/city/pending-draft.json；正式城市可继续读取') from error


def read_receipt():
    try:
        return json.loads((city.CITY_DIR/'draft-commit.json').read_bytes())
    except (OSError, ValueError):
        return {}

@router.get('/draft')
def get_draft():
    with city.lock:
        if not draft_path().exists(): return {'draft': None}
        content = draft_path().read_bytes()
        receipt = read_receipt()
        if receipt.get('draft_revision') == city.revision(content):
            current, _ = city.read_current()
            if receipt.get('revision') == city.revision(current):
                return {'draft': None}
        read_envelope(content)
        return Response(b'{"draft":{"revision":"'+city.revision(content).encode()+b'",'+content[1:]+b'}', media_type='application/json')

@router.post('/draft')
async def save_draft(request: Request):
    edit = await city.parse(request, DraftWrite)
    return await run_in_threadpool(write_draft, edit)


def write_draft(edit):
    document = expand_city(edit.document)
    if edit.editor and not any(i.id == edit.editor.instance_id for i in document.instances):
        raise HTTPException(422, '草稿编辑对象不存在')
    packed, _ = pack_city(document)
    metadata = dict(base_revision=edit.base_revision, label=edit.label, created_at=datetime.now(timezone.utc).isoformat())
    if edit.editor:
        metadata['editor'] = edit.editor.model_dump(mode='json')
    content = json.dumps(metadata, ensure_ascii=False).encode()[:-1]+b',"document":'+packed+b'}'
    with city.lock:
        current, _ = city.read_current()
        token = draft_revision()
        receipt = read_receipt()
        # A committed draft may remain after an interrupted cleanup. A new draft
        # can replace only that consumed file, never an unrelated pending draft.
        if token and receipt.get('draft_revision') == token and receipt.get('revision') == city.revision(current):
            token = None
        if city.revision(current) != edit.base_revision or token != edit.base_draft_revision:
            raise HTTPException(409, '城市或草稿已在其他窗口变更，请重新载入后再生成')
        city.atomic_write(draft_path(), content)
    return {'revision':city.revision(content), **metadata}


@router.post('/draft/commit')
def commit_draft(token: DraftToken):
    with city.lock:
        previous, document = city.read_current()
        receipt = read_receipt()
        if receipt.get('draft_revision') == token.revision and receipt.get('revision') == city.revision(previous):
            # A lost HTTP response can be retried after cleanup or server restart.
            _, stats = pack_city(document)
            return {**receipt, 'storage': stats, 'directory': str(city.CITY_DIR), 'filename': 'current.gugis.json'}
        if draft_revision() != token.revision:
            raise HTTPException(409, '草稿已改变或不存在，请重新载入')
        pending = read_envelope(draft_path().read_bytes())
        if pending.base_revision != city.revision(previous):
            raise HTTPException(409, '正式城市已改变，草稿未写入')
        document = expand_city(pending.document)
        packed, stats = pack_city(document)
        receipt = dict(draft_revision=token.revision, revision=city.revision(packed), bytes=len(packed))
        # Write the intent first. It is a completed receipt only when the current
        # file hash matches; a crash before replacement leaves the draft retryable.
        # A no-op target already matches, so publish its receipt only after all
        # snapshot checks/writes succeed. Retrying an interrupted no-op is safe.
        noop = receipt['revision'] == city.revision(previous)
        if not noop:
            city.atomic_write(city.CITY_DIR/'draft-commit.json', json.dumps(receipt).encode())
        result = city.write_snapshot(document, packed, stats, pending.base_revision)
        if noop:
            city.atomic_write(city.CITY_DIR/'draft-commit.json', json.dumps(receipt).encode())
        try:
            draft_path().unlink()
        except OSError:
            # GET hides this consumed draft; its receipt permits safe retries.
            pass
        return result

@router.post('/draft/discard')
def discard_draft(token: DraftToken):
    with city.lock:
        current = draft_revision()
        if current is None: return {'discarded': True}
        if current != token.revision: raise HTTPException(409, '草稿已在其他窗口修改，未丢弃')
        draft_path().unlink()
    return {'discarded': True}

@router.get('/versions')
def versions(offset: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=50)):
    with city.lock:
        content, _ = city.read_current()
        digest = city.revision(content)
        directory = city.CITY_DIR/'versions'
        files = sorted((p for p in directory.glob('*.gugis.json') if re.fullmatch(r'[a-f0-9]{64}\.gugis\.json', p.name)), key=lambda p: p.stat().st_mtime_ns, reverse=True)
        entries = [dict(revision=p.name.split('.')[0], modified_at=datetime.fromtimestamp(p.stat().st_mtime, timezone.utc).isoformat(), bytes=p.stat().st_size, current=p.name.startswith(digest)) for p in files[offset:offset+limit]]
        return {'versions':entries, 'has_more':offset+limit<len(files)}

@router.get('/versions/{revision}')
def version(revision: str):
    if revision != 'baseline' and not re.fullmatch('[a-f0-9]{64}', revision):
        raise HTTPException(404, '找不到这个历史版本')
    with city.lock:
        path = city.SEED if revision == 'baseline' else city.CITY_DIR/'versions'/f'{revision}.gugis.json'
        if not path.is_file(): raise HTTPException(404, '历史版本不存在')
        content = path.read_bytes()
        if revision != 'baseline' and city.revision(content) != revision:
            raise HTTPException(422, '历史文件校验失败，未恢复')
    packed, stats = pack_city(load_city(content))
    return Response(b'{"document":'+packed+b',"storage":'+json.dumps(stats).encode()+b'}',media_type='application/json')
