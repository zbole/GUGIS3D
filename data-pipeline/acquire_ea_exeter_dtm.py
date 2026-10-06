"""Retain a bounded, independent Exeter EA bare-earth source before publication."""
import argparse
from datetime import datetime,timezone
import hashlib,json
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request,urlopen
import numpy as np
from rasterio.io import MemoryFile
from acquire_ea_newcastle_dtm import ROOT,ENDPOINT,COVERAGE,MAX_BYTES,projected_bounds
from acquire_city_samples import atomic_new

REVIEWED_BBOX=[-3.552,50.707,-3.510,50.736]

def acquire(output):
    record=next(c for c in json.loads((ROOT/'shared/city-workspaces.json').read_bytes()) if c['id']=='exeter')
    if record['query_bbox_wgs84']!=REVIEWED_BBOX:
        raise ValueError('Published Exeter window differs from reviewed bounded acquisition')
    raster_path=output/'ea-exeter-dtm-1m.tif';receipt_path=raster_path.with_suffix('.source.json')
    if raster_path.exists() or receipt_path.exists():raise FileExistsError('Retained source exists; choose a fresh output')
    box=projected_bounds(REVIEWED_BBOX)
    url=ENDPOINT+'?'+urlencode([('service','WCS'),('version','2.0.1'),('request','GetCoverage'),('coverageId',COVERAGE),('subset',f'E({box[0]},{box[2]})'),('subset',f'N({box[1]},{box[3]})'),('format','image/tiff')])
    with urlopen(Request(url,headers={'User-Agent':'GUGIS3D bounded public Exeter DTM sample'}),timeout=120) as response:
        content=response.read(MAX_BYTES+1);content_type=response.headers.get('Content-Type','')
    if len(content)>MAX_BYTES:raise ValueError('WCS response exceeds bounded read')
    with MemoryFile(content) as memory,memory.open() as ds:
        if ds.count!=1 or ds.crs.to_epsg()!=27700 or ds.res!=(1.,1.) or ds.dtypes!=('float32',) or ds.scales!=(1.,) or ds.offsets!=(0.,):raise ValueError('Unexpected source grid or elevation scaling')
        if list(ds.bounds)!=box or ds.width!=box[2]-box[0] or ds.height!=box[3]-box[1]:raise ValueError('WCS extent changed')
        masked=ds.read(1,masked=True);valid=~np.ma.getmaskarray(masked)&np.isfinite(masked.data)
        if not valid.any():raise ValueError('No usable source pixels')
        receipt={'city_id':'exeter','name':record['name'],'url':url,'bbox_bng':box,'query_bbox_wgs84':REVIEWED_BBOX,'bytes':len(content),'sha256':hashlib.sha256(content).hexdigest(),'content_type':content_type,'retrieved_utc':datetime.now(timezone.utc).isoformat(),'width':ds.width,'height':ds.height,'valid_pixels':int(valid.sum()),'nodata_pixels':int(valid.size-valid.sum()),'minimum_m':float(masked.data[valid].min()),'maximum_m':float(masked.data[valid].max()),'grid_audit':'One Float32 band, EPSG:27700, exact requested integer BNG extent, 1m, scale1/offset0','scope':'Independent Exeter centre and riverside sample, not all-city coverage; acquisition alone does not publish or replace terrain.'}
    output.mkdir(parents=True,exist_ok=True)
    atomic_new(raster_path,content);atomic_new(receipt_path,(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n').encode())
    return receipt

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,required=True)
    print(json.dumps(acquire(parser.parse_args().output),ensure_ascii=True,indent=2))
