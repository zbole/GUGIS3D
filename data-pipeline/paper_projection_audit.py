"""Independent saved-coefficient integration and projection orthogonality audit."""
import math
import numpy as np
from publish_variable_curvature import clip,source,integral as frozen_integral
def integral(model,field,frame):
    error,area,primitives=frozen_integral(model,field,frame)
    return {'e2_m2':error,'integrated_area_m2':area,'native_primitives':primitives}
def orthogonality(model,original,field,frame,ratio=1e-14):
    t,w=np.polynomial.legendre.leggauss(5);t=(t+1)/2;w=w/2;u,v=np.meshgrid(t,t,indexing='ij');wu,wv=np.meshgrid(w,w,indexing='ij');b=u.ravel();c=((1-u)*v).ravel();a=1-b-c;weights=(wu*wv*(1-u)).ravel();points=np.asarray(model['points']);old=np.asarray(original['points']);load=np.zeros(len(points));diagonal=np.zeros(len(points));largest=0.;area=0.
    for patch in model['patches']:
        if patch['kind']=='triangle-strip':
            if len(patch['indices'])!=3:raise ValueError('Independent PT planes required')
            ids=patch['indices'];p=points[ids];faces=[p[:,:2]];basis=np.column_stack((a,b,c))
        elif patch['kind']=='quadratic-ruled':
            ids=patch['left']+patch['right'];p=points[ids];pa,pb,pc=p[0,:2],p[2,:2],p[3,:2];inverse=np.linalg.inv(np.column_stack((pb-pa,pc-pa)));poly=clip([p[0,:2],p[2,:2],p[5,:2],p[3,:2]]);faces=[np.asarray([poly[0],poly[k],poly[k+1]]) for k in range(1,len(poly)-1)]
        else:raise ValueError('Unexpected saved function family')
        for p0,p1,p2 in faces:
            determinant=abs(float(np.linalg.det(np.column_stack((p1-p0,p2-p0)))));xy=a[:,None]*p0+b[:,None]*p1+c[:,None]*p2;ww=weights*determinant
            if patch['kind']=='quadratic-ruled':
                uv=(xy-pa)@inverse.T;s,r=uv[:,0],uv[:,1];curve=np.stack(((1-s)**2,2*s*(1-s),s*s),axis=1);basis=np.concatenate(((1-r)[:,None]*curve,r[:,None]*curve),axis=1)
            residual=source(xy,field,frame)-basis@p[:,2];local=basis.T@(ww*residual);area+=float(ww.sum())
            if patch['kind']=='triangle-strip':largest=max(largest,float(np.abs(local).max()))
            else:np.add.at(load,ids,local);np.add.at(diagonal,ids,np.sum(ww[:,None]*basis*basis,axis=0))
    if model['patches'][0]['kind']=='quadratic-ruled':
        active=diagonal>ratio*diagonal.max();largest=float(np.abs(load[active]).max());held=np.where(~active)[0]
        if not np.array_equal(points[held,2],old[held,2]):raise ValueError('Weak-support constraints changed original Z')
        counts={'active_controls':int(active.sum()),'weak_positive_support_controls':int(((diagonal>0)&~active).sum())}
    else:counts={'independent_planes':len(model['patches'])}
    if not math.isfinite(largest) or largest>1e-8:raise ValueError('Saved-function projection orthogonality failed')
    return {'integrated_area_m2':area,'largest_saved_orthogonality_residual_m3':largest,'quadrature_nodes':5,**counts}
