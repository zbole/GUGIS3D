"""Preserve a larger real source function as bounded, original-resolution tiles."""
import hashlib,json,sys
from pathlib import Path
import numpy as np
from PIL import Image,TiffImagePlugin
import source_band_benchmark as sb
ROOT=sb.ROOT
def sha(b):return hashlib.sha256(b).hexdigest()
def build(folder):
    if folder.exists():raise FileExistsError('Fresh private output required')
    catalogue_raw=(ROOT/'shared/public-terrain-sources-v8.json').read_bytes();catalogue=json.loads(catalogue_raw);source=next(s for s in catalogue['sources'] if s['city_id']=='manchester');raster=ROOT/'backend/data/terrain/manchester-ea-dtm-1m.tif'
    if sha(raster.read_bytes())!=source['raster_sha256'] or source['source_crs']!='EPSG:27700' or source['vertical_datum']!='ODN' or source['height_unit']!='m':raise ValueError('Frozen source frame changed')
    fixed=json.loads((ROOT/'frontend/public/research/source-native-bands-v1/manchester-centre/reference.json').read_bytes());top,left,_,_=fixed['source_window'];top-=224;left-=224
    with Image.open(raster) as image:
        scale=image.tag_v2[33550];tie=image.tag_v2[33922]
        if image.mode!='F' or scale[:2]!=(1.,1.):raise ValueError('Original Float32 1m source required')
        keys=image.tag_v2[34735];records={keys[i]:tuple(keys[i+1:i+4]) for i in range(4,len(keys),4)}
        if records.get(3072)!=(0,1,27700) or records.get(1025)!=(0,1,1):raise ValueError('Projected BNG PixelIsArea source required')
        if top<0 or left<0 or top+513>image.height or left+513>image.width:raise ValueError('Fixed source window leaves raster')
        values=np.asarray(image.crop((left,top,left+513,top+513)),dtype=np.float32)[::-1].copy()
        if not np.isfinite(values).all() or np.any(abs(values)>10000):raise ValueError('NoData is not bridged')
        origin=[tie[3]+(left+256.5-tie[0])*scale[0],tie[4]-(top+256.5-tie[1])*scale[1]]
        if origin!=fixed['origin_bng']:raise ValueError('Fixed source centre shifted')
        tags=TiffImagePlugin.ImageFileDirectory_v2()
        for key in (34735,34736,34737,42113):
            if key in image.tag_v2:tags[key]=image.tag_v2[key]
        tags[33550]=(1.,1.,0.);tags[33922]=(0.,0.,0.,origin[0]-256.5,origin[1]+256.5,0.)
    folder.mkdir(parents=True);(folder/'tiles').mkdir();grid=values.astype('<f4').tobytes();(folder/'reference-grid.f32').write_bytes(grid)
    Image.fromarray(values[::-1].copy()).save(folder/'source-window.tif',compression='tiff_adobe_deflate',tiffinfo=tags)
    with Image.open(folder/'source-window.tif') as image:
        if image.size!=(513,513) or image.mode!='F' or not np.array_equal(np.asarray(image)[::-1],values):raise ValueError('Derived source GeoTIFF changes pixel values')
    entries=[]
    for row in range(8):
        for column in range(8):
            sub=values[64*row:64*row+65,64*column:64*column+65];tile_origin=[origin[0]-224+64*column,origin[1]-224+64*row]
            reference={'origin_bng':tile_origin,'height':sub.astype(float).tolist()};points=[[float(i-32),float(j-32),float(sub[j,i])] for j in range(65) for i in range(65)]
            bands=[{'kind':'ruled-strip','left':[j*65+i for i in range(65)],'right':[(j+1)*65+i for i in range(65)]} for j in range(64)]
            model=sb.surface(reference,points,bands);body=sb.binary(model);name=f'row-{row:02d}-col-{column:02d}.bin';(folder/'tiles'/name).write_bytes(body)
            entries.append({'id':f'r{row}c{column}','row':row,'column':column,'filename':'tiles/'+name,'bytes':len(body),'sha256':sha(body),'origin_bng':tile_origin,'bounds_bng':[tile_origin[0]-32,tile_origin[1]-32,tile_origin[0]+32,tile_origin[1]+32],'source_controls':4225,'bands':64,'source_cells':4096})
    tif=(folder/'source-window.tif').read_bytes();identity={k:source[k] for k in ['name','product','dataset_url','license','attribution','license_url','source_url','retrieved_utc','source_crs','vertical_datum','height_unit','unit_metadata_warning','raster_bytes','raster_sha256']}
    report={'schema':'gugis-ruled-terrain-tiles-v1','id':'manchester-centre-1m','name':'曼彻斯特中心 · 原始 1 m 面带分块样区','city_id':'manchester','source_catalogue_sha256':sha(catalogue_raw),'source_identity':identity,'source_window':[top,left,513,513],'origin_bng':origin,'bounds_bng':[origin[0]-256,origin[1]-256,origin[0]+256,origin[1]+256],'domain_area_m2':512*512,'source_pixel_m':1,'grid_width':513,'grid_height':513,'source_samples':513*513,'source_cells':512*512,'rows':8,'columns':8,'tile_cells':64,'tiles':entries,'total_tile_bytes':sum(t['bytes'] for t in entries),'reference':{'filename':'reference-grid.f32','bytes':len(grid),'sha256':sha(grid),'value_type':'Float32 little endian','order':'row-major increasing northing; original source pixels unchanged'},'source_geotiff':{'filename':'source-window.tif','bytes':len(tif),'sha256':sha(tif),'source_pixels_unchanged':True,'pixel_area_side_m':513,'function_domain_side_m':512},'scope':'Fixed 512x512m local centre sample, not whole Manchester. Original 1m piecewise-bilinear source function retained; source-relative agreement is not independent surveyed ground accuracy. GeoTIFF PixelIsArea footprint is 513x513m; native domain lies between 513 source pixel centres. No ArcGIS, raster-storage or heap-memory superiority claim.','source_script_sha256':sha(Path(__file__).read_bytes().replace(b'\r\n',b'\n'))}
    (folder/'results.json').write_bytes(sb.packed(report));print('Produced 64 bounded GPR4 tiles and 263169 unchanged original Float32 source nodes',flush=True)
    return report
if __name__=='__main__':build(Path(sys.argv[1]))
