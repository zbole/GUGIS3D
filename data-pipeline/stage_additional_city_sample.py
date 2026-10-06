"""Convert one retained public extract offline, without adding a live workspace."""
import argparse,hashlib,json,sys
from pathlib import Path
from unittest.mock import patch
from acquire_additional_city_samples import ROOT,read_plan
from acquire_city_samples import atomic_new
sys.path.insert(0,str(ROOT/'backend'))
from app.services.city_sample_import import load_sample,CITY_NAMES
from app.services.city_archive import archive_bytes

def stage(city_id,source_dir,output):
    records={c['id']:c for c in read_plan()['cities']}
    if city_id not in records:raise ValueError('City absent from reviewed plan')
    if any((output/name).exists() for name in [city_id+'.gugis.json',city_id+'-import.json']):raise FileExistsError('Retain previous conversion; choose another staging directory')
    source=json.loads((source_dir/f'{city_id}-source.json').read_bytes())
    if source['bbox']!=records[city_id]['query_bbox_wgs84']:raise ValueError('Retained crop differs from reviewed plan')
    # This is a bounded offline conversion name binding, not a server workspace switch.
    with patch.dict(CITY_NAMES,{city_id:records[city_id]['name']}):city,report=load_sample(source_dir/f'{city_id}-osm.json',source_dir/f'{city_id}-source.json',city_id)
    content=archive_bytes(city)
    report.update(gugis_bytes=len(content),gugis_sha256=hashlib.sha256(content).hexdigest())
    output.mkdir(parents=True,exist_ok=True);atomic_new(output/f'{city_id}.gugis.json',content);atomic_new(output/f'{city_id}-import.json',(json.dumps(report,ensure_ascii=False,indent=2)+'\n').encode('utf8'))
    return report

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--city',required=True);p.add_argument('--source-dir',type=Path,required=True);p.add_argument('--output-dir',type=Path,required=True);a=p.parse_args();r=stage(a.city,a.source_dir,a.output_dir)
    print(json.dumps({k:r[k] for k in ['city_id','source_building_ways','imported_buildings','imported_roads','height_policy','gugis_bytes','gugis_sha256']},ensure_ascii=False))
