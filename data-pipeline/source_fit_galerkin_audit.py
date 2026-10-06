"""Independent GL5 local source loads and numeric mass operators; no fitting imports."""
import numpy as np
from hybrid_source_audit import cut_quadrature

def basis(family,u,v,lower=None):
    if family=='ruled':return np.column_stack(((1-u)*(1-v),u*(1-v),(1-u)*v,u*v))
    zero=np.zeros_like(u)
    if family=='minus':return np.column_stack((1-u-v,u,v,zero)) if lower else np.column_stack((zero,1-v,1-u,u+v-1))
    return np.column_stack((1-u,u-v,zero,v)) if lower else np.column_stack((1-v,zero,v-u,u))

def matrices(family,dx,dy):
    t,w=np.polynomial.legendre.leggauss(5);t=(t+1)/2;w=w/2;s,r=np.meshgrid(t,t,indexing='ij');ws,wr=np.meshgrid(w,w,indexing='ij');square_xy=np.column_stack((s.ravel(),r.ravel()));square_weights=(ws*wr).ravel();cross=np.zeros((4,(dx+1)*(dy+1)));mass=np.zeros((4,4))
    for j in range(dy):
        for i in range(dx):
            # Mirror the plus coarse diagonal to x+y=1 to use independent cuts.
            mirrored_i=dx-1-i if family=='plus' else i;constant=dx*dy-dy*mirrored_i-dx*j
            if family!='ruled' and 0<constant<dx+dy:parts,_=cut_quadrature(dx,dy,constant)
            else:parts=[(square_xy,square_weights)]
            for part,(xy,weight) in enumerate(parts):
                local_x=1-xy[:,0] if family=='plus' else xy[:,0];u=(i+local_x)/dx;v=(j+xy[:,1])/dy
                lower=part==0 if len(parts)==2 else (u[0]+v[0]<1 if family=='minus' else u[0]>=v[0]);coarse=basis(family,u,v,lower);source=basis('ruled',local_x,xy[:,1]);indices=[j*(dx+1)+i,j*(dx+1)+i+1,(j+1)*(dx+1)+i,(j+1)*(dx+1)+i+1]
                cross[:,indices]+=coarse.T@(weight[:,None]*source);mass+=coarse.T@(weight[:,None]*coarse)
    return mass,cross

def audit(reference,original,saved,nx,ny,families,cache):
    source=np.asarray(reference['height']);z0=np.asarray(original['points'])[:,2];z1=np.asarray(saved['points'])[:,2];rhs=np.zeros(len(z0));applied=np.zeros(len(z0));initial=np.zeros(len(z0));dx,dy=64//nx,64//ny;source_load=np.zeros(len(z0))
    for j in range(ny):
        for i in range(nx):
            key=(families[j*nx+i],dx,dy)
            if key not in cache:cache[key]=matrices(*key)
            mass,cross=cache[key];indices=[j*(nx+1)+i,j*(nx+1)+i+1,(j+1)*(nx+1)+i,(j+1)*(nx+1)+i+1];b=cross@source[j*dy:(j+1)*dy+1,i*dx:(i+1)*dx+1].ravel();np.add.at(rhs,indices,b-mass@z0[indices]);np.add.at(applied,indices,mass@(z1[indices]-z0[indices]));np.add.at(source_load,indices,b)
    norm=float(np.linalg.norm(rhs-applied));initial=float(np.linalg.norm(rhs));roundoff=1e-10*max(1,float(np.linalg.norm(source_load)));bound=max(5e-10*initial,roundoff)
    if norm>bound:raise ValueError('Independent numeric GL5 Galerkin equation failed')
    return {'galerkin_residual_norm':norm,'initial_correction_norm':initial,'source_load_norm':float(np.linalg.norm(source_load)),'declared_roundoff_bound':bound,'relative_to_initial':norm/initial if initial else None}
