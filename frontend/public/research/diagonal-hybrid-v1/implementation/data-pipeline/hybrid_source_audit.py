"""Independent saved-function integrals and diagonal extrema for real mixtures."""
from functools import lru_cache
import math
import numpy as np
def cut(polygon,dx,dy,constant,lower):
    result=[];sign=-1 if lower else 1
    for i,b in enumerate(polygon):
        a=polygon[i-1];va=dy*a[0]+dx*a[1]-constant;vb=dy*b[0]+dx*b[1]-constant
        ai=sign*va>=0;bi=sign*vb>=0
        if ai!=bi:result.append(a+va/(va-vb)*(b-a))
        if bi:result.append(b)
    return result
@lru_cache(maxsize=10000)
def cut_quadrature(dx,dy,constant,nodes=5):
    t,w=np.polynomial.legendre.leggauss(nodes);t=(t+1)/2;w=w/2;s,r=np.meshgrid(t,t,indexing='ij');ws,wr=np.meshgrid(w,w,indexing='ij');b=s.ravel();c=((1-s)*r).ravel();a=1-b-c;tw=(ws*wr*(1-s)).ravel()
    square=[np.array(p,float) for p in [(0,0),(1,0),(1,1),(0,1)]];parts=[];ends=[]
    for lower in (True,False):
        poly=cut(square,dx,dy,constant,lower);coords=[];weights=[]
        for i in range(1,len(poly)-1):
            pa,pb,pc=poly[0],poly[i],poly[i+1];det=abs(float(np.linalg.det(np.column_stack((pb-pa,pc-pa)))));coords.extend(a[:,None]*pa+b[:,None]*pb+c[:,None]*pc);weights.extend(tw*det)
        parts.append((np.array(coords),np.array(weights)))
        if lower:
            for p in poly:
                if abs(dy*p[0]+dx*p[1]-constant)<1e-10 and not any(np.linalg.norm(p-q)<1e-10 for q in ends):ends.append(p)
    if abs(sum(np.sum(w) for _,w in parts)-1)>1e-10:raise ValueError('Independent clipped source-cell area differs')
    if len(ends)<2:raise ValueError('Crossing diagonal has no segment')
    pa,pb=max(((a,b) for a in ends for b in ends),key=lambda e:np.linalg.norm(e[0]-e[1]));return parts,np.array([pa,(pa+pb)/2,pb])
def interpolate(corners,u,v,kind,lower=None):
    a,b,c,d=[np.asarray(x)[...,None] for x in corners]
    if kind=='ruled':return (1-u)*(1-v)*a+u*(1-v)*b+(1-u)*v*c+u*v*d
    if lower:return (1-u-v)*a+u*b+v*c
    return (u+v-1)*d+(1-u)*c+(1-v)*b
