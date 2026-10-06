"""C0 real-source mixtures with both P1 rectangle diagonals costed explicitly."""
import math
import numpy as np
import hybrid_source_math as frozen
from source_band_benchmark import surface,binary
def reflected(reference):return {**reference,'height':np.asarray(reference['height'])[:,::-1].tolist()}
def make_model(reference,nx,ny,families):
    if nx not in [1,2,4,8,16,32,64] or ny not in [1,2,4,8,16,32,64] or len(families)!=nx*ny or any(f not in ['ruled','minus','plus'] for f in families):raise ValueError('Fixed tensor grid / valid native families required')
    z=np.asarray(reference['height']);xs=np.arange(nx+1)*64//nx;ys=np.arange(ny+1)*64//ny;points=[[float(x-32),float(y-32),float(z[y,x])] for y in ys for x in xs];patches=[]
    for j in range(ny):
        start=0
        while start<nx:
            family=families[j*nx+start];end=start+1
            while end<nx and families[j*nx+end]==family:end+=1
            lower=[j*(nx+1)+i for i in range(start,end+1)];upper=[(j+1)*(nx+1)+i for i in range(start,end+1)]
            if family=='ruled':patches.append({'kind':'ruled-strip','left':lower,'right':upper})
            else:
                rows=(lower,upper) if family=='minus' else (upper,lower);patches.append({'kind':'triangle-strip','indices':[n for pair in zip(*rows) for n in pair]})
            start=end
    return surface(reference,points,patches)
def cells(reference,nx,ny,cache,mirror_cache):
    z=np.asarray(reference['height']);mirror=z[:,::-1];dx,dy=64//nx,64//ny;out=[]
    for j in range(ny):
        for i in range(nx):
            key=(i*dx,(i+1)*dx,j*dy,(j+1)*dy);mk=(64-(i+1)*dx,64-i*dx,j*dy,(j+1)*dy)
            if key not in cache:cache[key]=frozen.block_metrics(z,*key)
            if mk not in mirror_cache:mirror_cache[mk]=frozen.block_metrics(mirror,*mk)
            original=cache[key];minus=original['p1'];plus=mirror_cache[mk]['p1'];plus={**plus,'witness_xy':[-plus['witness_xy'][0],plus['witness_xy'][1]]}
            if dx==1 and dy==1:
                coefficient=float(z[j,i]-z[j,i+1]-z[j+1,i]+z[j+1,i+1]);identity={'l2_squared':coefficient*coefficient/90,'maximum_m':abs(coefficient)/4,'witness_xy':[i+.5-32,j+.5-32]};minus=identity;plus=identity
            out.append({'ruled':original['ruled'],'minus':minus,'plus':plus})
    return out
def grid(reference,nx,ny,cache,mirror_cache):
    choices=cells(reference,nx,ny,cache,mirror_cache);guard=1e-9+float(np.abs(reference['height']).max())*1e-12;result={}
    for method,allowed in [('p1-local',['minus','plus']),('hybrid-local',['ruled','minus','plus'])]:
        families=[]
        for c in choices:
            minimum=min(c[f]['l2_squared'] for f in allowed);tie_guard=64*np.finfo(float).eps*max(1,*[c[f]['l2_squared'] for f in allowed]);families.append(next(f for f in allowed if c[f]['l2_squared']<=minimum+tie_guard))
        selected=[c[f] for c,f in zip(choices,families)];maximum=max(selected,key=lambda c:c['maximum_m']);model=make_model(reference,nx,ny,families);raw=binary(model);e2=math.sqrt(math.fsum(c['l2_squared'] for c in selected))
        result[method]=(model,{'nx':nx,'ny':ny,'method':method,'families':families,'e2_m2':e2,'rms_integral_m':e2/64,'continuous_maximum_m':maximum['maximum_m'],'maximum_witness_xy':maximum['witness_xy'],'float64_guard_m':guard,'continuous_bound_m':maximum['maximum_m']+guard,'integrated_area_m2':4096,'binary_bytes':len(raw),'stored_points':len(model['points']),'stored_patches':len(model['patches']),'ruled_cells':families.count('ruled'),'minus_cells':families.count('minus'),'plus_cells':families.count('plus'),'p1_triangles':2*(nx*ny-families.count('ruled')),'native_primitives':2*nx*ny-families.count('ruled')})
    return result
