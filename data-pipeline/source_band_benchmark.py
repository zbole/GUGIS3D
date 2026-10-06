"""Full source-function controls on all 20 frozen real DTM windows.

Compare vector ruled bands, source-node P1 strips and source-cell P2 triangles
using the same complete georeferenced GPR4 codec. Include a compact Float32
regular-grid control; no superiority over raster storage or ground-truth claim.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
def sha(b):return hashlib.sha256(b).hexdigest()
def packed(v):return json.dumps(v,separators=(',',':'),allow_nan=False).encode()
def frame(reference):return {'clip_bounds':[-32.,-32.,32.,32.],'origin_bng':reference['origin_bng'],'horizontal_epsg':27700,'vertical_datum':'ODN'}
def surface(reference,points,patches):return {'format':'gugis-research-surface','version':4,'coordinate_system':'LOCAL_METERS',**frame(reference),'points':points,'patches':patches}
def header(m,magic,version,a,b):return struct.pack('<4sHHII4d2dIHHQ',magic,version,1,a,b,*m['clip_bounds'],*m['origin_bng'],27700,1,1,0)
def binary(m):
    out=bytearray(header(m,b'GPR4',4,len(m['points']),len(m['patches'])))
    for p in m['points']:out.extend(struct.pack('<3d',*p))
    for p in m['patches']:
        band=p['kind']=='ruled-strip';p2=p['kind']=='lagrange-triangle';ids=p['left']+p['right'] if band else p['indices']
        out.extend(struct.pack('<BBHII',4 if band else 3 if p2 else 2,2 if p2 else 1,0,len(ids),0));out.extend(struct.pack('<'+'I'*len(ids),*ids))
    return bytes(out)
def grid_binary(reference):
    z=np.asarray(reference['height'],dtype='<f4')
    if not np.array_equal(z.astype(float),np.asarray(reference['height'])):raise ValueError('Reference heights are not original Float32 values')
    return header(frame(reference),b'ZGR1',1,65,65)+z.tobytes(order='C')
def reference_value(reference,xy):
    xy=np.asarray(xy,float);x,y=xy[...,0],xy[...,1];z=np.asarray(reference['height'],float);ix=np.clip(np.floor(x+32).astype(int),0,63);iy=np.clip(np.floor(y+32).astype(int),0,63);u=x+32-ix;v=y+32-iy
    return z[iy,ix]+(z[iy,ix+1]-z[iy,ix])*u+(z[iy+1,ix]-z[iy,ix])*v+(z[iy,ix]-z[iy,ix+1]-z[iy+1,ix]+z[iy+1,ix+1])*u*v
def make_models(reference):
    z=np.asarray(reference['height'],float)
    if reference['x']!=list(range(-32,33)) or reference['y']!=list(range(-32,33)) or z.shape!=(65,65) or not np.isfinite(z).all():raise ValueError('Complete frozen 1m window required')
    points=[[float(i-32),float(j-32),float(z[j,i])] for j in range(65) for i in range(65)];bands=[];strips=[]
    for j in range(64):
        left=[j*65+i for i in range(65)];right=[(j+1)*65+i for i in range(65)];bands.append({'kind':'ruled-strip','left':left,'right':right});strips.append({'kind':'triangle-strip','indices':[n for pair in zip(left,right) for n in pair]})
    # Half-source-step lattice shares all P2 edge and diagonal nodes globally.
    xy=np.array([[i/2-32,j/2-32] for j in range(129) for i in range(129)]);height=reference_value(reference,xy);p2_points=[[float(x),float(y),float(h)] for (x,y),h in zip(xy,height)];p2=[]
    for j in range(64):
        for i in range(64):
            a=(2*i,2*j);b=(2*i,2*j+2);c=(2*i+2,2*j);d=(2*i+2,2*j+2)
            for pa,pb,pc in ((a,b,c),(d,c,b)):
                ab=((pa[0]+pb[0])//2,(pa[1]+pb[1])//2);ac=((pa[0]+pc[0])//2,(pa[1]+pc[1])//2);bc=((pb[0]+pc[0])//2,(pb[1]+pc[1])//2)
                p2.append({'kind':'lagrange-triangle','degree':2,'indices':[y*129+x for x,y in (pa,ab,ac,pb,bc,pc)]})
    return {'ruled':surface(reference,points,bands),'source_p1':surface(reference,points,strips),'source_p2':surface(reference,p2_points,p2)}
def integration(reference,m,nodes=3):
    t,w=np.polynomial.legendre.leggauss(nodes);t=(t+1)/2;w=w/2;u,v=np.meshgrid(t,t,indexing='ij');wu,wv=np.meshgrid(w,w,indexing='ij');weights=(wu*wv).ravel();parts=[];areas=[]
    for p in m['patches']:
        if p['kind']=='ruled-strip':
            for i in range(len(p['left'])-1):
                a,b,c,d=np.asarray([m['points'][k] for k in (p['left'][i],p['left'][i+1],p['right'][i],p['right'][i+1])]);xy=a[:2]+u.ravel()[:,None]*(b[:2]-a[:2])+v.ravel()[:,None]*(c[:2]-a[:2]);value=a[2]+(b[2]-a[2])*u.ravel()+(c[2]-a[2])*v.ravel()+(a[2]-b[2]-c[2]+d[2])*u.ravel()*v.ravel();residual=value-reference_value(reference,xy);area=abs(float(np.linalg.det(np.column_stack((b[:2]-a[:2],c[:2]-a[:2])))));parts.append(float(np.dot(weights,residual**2))*area);areas.append(area)
        else:
            triangles=[p['indices']] if p['kind']=='lagrange-triangle' else [p['indices'][i:i+3] for i in range(len(p['indices'])-2)]
            tb=u.ravel();tc=((1-u)*v).ravel();ta=1-tb-tc;tw=(wu*wv*(1-u)).ravel()
            for ids in triangles:
                points=np.asarray([m['points'][i] for i in ids]);pa,pb,pc=points[[0,3,5],:2] if p['kind']=='lagrange-triangle' else points[:,:2];xy=ta[:,None]*pa+tb[:,None]*pb+tc[:,None]*pc
                if p['kind']=='lagrange-triangle':value=np.column_stack((ta*(2*ta-1),4*ta*tb,4*ta*tc,tb*(2*tb-1),4*tb*tc,tc*(2*tc-1)))@points[:,2]
                else:value=ta*points[0,2]+tb*points[1,2]+tc*points[2,2]
                residual=value-reference_value(reference,xy);det=abs(float(np.linalg.det(np.column_stack((pb-pa,pc-pa)))));parts.append(float(np.dot(tw,residual**2))*det);areas.append(det/2)
    area=math.fsum(areas)
    if abs(area-4096)>1e-8:raise ValueError('Saved source geometry does not cover the full reference')
    return {'e2_m2':math.sqrt(math.fsum(parts)),'integrated_area_m2':area,'rms_integral_m':math.sqrt(math.fsum(parts))/64}
def p1_closed_metrics(reference):
    z=np.asarray(reference['height']);mixed=z[:-1,:-1]-z[:-1,1:]-z[1:,:-1]+z[1:,1:];j,i=np.unravel_index(int(np.argmax(abs(mixed))),mixed.shape);maximum=float(abs(mixed[j,i]))/4
    return {'e2_m2':math.sqrt(float(np.sum(mixed**2))/90),'maximum_residual_m':maximum,'maximum_witness':{'x':float(i-31.5),'y':float(j-31.5),'absolute_error_m':maximum}}
def build(folder):
    if folder.exists():raise FileExistsError('Fresh private output required')
    parent_path=ROOT/'frontend/public/research/dem-curved-grid-v1/results.json';parent_raw=parent_path.read_bytes();parent=json.loads(parent_raw);catalog_raw=(ROOT/'shared/public-terrain-sources-v8.json').read_bytes();catalog=json.loads(catalog_raw)
    if parent['source_catalogue_sha256']!=sha(catalog_raw) or len(parent['cases'])!=20:raise ValueError('Changed source catalogue or fixed cases')
    folder.mkdir(parents=True);report={'schema':'gugis-source-native-bands-v1','source_catalogue_sha256':sha(catalog_raw),'parent_report_sha256':sha(parent_raw),'source_sha256':sha(Path(__file__).read_bytes().replace(b'\r\n',b'\n')),
      'scope':'All 20 fixed 65x65 original Float32 DTM windows from ten cities. Common source-relative continuous cellwise bilinear reference, not independently surveyed ground or strict-convex paper fields.',
      'comparison':'Full shared-XYZ georeferenced GPR4 files with the same 80-byte BNG/ODN/clip header, Float64 XYZ and 12-byte native records. Native linear ruled bands versus source-node P1 strips and source-cell P2 triangles. A complete implicit-XY Float32 regular grid ZGR1 control is included and may be smaller; no general raster-storage superiority claim.',
      'query_cache':'Ruled bands are compiled to cell functions without triangulation. Midpoint execution controls and prepared coefficients are caches, not stored-file bytes or a heap-memory measurement.', 'cases':[]};validated=set()
    for c in parent['cases']:
        cid=c['id'];out=folder/cid;out.mkdir();path=ROOT/'frontend/public/research/dem-curved-grid-v1'/cid/'reference.json';ref_raw=path.read_bytes()
        if sha(ref_raw)!=c['reference_sha256']:raise ValueError('Frozen reference changed')
        reference=json.loads(ref_raw);source=next(s for s in catalog['sources'] if s['city_id']==c['city_id']);raster=ROOT/f"backend/data/terrain/{c['city_id']}-ea-dtm-1m.tif"
        if source['source_crs']!='EPSG:27700' or source['vertical_datum']!='ODN' or source['height_unit']!='m':raise ValueError('Unsupported published source coordinate frame')
        if c['city_id'] not in validated:
            if sha(raster.read_bytes())!=source['raster_sha256']:raise ValueError('Source raster changed')
            validated.add(c['city_id'])
        top,left,width,height=reference['source_window']
        with Image.open(raster) as image:
            geokeys=image.tag_v2.get(34735,());keys={geokeys[4+4*i]:geokeys[5+4*i:8+4*i] for i in range(geokeys[3])} if len(geokeys)>=4 else {}
            if image.mode!='F' or keys.get(1024)!=(0,1,1) or keys.get(1025)!=(0,1,1) or keys.get(3072)!=(0,1,27700):raise ValueError('Float32 projected PixelIsArea EPSG:27700 source required')
            scale=image.tag_v2[33550];tie=image.tag_v2[33922];origin=[tie[3]+(left+(width-1)/2+.5-tie[0])*scale[0],tie[4]-(top+(height-1)/2+.5-tie[1])*scale[1]];source_values=np.asarray(image.crop((left,top,left+width,top+height)))[::-1]
            if scale[:2]!=(1.,1.) or origin!=reference['origin_bng'] or not np.isfinite(source_values).all() or np.any(abs(source_values)>10000) or not np.array_equal(source_values,np.asarray(reference['height'])):raise ValueError('Source pixel values, spacing, validity or BNG origin differ')
        models=make_models(reference);(out/'reference.json').write_bytes(ref_raw);entries=[];closed=p1_closed_metrics(reference);guard=1e-9+float(np.abs(reference['height']).max())*1e-12
        for family,m in models.items():
            jr=packed(m);br=binary(m);name=family;measured=integration(reference,m,3)
            if family=='source_p1' and abs(measured['e2_m2']-closed['e2_m2'])>1e-8:raise ValueError('P1 whole-cell integral differs from closed-form mixed-term residual')
            if family!='source_p1' and measured['e2_m2']>=1e-8:raise ValueError('Full source-function accuracy gate failed')
            metrics=measured|({'maximum_residual_m':closed['maximum_residual_m'],'maximum_witness':closed['maximum_witness']} if family=='source_p1' else {})
            maximum=closed['maximum_residual_m'] if family=='source_p1' else 0
            entry={'family':family,'filename':name+'.json','bytes':len(jr),'sha256':sha(jr),'binary_filename':name+'.bin','binary_bytes':len(br),'binary_sha256':sha(br),'controls':len(m['points']),'patches':len(m['patches']),'source_cells':4096,'native_primitives':4096 if family=='ruled' else 8192,'continuous_bound_m':maximum+guard,'float64_guard_m':guard,**metrics};(out/entry['filename']).write_bytes(jr);(out/entry['binary_filename']).write_bytes(br);entries.append(entry)
        raw_grid=grid_binary(reference);(out/'regular-grid.bin').write_bytes(raw_grid);grid={'filename':'regular-grid.bin','bytes':len(raw_grid),'sha256':sha(raw_grid),'width':65,'height':65,'samples':4225,'value_type':'Float32','implicit_xy':True};identity={k:source[k] for k in ('name','product','dataset_url','license','attribution','license_url','source_url','retrieved_utc','source_crs','vertical_datum','height_unit','unit_metadata_warning','source_pixel_m','raster_bytes','raster_sha256')};report['cases'].append({k:v for k,v in c.items() if k in ('id','city_id','name','reference_sha256','source_raster_sha256','source_window')}|{'origin_bng':reference['origin_bng'],'source_identity':identity,'models':entries,'regular_grid':grid})
        print(json.dumps({'case':cid,'complete_binary_bytes':{e['family']:e['binary_bytes'] for e in entries},'regular_grid_bytes':len(raw_grid),'e2_m2':{e['family']:e['e2_m2'] for e in entries}}),flush=True)
    (folder/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf8',newline='\n')

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True);build(p.parse_args().output)
