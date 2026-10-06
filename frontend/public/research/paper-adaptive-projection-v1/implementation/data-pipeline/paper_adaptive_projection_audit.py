"""Five-node independent saved PT integrals and complete paper-greedy trace audit."""
import math
import numpy as np

def quadrature():
    q,w=np.polynomial.legendre.leggauss(5);q=(q+1)/2;w=w/2
    r,s=np.meshgrid(q,q,indexing='xy');wr,ws=np.meshgrid(w,w,indexing='xy');b=r.ravel();c=((1-r)*s).ravel()
    return np.stack((1-b-c,b,c),axis=1),(wr*ws*(1-r)).ravel()
BARY,WEIGHTS=quadrature()
def source(xy,field,frame):
    xy=np.asarray(xy);uv=xy@np.asarray(frame);return 30+field['quadratic'][0]*uv[:,0]**2+field['quadratic'][1]*uv[:,1]**2+field['quartic'][0]*uv[:,0]**4+field['quartic'][1]*uv[:,1]**4
def local(p,field,frame,z=None):
    p=np.asarray(p);det=abs(float((p[1,0]-p[0,0])*(p[2,1]-p[0,1])-(p[1,1]-p[0,1])*(p[2,0]-p[0,0])))
    if det<=0:raise ValueError('Physical nondegenerate triangle required')
    w=WEIGHTS*det;values=source(BARY@p,field,frame);corner=source(p,field,frame)
    if z is None:
        residual=values-BARY@corner;rhs=BARY.T@(w*residual);z=corner+np.linalg.solve((det/24)*(np.ones((3,3))+np.eye(3)),rhs)
    residual=values-BARY@z
    return {'l2_squared':float(w@(residual**2)),'it_l1':float(w@(BARY@corner-values)),'orthogonality':float(np.abs(BARY.T@(w*residual)).max()),'area':det/2}
def integral(model,field,frame):
    errors=[];areas=[];largest=0.
    for patch in model['patches']:
        if patch['kind']!='triangle-strip' or len(patch['indices'])!=3:raise ValueError('Independent saved PT planes required')
        p=np.asarray([model['points'][i] for i in patch['indices']]);v=local(p[:,:2],field,frame,p[:,2]);errors.append(v['l2_squared']);areas.append(v['area']);largest=max(largest,v['orthogonality'])
    if largest>1e-8:raise ValueError('Saved PT orthogonality failed')
    return {'e2_m2':math.sqrt(math.fsum(errors)),'integrated_area_m2':math.fsum(areas),'largest_orthogonality_residual_m3':largest,'quadrature_nodes':5}
def children(p,edge):
    i,j=[(0,1),(1,2),(2,0)][edge];k=3-i-j;mid=(p[i]+p[j])*.5
    return [np.array([p[k],p[i],mid]),np.array([p[k],mid,p[j]])]
def trace_audit(trace,field,frame,expected_maximum=2048):
    triangles={0:np.array([[-50.,-50.],[50.,-50.],[50.,50.]]),1:np.array([[-50.,-50.],[50.,50.],[-50.,50.]])};metrics={k:local(p,field,frame) for k,p in triangles.items()};largest_priority=largest_cost=0.;next_id=2;snapshots={}
    for row in trace:
        if row['triangle_count_before']!=len(triangles) or row['child_ids']!=[next_id,next_id+1]:raise ValueError('Refinement order/IDs changed')
        key=row['selected_id'];selected=metrics[key]['l2_squared'];maximum=max(m['l2_squared'] for m in metrics.values());difference=maximum-selected;largest_priority=max(largest_priority,difference)
        if difference>1e-8*max(1,maximum) or abs(row['selected_l2_squared']-selected)>1e-8*max(1,selected) or row['heap_priority']!=-row['selected_l2_squared']:raise ValueError('PT region priority differs')
        p=triangles.pop(key);metrics.pop(key);costs=[math.fsum(local(c,field,frame)['it_l1'] for c in children(p,e)) for e in range(3)]
        largest_cost=max(largest_cost,*[abs(a-b) for a,b in zip(costs,row['child_it_l1_costs'])]);edge=row['edge']
        if edge not in range(3) or costs[edge]-min(costs)>1e-8*max(1,max(costs)) or any(abs(a-b)>1e-8*max(1,abs(a)) for a,b in zip(costs,row['child_it_l1_costs'])):raise ValueError('IT child-L1 edge choice differs')
        for k,c in zip(row['child_ids'],children(p,edge)):triangles[k]=c;metrics[k]=local(c,field,frame)
        next_id+=2
        if len(triangles) in [8,16,32,64,128,256,512,1024,2048]:snapshots[len(triangles)]=[p.tolist() for p in triangles.values()]
    if len(triangles)!=expected_maximum or len(trace)!=expected_maximum-2:raise ValueError('Complete trace required')
    return {'refinements':len(trace),'largest_region_priority_difference_m4':largest_priority,'largest_IT_L1_cost_difference_m3':largest_cost,'independent_quadrature_nodes':5},snapshots
