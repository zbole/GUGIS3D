"""Additive quadratic ruled-grid controls on 20 frozen real DTM windows.

Uses a common minimal native JSON envelope for both saved P1 triangle strips
and P2xP1 ruled grids. The finite grid pool and sample set are fixed. Full-domain
L2 is integrated per source cell. Maximum residual of a quadratic-in-one-axis,
linear-in-the-other polynomial is found on its two linear-axis boundaries,
including quadratic stationary points. Float64 guard, not interval arithmetic.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
GROUPS=('multicity','oxford','cambridge','liverpool','sheffield','leeds','nottingham','newcastle')
DENSITIES=(1,2,4,8,16,32,64)
TARGETS=(.1,.25,.5)
def sha(b):return hashlib.sha256(b).hexdigest()
def packed(v):return json.dumps(v,separators=(',',':'),allow_nan=False).encode()
def reference_value(reference,x,y):
    x,y=np.broadcast_arrays(np.asarray(x,float),np.asarray(y,float));z=np.asarray(reference['height'],float)
    if not np.isfinite(x).all() or not np.isfinite(y).all() or np.any(x<-32-1e-10) or np.any(x>32+1e-10) or np.any(y<-32-1e-10) or np.any(y>32+1e-10):raise ValueError('Outside complete source domain')
    ix=np.clip(np.floor(x+32).astype(int),0,63);iy=np.clip(np.floor(y+32).astype(int),0,63);u=x+32-ix;v=y+32-iy
    return (1-u)*(1-v)*z[iy,ix]+u*(1-v)*z[iy,ix+1]+(1-u)*v*z[iy+1,ix]+u*v*z[iy+1,ix+1]
def make_model(reference,nx,ny,axis):
    if nx not in DENSITIES or ny not in DENSITIES or axis not in ('x','y'):raise ValueError('Outside fixed grid pool')
    points=[];pool={};patches=[]
    def node(x,y,z):
        key=(float(x),float(y))
        if key in pool:
            if abs(points[pool[key]][2]-z)>1e-10:raise ValueError('Nonconforming curve boundary')
            return pool[key]
        pool[key]=len(points);points.append([float(x),float(y),float(z)]);return pool[key]
    for j in range(ny):
        for i in range(nx):
            x0,x1=-32+64*i/nx,-32+64*(i+1)/nx;y0,y1=-32+64*j/ny,-32+64*(j+1)/ny;curves=[]
            for fixed in ((y0,y1) if axis=='x' else (x0,x1)):
                xy=np.array([[x0,fixed],[(x0+x1)/2,fixed],[x1,fixed]] if axis=='x' else [[fixed,y0],[fixed,(y0+y1)/2],[fixed,y1]])
                z=reference_value(reference,xy[:,0],xy[:,1]);z[1]=2*z[1]-(z[0]+z[2])/2
                curves.append([node(x,y,h) for (x,y),h in zip(xy,z)])
            patches.append({'kind':'quadratic-ruled','left':curves[0],'right':curves[1]})
    return {'format':'gugis-research-surface','version':1,'coordinate_system':'LOCAL_METERS','points':points,'patches':patches}
def compile_grid(model,nx,ny,axis):
    if len(model['patches'])!=nx*ny:raise ValueError('Incomplete grid')
    coefficients=[]
    for patch in model['patches']:
        a,b=np.asarray([model['points'][i] for i in patch['left']]),np.asarray([model['points'][i] for i in patch['right']]);d=b[:,2]-a[:,2]
        coefficients.append([a[0,2],2*(a[1,2]-a[0,2]),a[0,2]-2*a[1,2]+a[2,2],d[0],2*(d[1]-d[0]),d[0]-2*d[1]+d[2]])
    c=np.asarray(coefficients).reshape(ny,nx,6)
    def query(x,y):
        x,y=np.broadcast_arrays(np.asarray(x,float),np.asarray(y,float));ix=np.clip(np.floor((x+32)*nx/64).astype(int),0,nx-1);iy=np.clip(np.floor((y+32)*ny/64).astype(int),0,ny-1)
        u=(x+32)*nx/64-ix;v=(y+32)*ny/64-iy
        if axis=='y':u,v=v,u
        a=c[iy,ix];return a[...,0]+u*(a[...,1]+u*a[...,2])+v*(a[...,3]+u*(a[...,4]+u*a[...,5]))
    return query
def metrics(reference,model,nx,ny,axis,nodes=3):
    query=compile_grid(model,nx,ny,axis);x0,y0=np.meshgrid(np.arange(64)-32,np.arange(64)-32,indexing='xy')
    t,w=np.polynomial.legendre.leggauss(nodes);t=(t+1)/2;w=w/2;u,v=np.meshgrid(t,t,indexing='ij')
    x=x0[...,None,None]+u;y=y0[...,None,None]+v;error=query(x,y)-reference_value(reference,x,y)
    e2=float(np.sqrt(np.sum(error**2*w[None,None,:,None]*w[None,None,None,:])))
    # The residual is linear across the ruling on each original source cell.
    # Its absolute maximum is therefore on t=0/1; along s it is quadratic.
    maximum=0.;witness=None
    for t in (0.,1.):
        err=[]
        for s in (0.,.5,1.):
            x,y=(x0+s,y0+t) if axis=='x' else (x0+t,y0+s)
            err.append(query(x,y)-reference_value(reference,x,y))
        a=2*(err[0]+err[2]-2*err[1]);b=err[2]-err[0]-a
        stationary=np.zeros_like(a);np.divide(-b,2*a,out=stationary,where=np.abs(a)>1e-16)
        inside=(np.abs(a)>1e-16)&(stationary>0)&(stationary<1)
        values=np.where(inside,err[0]+b*stationary+a*stationary**2,0)
        for s,errors in ((np.zeros_like(a),err[0]),(np.ones_like(a),err[2]),(stationary,values)):
            pos=np.unravel_index(int(np.argmax(np.abs(errors))),errors.shape);value=float(abs(errors[pos]))
            if value>maximum:
                maximum=value;along=float(s[pos]);xx,yy=(float(x0[pos]+along),float(y0[pos]+t)) if axis=='x' else (float(x0[pos]+t),float(y0[pos]+along))
                witness={'x':xx,'y':yy,'absolute_error_m':value}
    guard=1e-9+float(np.abs(reference['height']).max())*1e-12
    return {'e2_m2':e2,'rms_integral_m':e2/64,'integrated_area_m2':4096,'maximum_residual_m':maximum,'continuous_bound_m':maximum+guard,
            'float64_guard_m':guard,'maximum_witness':witness,'controls':len(model['points']),'patches':len(model['patches'])}
def common_triangles(original):
    if any(p['kind']!='triangle-strip' for p in original['patches']):raise ValueError('Pure retained P1 triangles required')
    return {'format':'gugis-research-surface','version':1,'coordinate_system':'LOCAL_METERS','points':original['points'],
      'patches':[{'kind':'triangle-strip','indices':p['indices']} for p in original['patches']]}
def checked(path,h,size=None):
    b=path.read_bytes()
    if sha(b)!=h or (size is not None and len(b)!=size):raise ValueError('Changed retained evidence: '+path.name)
    return b
def build(folder):
    if folder.exists():raise FileExistsError('Fresh private output required')
    folder.mkdir(parents=True);catalog_raw=(ROOT/'shared/public-terrain-sources-v8.json').read_bytes();catalog=json.loads(catalog_raw)
    report={'schema':'gugis-dem-curved-grid-v1','source_catalogue_sha256':sha(catalog_raw),'groups':list(GROUPS),'densities':list(DENSITIES),
      'candidates_per_site':98,'targets_m':list(TARGETS),'source_sha256':sha(Path(__file__).read_bytes().replace(b'\r\n',b'\n')),
      'selection':'All 20 retained, preselected 65x65 source windows from the uniform ten-city publication, no new selection by outcome.',
      'comparison':'Identical minimal full native JSON envelope for both families. P1 geometry and five-decimal heights retained exactly. P2xP1 edge interpolation uses unrounded Float64 source heights. Finite 98-grid pool, no optimality or construction-speed claim.',
      'accuracy':'Whole-domain E2 and maximum residual relative to the original continuous cellwise bilinear raster, not independently surveyed ground. Maximum includes quadratic stationary points with Float64 guard, not interval arithmetic. C0 fields do not meet paper C2 strict-convex assumptions.',
      'parents':{},'cases':[]}
    source_arrays={}
    for group in GROUPS:
        parent_raw=(ROOT/f'shared/{group}-terrain-benchmark.json').read_bytes();parent=json.loads(parent_raw);report['parents'][group]=sha(parent_raw)
        base=ROOT/f'frontend/public/research/{group}-terrain-benchmark' if group!='multicity' else ROOT/'frontend/public/research/multicity-terrain'
        for case in parent['cases']:
            cid=case['id'];out=folder/cid;out.mkdir();ref_raw=checked(base/cid/'reference.json',case['reference_sha256']);reference=json.loads(ref_raw)
            if reference['x']!=list(range(-32,33)) or reference['y']!=list(range(-32,33)) or np.asarray(reference['height']).shape!=(65,65):raise ValueError('Unexpected complete 1m grid')
            city=case['city_id'];source=next(s for s in catalog['sources'] if s['city_id']==city)
            if city not in source_arrays:
                path=ROOT/f'backend/data/terrain/{city}-ea-dtm-1m.tif';checked(path,source['raster_sha256'],source['raster_bytes'])
                with Image.open(path) as image:source_arrays[city]=np.asarray(image).copy()
            top,left,width,height=reference['source_window'];slice_=source_arrays[city][top:top+height,left:left+width][::-1]
            if not np.array_equal(slice_,np.asarray(reference['height'])):raise ValueError('Reference not identical to source pixels')
            (out/'reference.json').write_bytes(ref_raw)
            entries=[]
            for axis in ('x','y'):
                for nx in DENSITIES:
                    for ny in DENSITIES:
                        model=make_model(reference,nx,ny,axis);raw=packed(model);entry={'id':f'{axis}-{nx}x{ny}','axis':axis,'nx':nx,'ny':ny,'bytes':len(raw),'sha256':sha(raw),**metrics(reference,model,nx,ny,axis)};entries.append(entry)
            item={'id':cid,'city_id':city,'name':case['name'],'reference_sha256':sha(ref_raw),'source_raster_sha256':source['raster_sha256'],
                  'source_window':case['source_window'],'candidates':entries,'pairs':[]}
            for target in TARGETS:
                old=next(m for m in case['models'] if m['family']=='local_triangles' and m['target_m']==target)
                original=checked(base/cid/old['filename'],old['sha256'],old['bytes']);body=common_triangles(json.loads(original));raw=packed(body);name=f'p1-{round(target*100)}cm.json';(out/name).write_bytes(raw)
                baseline={'filename':name,'bytes':len(raw),'sha256':sha(raw),'parent_filename':old['filename'],'parent_sha256':old['sha256'],
                          'target_m':target,'e2_m2':old['e2_m2'],'continuous_bound_m':old['continuous_bound_m'],'native_triangles':old['native_triangles']}
                eligible=[e for e in entries if e['bytes']<=len(raw)]
                selected=min(eligible,key=lambda e:(e['e2_m2'],e['bytes'],e['id'])) if eligible else None
                jointly=[e for e in eligible if e['continuous_bound_m']<=old['continuous_bound_m']+1e-10]
                selected_joint=min(jointly,key=lambda e:(e['e2_m2'],e['bytes'],e['id'])) if jointly else None
                for e in (selected,selected_joint):
                    if e and not (out/(e['id']+'.json')).exists():(out/(e['id']+'.json')).write_bytes(packed(make_model(reference,e['nx'],e['ny'],e['axis'])))
                item['pairs'].append({'target_m':target,'baseline':baseline,'best_e2_at_file_ceiling':selected['id'] if selected else None,
                    'best_e2_with_maximum_gate':selected_joint['id'] if selected_joint else None,
                    'e2_reduction_percent':100*(1-selected['e2_m2']/old['e2_m2']) if selected else None,
                    'joint_e2_reduction_percent':100*(1-selected_joint['e2_m2']/old['e2_m2']) if selected_joint else None})
            report['cases'].append(item);print(json.dumps({'case':cid,'E2_reduction_percent':[p['e2_reduction_percent'] for p in item['pairs']],
                  'joint_E2_reduction_percent':[p['joint_e2_reduction_percent'] for p in item['pairs']]}),flush=True)
    if len(report['cases'])!=20:raise ValueError('Incomplete fixed sample set')
    (folder/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf8',newline='\n')

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True);build(p.parse_args().output)
