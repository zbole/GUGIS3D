"""Independent saved-corner GL5 integrals for both triangle-diagonal orientations."""
import math
import numpy as np
from hybrid_source_audit import cut_quadrature,interpolate
def audit(reference,model,nx,ny,families):
    points=np.asarray(model['points']);z=points[:,2].reshape(ny+1,nx+1);source=np.asarray(reference['height']);dx,dy=64//nx,64//ny
    ix,iy=np.meshgrid(np.arange(64),np.arange(64));ci,cj=ix//dx,iy//dy;family=np.array(families).reshape(ny,nx)[cj,ci];plus=family=='plus';p1=family!='ruled';local_x=np.where(plus,dx-1-ix%dx,ix%dx);u0=local_x/dx;v0=(iy%dy)/dy
    corners=[z[cj,ci],z[cj,ci+1],z[cj+1,ci],z[cj+1,ci+1]];original=[source[:-1,:-1],source[:-1,1:],source[1:,:-1],source[1:,1:]]
    # Express positive-diagonal cells in their mirrored local coordinates;
    # integration remains over all actual saved/source unit cells with unit Jacobian.
    corners=[np.where(plus,corners[k],corners[j]) for j,k in enumerate([1,0,3,2])];original=[np.where(plus,original[k],original[j]) for j,k in enumerate([1,0,3,2])]
    t,w=np.polynomial.legendre.leggauss(5);t=(t+1)/2;w=w/2;s,r=np.meshgrid(t,t,indexing='ij');ws,wr=np.meshgrid(w,w,indexing='ij');sx,sy=s.ravel(),r.ravel();weights=(ws*wr).ravel();u=u0[...,None]+sx/dx;v=v0[...,None]+sy/dy
    expected=interpolate(original,sx,sy,'ruled');ruled=interpolate(corners,u,v,'ruled');lower=interpolate(corners,u,v,'p1',True);upper=interpolate(corners,u,v,'p1',False);below=u0+v0+.5/dx+.5/dy<=1;native=np.where(p1[...,None],np.where(below[...,None],lower,upper),ruled);squared=np.sum((native-expected)**2*weights,axis=-1)
    xx,yy=np.meshgrid(np.arange(65),np.arange(65));ni=np.minimum(nx-1,np.maximum(0,np.ceil(xx/dx).astype(int)-1));nj=np.minimum(ny-1,np.maximum(0,np.ceil(yy/dy).astype(int)-1));nf=np.array(families).reshape(ny,nx)[nj,ni];np1=nf!='ruled';npplus=nf=='plus';nu=(xx-ni*dx)/dx;nv=(yy-nj*dy)/dy;nu=np.where(npplus,1-nu,nu)
    nodal=[z[nj,ni],z[nj,ni+1],z[nj+1,ni],z[nj+1,ni+1]];nodal=[np.where(npplus,nodal[k],nodal[j]) for j,k in enumerate([1,0,3,2])]
    rz=interpolate(nodal,nu[...,None],nv[...,None],'ruled')[...,0];lz=interpolate(nodal,nu[...,None],nv[...,None],'p1',True)[...,0];hz=interpolate(nodal,nu[...,None],nv[...,None],'p1',False)[...,0];nodez=np.where(np1,np.where(nu+nv<=1,lz,hz),rz);errors=abs(nodez-source);j,i=np.unravel_index(np.argmax(errors),errors.shape);maximum=float(errors[j,i]);witness=[int(i)-32,int(j)-32]
    cross=p1&(u0+v0<1)&(u0+v0+1/dx+1/dy>1);constants=dx*dy-dy*local_x-dx*(iy%dy)
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
            if error>maximum:maximum=error;witness=[float(i[k]+(1-point[0] if plus[j[k],i[k]] else point[0])-32),float(j[k]+point[1]-32)]
    cells=np.sum(squared.reshape(ny,dy,nx,dx),axis=(1,3))
    return {'e2_m2':math.sqrt(math.fsum(map(float,squared.ravel()))),'continuous_maximum_m':maximum,'maximum_witness_xy':witness,'integrated_area_m2':4096,'cell_l2_squared':list(map(float,cells.ravel()))}
