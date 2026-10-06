"""Read a reviewed additive plan, retain source receipts before publishing a workspace."""
import argparse,json,math,re
from pathlib import Path
from acquire_city_samples import ROOT,acquire,SUPPORTED_ENDPOINTS
PLAN=ROOT/'data-pipeline/additional_city_samples.json'

def read_plan():
    plan=json.loads(PLAN.read_bytes())
    if plan.get('schema')!='gugis-additional-city-sample-plan-v1':raise ValueError('Unexpected plan')
    seen=set()
    for c in plan['cities']:
        if set(c)!={'id','name','city_name','coverage_label','query_bbox_wgs84','related_registry_id'}:raise ValueError('Invalid plan fields')
        if not re.fullmatch(r'[a-z][a-z0-9-]{0,60}',c['id']) or c['id'] in seen:raise ValueError('Invalid or duplicate plan city')
        seen.add(c['id']);box=c['query_bbox_wgs84']
        if len(box)!=4 or any(type(x) not in (int,float) or not math.isfinite(x) for x in box) or not -180<=box[0]<box[2]<=180 or not -85<=box[1]<box[3]<=85:raise ValueError('Invalid sample bounds')
        if box[2]-box[0]>.1 or box[3]-box[1]>.1:raise ValueError('Additional crop exceeds bounded acquisition')
    return plan

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--city',required=True);p.add_argument('--output-dir',type=Path,required=True);p.add_argument('--endpoint',choices=SUPPORTED_ENDPOINTS);p.add_argument('--timeout',type=int,default=45,choices=range(5,146));p.add_argument('--method',choices=['GET','POST'],default='GET');a=p.parse_args()
    records={c['id']:c for c in read_plan()['cities']}
    if a.city not in records:p.error('City absent from reviewed plan')
    print(json.dumps(acquire(records[a.city],a.output_dir,method=a.method,request_timeout=a.timeout,endpoints=[a.endpoint] if a.endpoint else None),ensure_ascii=False))
