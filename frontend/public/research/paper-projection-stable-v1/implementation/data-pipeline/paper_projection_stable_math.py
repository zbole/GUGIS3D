"""Rank-aware shared-control L2 fitting with a native and backward-error gate."""
import math
import numpy as np
from paper_projection_math import quadrature
import principal_ruled_benchmark as geometry

def project_c0_ruled(model,source,nodes=7,tolerance=1e-12,maximum_iterations=4096,support_floor_ratio=1e-14):
    points=np.asarray(model['points'],dtype=float);indices=[];matrices=[];rhs=np.zeros(len(points));area=0.;probes=[]
    for patch in model['patches']:
        if patch['kind']!='quadratic-ruled':raise ValueError('Quadratic ruled grid required')
        ids=patch['left']+patch['right'];left=points[patch['left']];right=points[patch['right']];pa,pb,pc=left[0,:2],left[2,:2],right[0,:2];inverse=np.linalg.inv(np.column_stack((pb-pa,pc-pa)))
        polygon=geometry.clip_rectangle([left[0,:2],left[2,:2],right[2,:2],right[0,:2]],*model['clip_bounds'][::2],*model['clip_bounds'][1::2]);local=np.zeros((6,6));load=np.zeros(6)
        for k in range(1,len(polygon)-1):
            triangle=np.asarray([polygon[0],polygon[k],polygon[k+1]])
            if float(np.linalg.det(np.column_stack((triangle[1]-triangle[0],triangle[2]-triangle[0]))))==0:continue
            xy,w,_=quadrature(triangle,nodes);uv=(xy-pa)@inverse.T;s,r=uv[:,0],uv[:,1];curve=np.column_stack(((1-s)**2,2*s*(1-s),s*s));basis=np.column_stack(((1-r)[:,None]*curve,r[:,None]*curve));values=np.asarray(source(xy));probes.append((ids,w,basis,values))
            local+=basis.T@(w[:,None]*basis);load+=basis.T@(w*(values-basis@points[ids,2]));area+=float(w.sum())
        indices.append(ids);matrices.append(local);np.add.at(rhs,ids,load)
    ids=np.asarray(indices);mass=np.asarray(matrices);diagonal=np.zeros(len(points));np.add.at(diagonal,ids.ravel(),np.diagonal(mass,axis1=1,axis2=2).ravel());floor=support_floor_ratio*float(diagonal.max());active=diagonal>floor
    if not active.any():raise ValueError('No supported projection control')
    inverse_diagonal=np.zeros(len(points));inverse_diagonal[active]=1/diagonal[active];restricted_rhs=np.where(active,rhs,0.)
    def multiply(x):
        result=np.zeros(len(points));np.add.at(result,ids.ravel(),np.einsum('nij,nj->ni',mass,x[ids]).ravel());return result
    def energy(z):return math.fsum(float(np.dot(w,(basis@z[index]-values)**2)) for index,w,basis,values in probes)
    baseline=energy(points[:,2]);delta=np.zeros(len(points));residual=restricted_rhs.copy();preconditioned=inverse_diagonal*residual;direction=preconditioned.copy();product=float(residual@preconditioned);initial=float(np.linalg.norm(restricted_rhs));iterations=0;reason=None
    if initial:
        for iterations in range(1,maximum_iterations+1):
            applied=multiply(direction);applied[~active]=0.;denominator=float(direction@applied)
            if denominator<=0 or not math.isfinite(denominator):reason='restricted mass operator lost positivity';break
            alpha=product/denominator;delta+=alpha*direction;residual-=alpha*applied
            if float(np.linalg.norm(residual))<=tolerance*initial:break
            preconditioned=inverse_diagonal*residual;updated=float(residual@preconditioned);direction=preconditioned+(updated/product)*direction;product=updated
        else:reason='fixed iteration limit reached'
    true_residual=restricted_rhs-np.where(active,multiply(delta),0.);relative=float(np.linalg.norm(true_residual))/initial if initial else 0.;saved=points.copy();saved[:,2]+=delta
    if reason is None:
        if not np.isfinite(saved).all() or np.abs(saved).max()>10000:reason='saved native coefficients violate unchanged GPR3 capacity'
        elif relative>10*tolerance:reason='recomputed restricted Galerkin residual exceeds tolerance'
    candidate=energy(saved[:,2]) if reason is None else None
    guard=1e-10*max(1,baseline)
    if candidate is not None and candidate>baseline+guard:reason='saved Float64 energy is worse than original within declared guard'
    accepted=reason is None
    result={**model,'points':saved.tolist(),'patches':model['patches']} if accepted else model
    return result,{'accepted':accepted,'fallback_reason':reason,'iterations':iterations,'relative_restricted_galerkin_residual':relative,'largest_restricted_orthogonality_residual':float(np.max(np.abs(true_residual))),'integrated_area_m2':area,'active_controls':int(active.sum()),'weak_controls_held_at_original_z':int(((diagonal>0)&~active).sum()),'inactive_controls_held_at_original_z':int((diagonal==0).sum()),'discarded_load_norm':float(np.linalg.norm(rhs[~active])),'mass_diagonal_support_floor_m2':floor,'support_floor_ratio':support_floor_ratio,'original_l2_squared':baseline,'candidate_l2_squared':candidate,'saved_energy_guard':guard,'stored_points':len(points),'tolerance':tolerance}
