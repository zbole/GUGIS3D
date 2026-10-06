"""L2 projection controls and C0 shared-control ruled fitting; no published outcomes."""
import math
import numpy as np
import principal_ruled_benchmark as geometry

def quadrature(vertices,nodes=7):
    t,w=np.polynomial.legendre.leggauss(nodes);t=(t+1)/2;w=w/2
    u,v=np.meshgrid(t,t,indexing='ij');wu,wv=np.meshgrid(w,w,indexing='ij')
    b=u.ravel();c=((1-u)*v).ravel();a=1-b-c
    bary=np.column_stack((a,b,c));p=np.asarray(vertices,dtype=float)
    determinant=abs(float(np.linalg.det(np.column_stack((p[1]-p[0],p[2]-p[0])))))
    if determinant<=0:raise ValueError('Nondegenerate triangle required')
    return bary@p,(wu*wv*(1-u)).ravel()*determinant,bary

def project_p1(model,source,nodes=7):
    """Paper-admissible P_T on the same saved mesh, with explicit discontinuous Z."""
    points=[];pool={};patches=[];orthogonality=0.;area=0.
    original=np.asarray(model['points'],dtype=float)
    for patch in model['patches']:
        if patch['kind']!='triangle-strip':raise ValueError('Saved P1 triangle strips required')
        for i in range(len(patch['indices'])-2):
            p=original[patch['indices'][i:i+3]];xy,w,bary=quadrature(p[:,:2],nodes);residual=np.asarray(source(xy))-bary@p[:,2];a=float(w.sum())
            rhs=bary.T@(w*residual);delta=(12/a)*(rhs-rhs.sum()/4);z=p[:,2]+delta
            orthogonality=max(orthogonality,float(np.max(np.abs(bary.T@(w*(bary@z-source(xy)))))))
            ids=[]
            for pos,height in zip(p[:,:2],z):
                value=tuple([*map(float,pos),float(height)])
                if value not in pool:pool[value]=len(points);points.append(list(value))
                ids.append(pool[value])
            patches.append({'kind':'triangle-strip','indices':ids});area+=a
    result=geometry.model(points,patches)
    return result,{'triangles':len(patches),'integrated_area_m2':area,'largest_orthogonality_residual':orthogonality,'stored_points':len(points)}

def project_c0_ruled(model,source,nodes=7,tolerance=1e-12,maximum_iterations=4096):
    """Matrix-free Galerkin projection of shared Bezier Z; retains exact XY/indices."""
    points=np.asarray(model['points'],dtype=float);indices=[];matrices=[];rhs=np.zeros(len(points));area=0.
    for patch in model['patches']:
        if patch['kind']!='quadratic-ruled':raise ValueError('Quadratic ruled grid required')
        ids=patch['left']+patch['right'];left=points[patch['left']];right=points[patch['right']];pa,pb,pc=left[0,:2],left[2,:2],right[0,:2];inverse=np.linalg.inv(np.column_stack((pb-pa,pc-pa)))
        polygon=geometry.clip_rectangle([left[0,:2],left[2,:2],right[2,:2],right[0,:2]],*model['clip_bounds'][::2],*model['clip_bounds'][1::2])
        local=np.zeros((6,6));load=np.zeros(6)
        for k in range(1,len(polygon)-1):
            triangle=np.asarray([polygon[0],polygon[k],polygon[k+1]])
            # Rectangle clipping can repeat a physical corner at exactly 45 degrees.
            # Such zero-area fan members contribute no integral; positive areas remain.
            if float(np.linalg.det(np.column_stack((triangle[1]-triangle[0],triangle[2]-triangle[0]))))==0:continue
            xy,w,_=quadrature(triangle,nodes);uv=(xy-pa)@inverse.T;s,r=uv[:,0],uv[:,1]
            curve=np.column_stack(((1-s)**2,2*s*(1-s),s*s));basis=np.column_stack(((1-r)[:,None]*curve,r[:,None]*curve))
            local+=basis.T@(w[:,None]*basis);load+=basis.T@(w*(source(xy)-basis@points[ids,2]));area+=float(w.sum())
        indices.append(ids);matrices.append(local);np.add.at(rhs,ids,load)
    ids=np.asarray(indices);mass=np.asarray(matrices);diagonal=np.zeros(len(points));np.add.at(diagonal,ids.ravel(),np.diagonal(mass,axis1=1,axis2=2).ravel());active=diagonal>0
    if np.any(np.abs(rhs[~active])>1e-15):raise ValueError('Unsupported control has nonzero load')
    inverse_diagonal=np.zeros(len(points));inverse_diagonal[active]=1/diagonal[active]
    def multiply(x):
        result=np.zeros(len(points));np.add.at(result,ids.ravel(),np.einsum('nij,nj->ni',mass,x[ids]).ravel());return result
    delta=np.zeros(len(points));residual=rhs.copy();preconditioned=inverse_diagonal*residual;direction=preconditioned.copy();product=float(residual@preconditioned);initial=float(np.linalg.norm(rhs));iterations=0
    if initial:
        for iterations in range(1,maximum_iterations+1):
            applied=multiply(direction);denominator=float(direction@applied)
            if denominator<=0 or not math.isfinite(denominator):raise ValueError('Projection mass operator lost positivity')
            alpha=product/denominator;delta+=alpha*direction;residual-=alpha*applied
            if float(np.linalg.norm(residual))<=tolerance*initial:break
            preconditioned=inverse_diagonal*residual;updated=float(residual@preconditioned);direction=preconditioned+(updated/product)*direction;product=updated
        else:raise ValueError('C0 projection did not converge within fixed iteration limit')
    saved=points.copy();saved[:,2]+=delta
    # Only stored Z coefficients change. Point IDs, XY, clip and shared curves persist.
    result={**model,'points':saved.tolist(),'patches':model['patches']}
    true_residual=rhs-multiply(delta);relative=float(np.linalg.norm(true_residual))/initial if initial else 0.
    if relative>10*tolerance:raise ValueError('Recomputed Galerkin residual exceeds declared tolerance')
    return result,{'iterations':iterations,'relative_galerkin_residual':relative,'largest_orthogonality_residual':float(np.max(np.abs(true_residual))),'integrated_area_m2':area,'active_controls':int(active.sum()),'stored_points':len(points),'tolerance':tolerance}
