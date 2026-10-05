"""Lossless EA sample + independent preview; publish metadata only after native audit."""
import argparse,hashlib,json,math,shutil,subprocess,sys
from collections import Counter
from pathlib import Path
import numpy as np
from pyproj import Transformer
import rasterio
from rasterio.windows import Window
from acquire_ea_city_dtm import ROOT,ENGLAND
sys.path.insert(0,str(ROOT/'backend'))
from app.services.terrain_builder import import_dem
from app.environment_models import Terrain
from app.services.workspace_catalog import CITY_DEFAULTS
from build_bristol_public_terrain import DATASET,NOTICE

def sha(b):return hashlib.sha256(b).hexdigest()
def packed(value):return (json.dumps(value,ensure_ascii=False,indent=2)+'\n').encode()

def prepare(city_id,source,expected_sha,output):
    if city_id not in ENGLAND-{'bristol'}:raise ValueError('This additive workflow does not replace Bristol')
    raw=source.read_bytes();receipt=json.loads(source.with_suffix('.source.json').read_bytes())
    if sha(raw)!=expected_sha or receipt['sha256']!=expected_sha or receipt['bytes']!=len(raw) or receipt['city_id']!=city_id:
        raise ValueError('Source differs from reviewed acquisition')
    workspace=CITY_DEFAULTS[city_id]
    if receipt['query_bbox_wgs84']!=workspace['query_bbox_wgs84']:raise ValueError('Workspace crop changed')
    public=ROOT/'backend/data/terrain';raster_path=public/f'{city_id}-ea-dtm-1m.tif'
    model_path=public/f'{city_id}-ea-dtm-preview.gugis-terrain.json'
    if raster_path.exists() or model_path.exists() or output.exists():raise FileExistsError('Use fresh output; retained data cannot be overwritten')
    output.mkdir(parents=True);pixel_hash=hashlib.sha256()
    with rasterio.open(source) as ds:
        if ds.crs.to_epsg()!=27700 or ds.res!=(1.,1.) or ds.count!=1 or ds.dtypes!=('float32',):raise ValueError('Unexpected grid')
        if ds.width!=receipt['width'] or ds.height!=receipt['height'] or list(ds.bounds)!=receipt['bbox_bng']:raise ValueError('Source receipt mismatch')
        profile={**ds.profile,'compress':'deflate','predictor':3,'tiled':True,'blockxsize':256,'blockysize':256}
        with rasterio.open(raster_path,'w',**profile) as dst:
            for top in range(0,ds.height,256):
                for left in range(0,ds.width,256):
                    w=Window(left,top,min(256,ds.width-left),min(256,ds.height-top));block=ds.read(1,window=w)
                    pixel_hash.update(block.astype('<f4').tobytes());dst.write(block,1,window=w)
        with rasterio.open(raster_path) as restored:
            if restored.crs!=ds.crs or restored.transform!=ds.transform or restored.nodata!=ds.nodata or restored.scales!=ds.scales or restored.offsets!=ds.offsets:raise ValueError('Raster metadata changed')
            for _,w in restored.block_windows(1):
                if not np.array_equal(ds.read(1,window=w),restored.read(1,window=w),equal_nan=True):raise ValueError('Raster pixels changed')
    raster=raster_path.read_bytes()
    terrain=import_dem(raster,f"{workspace['name']} · EA 2022 DTM · 20像元采样预览",datum='ODN',stride=20,
                       clip_bounds=workspace['query_bbox_wgs84'],coverage_label=workspace['coverage_label'])
    terrain.source.update({'来源':'Environment Agency 2022 LIDAR Composite DTM；公开 WCS 中心街区裁剪','数据集说明':DATASET,
                          '许可':'Open Government Licence v3.0','署名':NOTICE,'原始下载SHA256':expected_sha,
                          '下载时间UTC':receipt['retrieved_utc'],'工作流':'独立地形候选；正式城市未替换',
                          '精度边界':'20像元采样，固定原像元抽查；不保证全分辨率误差或工程精度'})
    terrain=Terrain.model_validate(terrain.model_dump());model=(json.dumps(terrain.model_dump(exclude_none=True),ensure_ascii=False,separators=(',',':'))+'\n').encode()
    model_path.write_bytes(model)
    info={'city_id':city_id,'name':f"{workspace['name']} · 英国环境署裸地 DTM",'product':'EA 2022 LIDAR Composite DTM · 1 m',
          'dataset_url':DATASET,'license':'Open Government Licence v3.0','attribution':NOTICE,
          'license_url':'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/',
          'source_url':receipt['url'],'retrieved_utc':receipt['retrieved_utc'],'query_bbox_wgs84':workspace['query_bbox_wgs84'],
          'raster_bbox_bng':receipt['bbox_bng'],'source_crs':'EPSG:27700','vertical_datum':'ODN','height_unit':'m',
          'width':receipt['width'],'height':receipt['height'],'source_pixel_m':1,'valid_pixels':receipt['valid_pixels'],
          'nodata_pixels':receipt['nodata_pixels'],'min_height_m':receipt['minimum_m'],'max_height_m':receipt['maximum_m'],
          'raw_bytes':len(raw),'raw_sha256':expected_sha,'raster_bytes':len(raster),'raster_sha256':sha(raster),
          'raster_pixel_block_sha256':pixel_hash.hexdigest(),'compression_audit':'Only DEFLATE compression; every pixel, CRS, transform, NoData and scale/offset compared',
          'preview_stride_pixels':20,'preview_points':len(terrain.points),'preview_patches':dict(Counter(p.kind for p in terrain.patches)),
          'model_bytes':len(model),'model_sha256':sha(model),'coverage_label':workspace['coverage_label']+'；采样像元中心为模型边界',
          'accuracy_note':'1 m源分辨率不等于20像元预览精度；保留ODN高程，无椭球高转换。抽查不保证连续误差或独立真实地面精度。',
          'unit_metadata_warning':'WCS Elevation单位字段与官方米制说明冲突；GeoTIFF未写高程单位，米制依据官方数据集正文。',
          'audit_base_url':f'/research/{city_id}-terrain'}
    (output/'source-info.json').write_bytes(packed(info))
    with rasterio.open(raster_path) as ds:
        values=ds.read(1,masked=True);valid=~np.ma.getmaskarray(values)&np.isfinite(values.data)
        valid[:40]=False;valid[-40:]=False;valid[:,:40]=False;valid[:,-40:]=False
        possible=np.flatnonzero(valid)
        if len(possible)<4096:raise ValueError('Insufficient source-valid interior pixels')
        sample=np.random.default_rng(20261005).choice(possible,4096,replace=False)
        rows,cols=sample//ds.width,sample%ds.width
        sx,sy=rasterio.transform.xy(ds.transform,rows,cols,offset='center')
        lon,lat=Transformer.from_crs(ds.crs,4326,always_xy=True).transform(sx,sy)
        ecef=Transformer.from_crs(4979,4978,always_xy=True);ex,ey,ez=ecef.transform(lon,lat,np.zeros(4096))
        ox,oy,oz=ecef.transform(terrain.longitude,terrain.latitude,0);a,b=math.radians(terrain.longitude),math.radians(terrain.latitude)
        x=-math.sin(a)*(ex-ox)+math.cos(a)*(ey-oy)
        y=-math.sin(b)*math.cos(a)*(ex-ox)-math.sin(b)*math.sin(a)*(ey-oy)+math.cos(b)*(ez-oz)
        fixtures=[{'row':int(r),'column':int(c),'x':float(xx),'y':float(yy),'source_height_m':float(values.data[r,c])} for r,c,xx,yy in zip(rows,cols,x,y)]
    (output/'pixel-queries.json').write_bytes(packed(fixtures))
    subprocess.run(['node','frontend/scripts/audit-ea-city-terrain.mjs',str(output),city_id],cwd=ROOT,check=True)
    audit=json.loads((output/'preview-audit.json').read_bytes())
    if audit['hits']<.8*audit['requested'] or audit['max_control_query_error_m']>1e-9:raise ValueError('Candidate audit failed; do not publish manifest')
    info['sample_audit']={k:audit[k] for k in ['requested','hits','rmse_m','mae_m','p95_absolute_m','max_absolute_m']}
    info['sample_audit_sha256']=sha((output/'preview-audit.json').read_bytes())
    (output/'source-info.json').write_bytes(packed(info))
    research=ROOT/f'frontend/public/research/{city_id}-terrain';research.mkdir(exist_ok=False)
    for name in ['preview-audit.json','pixel-queries.csv','pixel-queries.json']:shutil.copyfile(output/name,research/name)
    shutil.copyfile(source.with_suffix('.source.json'),public/f'{city_id}-ea-dtm.source.json')
    manifest_path=ROOT/'shared/public-terrain-sources.json';manifest=json.loads(manifest_path.read_bytes())
    if any(s['city_id']==city_id for s in manifest['sources']):raise ValueError('Published metadata exists')
    manifest['sources'].append(info);manifest_path.write_bytes(packed(manifest))
    print(json.dumps(info,ensure_ascii=True,indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--city',required=True);p.add_argument('--source',type=Path,required=True)
    p.add_argument('--expected-sha256',required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    prepare(a.city,a.source,a.expected_sha256,a.output)
