"""Exact source-cell loads for shared-node C0 ruled / two-diagonal P1 fitting."""
import math
import numpy as np
from diagonal_hybrid_math import make_model
from source_band_benchmark import binary

def mass_matrix(family,dx,dy):
    if family=='ruled':return dx*dy/36*np.array([[4,2,2,1],[2,4,1,2],[2,1,4,2],[1,2,2,4]],dtype=float)
    if family=='minus':return dx*dy/24*np.array([[2,1,1,0],[1,4,2,1],[1,2,4,1],[0,1,1,2]],dtype=float)
    if family=='plus':return dx*dy/24*np.array([[4,1,1,2],[1,2,0,1],[1,0,2,1],[2,1,1,4]],dtype=float)
    raise ValueError('Unknown fixed native family')
def clip_side(polygon,line,sign):
    out=[]
    for k,b in enumerate(polygon):
        a=polygon[k-1];fa=sign*line(a);fb=sign*line(b)
        if (fa>=0)!=(fb>=0):out.append(a+(b-a)*(fa/(fa-fb)))
        if fb>=0:out.append(b)
    return out
def triangle_quadrature(p):
    t,w=np.polynomial.legendre.leggauss(3);t=(t+1)/2;w=w/2;u,v=np.meshgrid(t,t,indexing='ij');wu,wv=np.meshgrid(w,w,indexing='ij');b=u.ravel();c=((1-u)*v).ravel();a=1-b-c;det=abs(float(np.linalg.det(np.column_stack((p[1]-p[0],p[2]-p[0])))))
    return a[:,None]*p[0]+b[:,None]*p[1]+c[:,None]*p[2],(wu*wv*(1-u)).ravel()*det
def coarse_basis(family,x,y,dx,dy,side):
    u=x/dx;v=y/dy;zero=np.zeros_like(u)
    if family=='minus':return np.column_stack((1-u-v,u,v,zero)) if side==1 else np.column_stack((zero,1-v,1-u,u+v-1))
    return np.column_stack((1-u,u-v,zero,v)) if side==1 else np.column_stack((1-v,zero,v-u,u))
def cross_weights(family,dx,dy):
    if dx not in [1,2,4,8,16,32,64] or dy not in [1,2,4,8,16,32,64]:raise ValueError('Fixed dyadic source-cell sizes required')
    if family=='ruled':
        def axis(n):
            result=np.zeros((2,n+1))
            for k in range(n):
                a=np.array([1-k/n,k/n]);b=np.array([1-(k+1)/n,(k+1)/n]);result[:,k]+=(2*a+b)/6;result[:,k+1]+=(a+2*b)/6
            return result
        x=axis(dx);y=axis(dy);return np.array([np.outer(y[j],x[i]).ravel() for j,i in [(0,0),(0,1),(1,0),(1,1)]])
    if family not in ['minus','plus']:raise ValueError('Known source-cell family required')
    result=np.zeros((4,(dx+1)*(dy+1)));line=(lambda p:1-p[0]/dx-p[1]/dy) if family=='minus' else (lambda p:p[0]/dx-p[1]/dy)
    for j in range(dy):
        for i in range(dx):
            polygon=[np.array([i,j],dtype=float),np.array([i+1,j],dtype=float),np.array([i+1,j+1],dtype=float),np.array([i,j+1],dtype=float)];ids=[j*(dx+1)+i,j*(dx+1)+i+1,(j+1)*(dx+1)+i,(j+1)*(dx+1)+i+1]
            for side in [1,-1]:
                clipped=clip_side(polygon,line,side)
                for k in range(1,len(clipped)-1):
                    xy,w=triangle_quadrature(np.array([clipped[0],clipped[k],clipped[k+1]]));u=xy[:,0]-i;v=xy[:,1]-j;source=np.column_stack(((1-u)*(1-v),u*(1-v),(1-u)*v,u*v));coarse=coarse_basis(family,xy[:,0],xy[:,1],dx,dy,side);result[:,ids]+=coarse.T@(w[:,None]*source)
    return result
