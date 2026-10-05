"""Acquire bounded EA 2022 bare-earth samples without publishing or changing cities."""
import argparse
from datetime import datetime,timezone
import hashlib,json,math
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request,urlopen
import numpy as np
from pyproj import Transformer
import rasterio
from rasterio.io import MemoryFile
from acquire_city_samples import atomic_new,ROOT

ENDPOINT='https://environment.data.gov.uk/spatialdata/lidar-composite-digital-terrain-model-dtm-1m/wcs'
COVERAGE='13787b9a-26a4-4775-8523-806d13af58fc__Lidar_Composite_Elevation_DTM_1m'
ENGLAND={'cambridge'}
MAX_BYTES=96*1024*1024

def projected_bounds(bbox):
    west,south,east,north=bbox
    transform=Transformer.from_crs(4326,27700,always_xy=True)
    # Include intermediate perimeter samples for curvature, not corners alone.
    sides=np.linspace(0,1,33)
    lon=np.r_[west+(east-west)*sides,west+(east-west)*sides,np.full(33,west),np.full(33,east)]
    lat=np.r_[np.full(33,south),np.full(33,north),south+(north-south)*sides,south+(north-south)*sides]
    x,y=transform.transform(lon,lat)
    bounds=[math.floor(min(x)),math.floor(min(y)),math.ceil(max(x)),math.ceil(max(y))]
    if not 1<bounds[2]-bounds[0]<=4096 or not 1<bounds[3]-bounds[1]<=4096:
        raise ValueError('Source crop exceeds the reviewed 4096x4096-pixel acquisition limit')
    return bounds

def acquire(city_id,output):
    if city_id not in ENGLAND:raise ValueError('EA England dataset cannot represent other nations')
    records=json.loads((ROOT/'shared/city-workspaces.json').read_bytes())
    record=next(r for r in records if r['id']==city_id)
    raster_path=output/f'ea-{city_id}-dtm-1m.tif';receipt_path=raster_path.with_suffix('.source.json')
    if raster_path.exists() or receipt_path.exists():raise FileExistsError('Retained source exists; choose a fresh output')
    box=projected_bounds(record['query_bbox_wgs84'])
    pairs=[('service','WCS'),('version','2.0.1'),('request','GetCoverage'),('coverageId',COVERAGE),
           ('subset',f'E({box[0]},{box[2]})'),('subset',f'N({box[1]},{box[3]})'),('format','image/tiff')]
    url=ENDPOINT+'?'+urlencode(pairs)
    with urlopen(Request(url,headers={'User-Agent':'GUGIS3D bounded public DTM research samples'}),timeout=120) as response:
        content=response.read(MAX_BYTES+1);content_type=response.headers.get('Content-Type','')
    if len(content)>MAX_BYTES:raise ValueError('WCS response exceeds bounded read')
    with MemoryFile(content) as memory, memory.open() as ds:
        if ds.count!=1 or ds.crs.to_epsg()!=27700 or ds.res!=(1.,1.) or ds.dtypes!=('float32',):raise ValueError('Unexpected source grid')
        if list(ds.bounds)!=box or ds.width!=box[2]-box[0] or ds.height!=box[3]-box[1]:raise ValueError('WCS extent changed')
        if ds.scales!=(1.,) or ds.offsets!=(0.,):raise ValueError('Unexpected elevation scaling')
        masked=ds.read(1,masked=True);valid=~np.ma.getmaskarray(masked)&np.isfinite(masked.data)
        if not valid.any():raise ValueError('No usable source pixels')
        receipt={'city_id':city_id,'name':record['name'],'url':url,'bbox_bng':box,'query_bbox_wgs84':record['query_bbox_wgs84'],
                 'bytes':len(content),'sha256':hashlib.sha256(content).hexdigest(),'content_type':content_type,
                 'retrieved_utc':datetime.now(timezone.utc).isoformat(),'width':ds.width,'height':ds.height,
                 'valid_pixels':int(valid.sum()),'nodata_pixels':int(valid.size-valid.sum()),
                 'minimum_m':float(masked.data[valid].min()),'maximum_m':float(masked.data[valid].max()),
                 'grid_audit':'One Float32 band, EPSG:27700, exact requested integer BNG extent, 1m, scale1/offset0',
                 'scope':'Independent centre-district raw sample, not all-city coverage; acquisition alone does not publish or replace terrain.'}
    output.mkdir(parents=True,exist_ok=True)
    atomic_new(raster_path,content);atomic_new(receipt_path,(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n').encode())
    return receipt

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--city',choices=sorted(ENGLAND),required=True)
    parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
    print(json.dumps(acquire(args.city,args.output),ensure_ascii=True,indent=2))