def audit(reference,model,nx,ny,families):
    # Values come from the saved model, independently of source corner samples.
    p=np.asarray(model['points']);z=p[:,2].reshape(ny+1,nx+1);source=np.asarray(reference['height']);dx,dy=64//nx,64//ny;ix,iy=np.meshgrid(np.arange(64),np.arange(64));ci,cj=ix//dx,iy//dy;u0=(ix%dx)/dx;v0=(iy%dy)/dy
    corners=[z[cj,ci],z[cj,ci+1],z[cj+1,ci],z[cj+1,ci+1]];original=[source[:-1,:-1],source[:-1,1:],source[1:,:-1],source[1:,1:]];is_p1=np.array(families).reshape(ny,nx)[cj,ci]=='p1'
    t,w=np.polynomial.legendre.leggauss(5);t=(t+1)/2;w=w/2;s,r=np.meshgrid(t,t,indexing='ij');ws,wr=np.meshgrid(w,w,indexing='ij');sx=s.ravel();sy=r.ravel();weights=(ws*wr).ravel();u=u0[...,None]+sx/dx;v=v0[...,None]+sy/dy
    expected=interpolate(original,sx,sy,'ruled');rr=interpolate(corners,u,v,'ruled');low=interpolate(corners,u,v,'p1',True);high=interpolate(corners,u,v,'p1',False);lower=u0+v0+.5/dx+.5/dy<=1;native=np.where(is_p1[...,None],np.where(lower[...,None],low,high),rr)
    squared=np.sum((native-expected)**2*weights,axis=-1)
    xx,yy=np.meshgrid(np.arange(65),np.arange(65));ni=np.minimum(nx-1,np.maximum(0,np.ceil(xx/dx).astype(int)-1));nj=np.minimum(ny-1,np.maximum(0,np.ceil(yy/dy).astype(int)-1));nu=(xx-ni*dx)/dx;nv=(yy-nj*dy)/dy;nodal=[z[nj,ni],z[nj,ni+1],z[nj+1,ni],z[nj+1,ni+1]];nf=np.array(families).reshape(ny,nx)[nj,ni]=='p1';rz=interpolate(nodal,nu[...,None],nv[...,None],'ruled')[...,0];lz=interpolate(nodal,nu[...,None],nv[...,None],'p1',True)[...,0];hz=interpolate(nodal,nu[...,None],nv[...,None],'p1',False)[...,0];nodez=np.where(nf,np.where(nu+nv<=1,lz,hz),rz);errors=abs(nodez-source);j,i=np.unravel_index(np.argmax(errors),errors.shape);maximum=float(errors[j,i]);witness=[int(i)-32,int(j)-32]
    cross=is_p1&(u0+v0<1)&(u0+v0+1/dx+1/dy>1);constants=dx*dy-dy*(ix%dx)-dx*(iy%dy)
    for constant in np.unique(constants[cross]):
        j,i=np.where(cross&(constants==constant));parts,ends=cut_quadrature(dx,dy,int(constant));cn=[c[j,i] for c in corners];sn=[c[j,i] for c in original];sums=np.zeros(len(i))
        for lower,(xy,wq) in zip((True,False),parts):
            u=u0[j,i,None]+xy[:,0]/dx;v=v0[j,i,None]+xy[:,1]/dy;gap=interpolate(cn,u,v,'p1',lower)-interpolate(sn,xy[:,0],xy[:,1],'ruled');sums+=np.sum(gap**2*wq,axis=1)
        squared[j,i]=sums
        gap=interpolate(sn,ends[:,0],ends[:,1],'ruled')-interpolate(cn,u0[j,i,None]+ends[:,0]/dx,v0[j,i,None]+ends[:,1]/dy,'p1',True);e0,em,e1=gap.T;alpha=2*(e1-2*em+e0);beta=e1-e0-alpha;roots=np.divide(-beta,2*alpha,out=np.zeros_like(beta),where=abs(alpha)>1e-15);valid=(abs(alpha)>1e-15)&(roots>0)&(roots<1)
        for k,troot in enumerate(roots):
            candidates=[(abs(float(e0[k])),ends[0]),(abs(float(e1[k])),ends[2])]
            if valid[k]:
                point=ends[0]+troot*(ends[2]-ends[0]);s0=[np.array([c[k]]) for c in sn];c0=[np.array([c[k]]) for c in cn];value=interpolate(s0,np.array([point[0]]),np.array([point[1]]),'ruled')-interpolate(c0,np.array([u0[j[k],i[k]]+point[0]/dx]),np.array([v0[j[k],i[k]]+point[1]/dy]),'p1',True);candidates.append((abs(float(value[0,0])),point))
            error,point=max(candidates,key=lambda p:p[0])
            if error>maximum:maximum=error;witness=[float(i[k]+point[0]-32),float(j[k]+point[1]-32)]
    cells=np.sum(squared.reshape(ny,dy,nx,dx),axis=(1,3))
    return {'e2_m2':math.sqrt(math.fsum(map(float,squared.ravel()))),'continuous_maximum_m':maximum,'maximum_witness_xy':witness,'integrated_area_m2':4096,'cell_l2_squared':list(map(float,cells.ravel()))}