def fit(reference,nx,ny,families,cache,tolerance=1e-12,maximum_iterations=4096):
    axes=[1,2,4,8,16,32,64]
    if type(nx) is not int or type(ny) is not int or nx not in axes or ny not in axes or len(families)!=nx*ny or any(f not in ['ruled','minus','plus'] for f in families):raise ValueError('Complete fixed dyadic grid and known cell families required')
    if not math.isfinite(tolerance) or tolerance<=0 or type(maximum_iterations) is not int or maximum_iterations<=0:raise ValueError('Positive finite solver tolerance and iteration cap required')
    original=make_model(reference,nx,ny,families);points=np.asarray(original['points']);z=np.asarray(reference['height']);dx,dy=64//nx,64//ny;ids=[];matrices=[];load=np.zeros(len(points))
    if z.shape!=(65,65) or not np.isfinite(z).all():raise ValueError('Original finite fixed source reference required')
    for j in range(ny):
        for i in range(nx):
            family=families[j*nx+i];key=(family,dx,dy)
            if key not in cache:cache[key]=cross_weights(*key)
            index=[j*(nx+1)+i,j*(nx+1)+i+1,(j+1)*(nx+1)+i,(j+1)*(nx+1)+i+1];matrix=mass_matrix(family,dx,dy);rhs=cache[key]@z[j*dy:(j+1)*dy+1,i*dx:(i+1)*dx+1].ravel();np.add.at(load,index,rhs-matrix@points[index,2]);ids.append(index);matrices.append(matrix)
    ids=np.asarray(ids);matrices=np.asarray(matrices);diagonal=np.zeros(len(points));np.add.at(diagonal,ids.ravel(),np.diagonal(matrices,axis1=1,axis2=2).ravel())
    def multiply(x):
        out=np.zeros(len(points));np.add.at(out,ids.ravel(),np.einsum('nij,nj->ni',matrices,x[ids]).ravel());return out
    exact_identity=nx==ny==64 and (all(f=='ruled' for f in families) or not np.any(z[:-1,:-1]-z[:-1,1:]-z[1:,:-1]+z[1:,1:]))
    if exact_identity:return original,{'status':'exact_source_space_identity','iterations':0,'relative_galerkin_residual':0.,'same_native_bytes':len(binary(original))}
    delta=np.zeros(len(points));residual=load.copy();preconditioned=residual/diagonal;direction=preconditioned.copy();product=float(residual@preconditioned);initial=float(np.linalg.norm(load));iterations=0
    if initial:
        for iterations in range(1,maximum_iterations+1):
            applied=multiply(direction);denominator=float(direction@applied)
            if denominator<=0 or not math.isfinite(denominator):raise ValueError('Positive source mass operator required')
            alpha=product/denominator;delta+=alpha*direction;residual-=alpha*applied
            if float(np.linalg.norm(residual))<=tolerance*initial:break
            preconditioned=residual/diagonal;updated=float(residual@preconditioned);direction=preconditioned+updated/product*direction;product=updated
        else:raise ValueError('Shared-source fitting iteration cap reached')
    true=load-multiply(delta);relative=float(np.linalg.norm(true))/initial if initial else 0.
    if relative>1e-11:raise ValueError('Recomputed shared-source residual exceeds declared tolerance')
    saved=points.copy();saved[:,2]+=delta
    if not np.isfinite(saved).all() or np.abs(saved).max()>10000:raise ValueError('Fitted source coefficients violate unchanged native capacity')
    model={**original,'points':saved.tolist()}
    if len(binary(model))!=len(binary(original)):raise ValueError('Fitting changed complete native cost')
    return model,{'status':'projected','iterations':iterations,'relative_galerkin_residual':relative,'same_native_bytes':len(binary(model))}
