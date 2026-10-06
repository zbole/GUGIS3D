"""Saved fixed-space errors: analytic rectangle masses, clipped GL3 and extrema."""
import math
import numpy as np
from functools import lru_cache

def heights(z,u,v,mode):
    a,b,c,d=[np.asarray(p)[...,None] for p in z]
    if mode=='ruled':return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v
    if mode=='lower':return a+(b-a)*u+(c-a)*v
    return d+(c-d)*(1-u)+(b-d)*(1-v)

def square_mass(r):
    a,b,c,d=r
    return (a*a+b*b+c*c+d*d+a*b+a*c+b*d+c*d)/9+(a*d+b*c)/18

@lru_cache(maxsize=10000)
def cut_rule(dx,dy,constant):
    line=lambda p:dy*p[0]+dx*p[1]-constant
    square=[np.array(p,dtype=float) for p in [(0,0),(1,0),(1,1),(0,1)]]
    t,w=np.polynomial.legendre.leggauss(3);t=(t+1)/2;w=w/2
    u,v=np.meshgrid(t,t,indexing='ij');wu,wv=np.meshgrid(w,w,indexing='ij')
    q=u.ravel();r=((1-u)*v).ravel();s=1-q-r;weights=(wu*wv*(1-u)).ravel();parts=[];ends=[]
    for sign in [-1,1]:
        polygon=[]
        for k,b in enumerate(square):
            a=square[k-1];fa=sign*line(a);fb=sign*line(b)
            if (fa>=0)!=(fb>=0):polygon.append(a+(b-a)*fa/(fa-fb))
            if fb>=0:polygon.append(b)
        coords=[];ws=[]
        for k in range(1,len(polygon)-1):
            a,b,c=polygon[0],polygon[k],polygon[k+1];det=abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))
            coords.extend(s[:,None]*a+q[:,None]*b+r[:,None]*c);ws.extend(weights*det)
        parts.append((np.array(coords),np.array(ws)))
        for point in polygon:
            if abs(line(point))<1e-10 and not any(np.linalg.norm(point-p)<1e-10 for p in ends):ends.append(point)
    if abs(sum(float(w.sum()) for _,w in parts)-1)>1e-10 or len(ends)!=2:raise ValueError('Complete source-cell cut required')
    return parts,np.array(ends)

def measure(reference,model,nx,ny,families):
    source=np.asarray(reference['height']);z=np.asarray(model['points'])[:,2].reshape(ny+1,nx+1);dx,dy=64//nx,64//ny
    x,y=np.meshgrid(np.arange(64),np.arange(64));i,j=x//dx,y//dy;family=np.asarray(families).reshape(ny,nx)[j,i];mirror=family=='plus';triangle=family!='ruled'
    local_x=np.where(mirror,dx-1-x%dx,x%dx);u0,v0=local_x/dx,(y%dy)/dy
    original=[source[:-1,:-1],source[:-1,1:],source[1:,:-1],source[1:,1:]];corners=[z[j,i],z[j,i+1],z[j+1,i],z[j+1,i+1]]
    original=[np.where(mirror,original[k],original[n]) for n,k in enumerate([1,0,3,2])];corners=[np.where(mirror,corners[k],corners[n]) for n,k in enumerate([1,0,3,2])]
    sx=np.array([0,1,0,1]);sy=np.array([0,0,1,1]);u=u0[...,None]+sx/dx;v=v0[...,None]+sy/dy
    expected=heights(original,sx,sy,'ruled');low=heights(corners,u,v,'lower');high=heights(corners,u,v,'upper');r=heights(corners,u,v,'ruled')-expected
    below=u0+v0+.5/dx+.5/dy<=1;gap=np.where(triangle[...,None],np.where(below[...,None],low,high)-expected,r);squared=square_mass([gap[...,k] for k in range(4)])
    # Axis-aligned edges are linear. Bilinear differences have no strict interior extrema;
    # only a triangle diagonal introduces a possible quadratic extremum.
    node_x,node_y=np.meshgrid(np.arange(65),np.arange(65));ci=np.minimum(nx-1,np.maximum(0,np.ceil(node_x/dx).astype(int)-1));cj=np.minimum(ny-1,np.maximum(0,np.ceil(node_y/dy).astype(int)-1));nf=np.asarray(families).reshape(ny,nx)[cj,ci]
    u=(node_x-ci*dx)/dx;v=(node_y-cj*dy)/dy;plus=nf=='plus';u=np.where(plus,1-u,u);cn=[z[cj,ci],z[cj,ci+1],z[cj+1,ci],z[cj+1,ci+1]];cn=[np.where(plus,cn[k],cn[n]) for n,k in enumerate([1,0,3,2])]
    values=np.where((nf=='ruled')[...,None],heights(cn,u[...,None],v[...,None],'ruled'),np.where((u+v<=1)[...,None],heights(cn,u[...,None],v[...,None],'lower'),heights(cn,u[...,None],v[...,None],'upper')))[...,0]
    node_errors=np.abs(values-source);ny0,nx0=np.unravel_index(np.argmax(node_errors),node_errors.shape);maximum=float(node_errors[ny0,nx0]);witness=[int(nx0)-32,int(ny0)-32]
    crossing=triangle&(u0+v0<1)&(u0+v0+1/dx+1/dy>1);constants=dx*dy-dy*local_x-dx*(y%dy)
    for constant in np.unique(constants[crossing]):
        jj,ii=np.where(crossing&(constants==constant));parts,ends=cut_rule(dx,dy,int(constant));cn=[c[jj,ii] for c in corners];sn=[s[jj,ii] for s in original];sums=np.zeros(len(ii))
        for mode,(xy,wq) in zip(['lower','upper'],parts):
            gap=heights(cn,u0[jj,ii,None]+xy[:,0]/dx,v0[jj,ii,None]+xy[:,1]/dy,mode)-heights(sn,xy[:,0],xy[:,1],'ruled');sums+=np.sum(gap*gap*wq,axis=1)
        squared[jj,ii]=sums
        xy=np.array([ends[0],(ends[0]+ends[1])/2,ends[1]]);gap=heights(cn,u0[jj,ii,None]+xy[:,0]/dx,v0[jj,ii,None]+xy[:,1]/dy,'lower')-heights(sn,xy[:,0],xy[:,1],'ruled');a=2*(gap[:,2]-2*gap[:,1]+gap[:,0]);b=gap[:,2]-gap[:,0]-a
        roots=np.divide(-b,2*a,out=np.zeros_like(b),where=abs(a)>1e-15)
        for k,root in enumerate(roots):
            for t in [0.,1.]+([float(root)] if abs(a[k])>1e-15 and 0<root<1 else []):
                point=ends[0]+t*(ends[1]-ends[0]);err=abs(float(a[k]*t*t+b[k]*t+gap[k,0]))
                if err>maximum:maximum=err;witness=[float(ii[k]+(1-point[0] if mirror[jj[k],ii[k]] else point[0])-32),float(jj[k]+point[1]-32)]
    if squared.min()<-1e-10:raise ValueError('Negative source error energy')
    return {'e2_m2':math.sqrt(math.fsum(map(float,np.maximum(0,squared).ravel()))),'continuous_maximum_m':maximum,'maximum_witness_xy':witness,'integrated_area_m2':4096}
