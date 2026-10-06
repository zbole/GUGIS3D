"""Add a validated staged city without replacing any existing seed or local project."""
import argparse,hashlib,json,os,re,sys,uuid
from pathlib import Path
from unittest.mock import patch
from acquire_additional_city_samples import ROOT,read_plan
from acquire_city_samples import atomic_new
sys.path.insert(0,str(ROOT/'backend'))
from app.services.city_sample_import import load_sample,CITY_NAMES
from app.services.city_archive import archive_bytes,load_city

def sha(b):return hashlib.sha256(b).hexdigest()
def packed(v):return (json.dumps(v,ensure_ascii=False,indent=2)+'\n').encode('utf8')
def replace(path,blob):
    temporary=path.with_name('.'+path.name+'.'+uuid.uuid4().hex+'.tmp')
    with temporary.open('xb') as handle:handle.write(blob);handle.flush();os.fsync(handle.fileno())
    os.replace(temporary,path)

def publish(city_id,staging):
    plan=read_plan();record=next((c for c in plan['cities'] if c['id']==city_id),None)
    if not record:raise ValueError('City absent from reviewed plan')
    registry=json.loads((ROOT/'backend/data/uk-city-registry.json').read_bytes())
    registry_city=next((c for c in registry['cities'] if c['id']==record['related_registry_id']),None)
    if not registry_city or registry_city['source_name']!=record['city_name']:raise ValueError('Official city association differs from plan')
    names=[f'{city_id}-osm.json',f'{city_id}-source.json',f'{city_id}.gugis.json',f'{city_id}-import.json']
    dest=ROOT/'backend/data/cities';receipt=ROOT/f'shared/{city_id}-city-publication-v1.json'
    if receipt.exists() or any((dest/name).exists() for name in names):raise FileExistsError('Existing publication is immutable; use an explicit new version')
    catalog_path=ROOT/'shared/city-workspaces.json';catalog_raw=catalog_path.read_bytes();catalog=json.loads(catalog_raw)
    if any(c['id']==city_id for c in catalog):raise ValueError('Existing workspace cannot be replaced')
    profile_path=ROOT/'shared/render-package-profiles.json';profile_raw=profile_path.read_bytes();profiles=json.loads(profile_raw)
    public_path=ROOT/'shared/public-city-datasets.json';public_raw=public_path.read_bytes();public=json.loads(public_raw)
    if set(profiles['tile_size_m'])!={c['id'] for c in catalog} or {c['city_id'] for c in public['sources']}!={c['id'] for c in catalog}:raise ValueError('Baseline catalogues disagree')
    report=json.loads((staging/f'{city_id}-import.json').read_bytes());source=json.loads((staging/f'{city_id}-source.json').read_bytes())
    if source['bbox']!=record['query_bbox_wgs84'] or report['query_bbox_wgs84']!=record['query_bbox_wgs84']:raise ValueError('Reviewed crop changed')
    seed=(staging/f'{city_id}.gugis.json').read_bytes()
    if len(seed)!=report['gugis_bytes'] or sha(seed)!=report['gugis_sha256']:raise ValueError('Staged seed differs from receipt')
    with patch.dict(CITY_NAMES,{city_id:record['name']}):city,again=load_sample(staging/f'{city_id}-osm.json',staging/f'{city_id}-source.json',city_id)
    if archive_bytes(city)!=seed or load_city(seed).metadata['city_id']!=city_id:raise ValueError('Complete source reconstruction differs')
    for key in again:
        if again[key]!=report[key]:raise ValueError('Import omissions or provenance changed')
    metadata=city.metadata
    entry={'city_id':city_id,'name':record['name'],'bytes':len(seed),'sha256':sha(seed),'building_count':len(city.instances),'road_count':len(city.roads),'feature_count':0,'terrain_included':False,'terrain_note':'No terrain in this seed; DTM is a separate dataset.','coverage_label':metadata['coverage_label'],'query_bbox_wgs84':record['query_bbox_wgs84'],'actual_data_bbox_wgs84':report['actual_data_bbox_wgs84'],'height_counts':report['height_policy'],'height_policy':metadata['height_policy'],'source':metadata['source'],'license':metadata['license'],'source_retrieved_at':metadata['source_retrieved_at'],'quality_warnings':[],'scope':'Immutable public seed, not the local saved project or its history.'}
    old_seeds={s['city_id']:{'bytes':s['bytes'],'sha256':s['sha256']} for s in public['sources']}
    # Every existing native file must still match the original public receipt.
    for cid,e in old_seeds.items():
        path=ROOT/('backend/data/bristol.gugis.json' if cid=='bristol' else f'backend/data/cities/{cid}.gugis.json');b=path.read_bytes()
        if len(b)!=e['bytes'] or sha(b)!=e['sha256']:raise ValueError('Existing seed changed; refuse extension')
    for name in names:atomic_new(dest/name,(staging/name).read_bytes())
    catalog.append(record);profiles['tile_size_m'][city_id]=125;public['sources'].append(entry)
    replace(catalog_path,packed(catalog));replace(profile_path,packed(profiles));replace(public_path,packed(public))
    service=ROOT/'backend/app/services/public_city_datasets.py';text=service.read_text(encoding='utf8');text,n=re.subn(r"MANIFEST_SHA256 = '[a-f0-9]{64}'","MANIFEST_SHA256 = '"+sha(packed(public))+"'",text)
    if n!=1:raise ValueError('Manifest pin declaration changed')
    replace(service,text.encode('utf8'))
    publication={'schema':'gugis-additional-city-publication-v1','city_id':city_id,'plan_sha256':sha((ROOT/'data-pipeline/additional_city_samples.json').read_bytes().replace(b'\r\n',b'\n')),'previous_workspaces':json.loads(catalog_raw),'previous_profiles':json.loads(profile_raw),'previous_public_sources':json.loads(public_raw)['sources'],'previous_catalogue_sha256':sha(catalog_raw),'previous_profiles_sha256':sha(profile_raw),'previous_public_manifest_sha256':sha(public_raw),'previous_seeds':old_seeds,'new_source':entry,'import_report':report,'files':{name:{'bytes':(dest/name).stat().st_size,'sha256':sha((dest/name).read_bytes())} for name in names},'scope':'Only public seed/catalogue additions. No local formal city, draft, history or original research evidence modified.'}
    atomic_new(receipt,packed(publication));return entry

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--city',required=True);p.add_argument('--staging',type=Path,required=True);a=p.parse_args();print(json.dumps(publish(a.city,a.staging),ensure_ascii=False))
