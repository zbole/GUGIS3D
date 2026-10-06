"""Paper §2.4: PT local-L2 region priority, IT child-L1 edge decision (2.18)."""
import heapq,math
import numpy as np
from paper_metric_benchmark import bisect,quartic_value
from principal_ruled_benchmark import model as native_model

def quadrature(nodes):
    t,w=np.polynomial.legendre.leggauss(nodes);t=(t+1)/2;w=w/2
    u,v=np.meshgrid(t,t,indexing='ij');wu,wv=np.meshgrid(w,w,indexing='ij')
    b=u.ravel();c=((1-u)*v).ravel()
    return np.column_stack((1-b-c,b,c)),(wu*wv*(1-u)).ravel()
BARY,WEIGHTS=quadrature(7)

def local(triangle,field,frame):
    p=np.asarray(triangle,dtype=float);frame=np.asarray(frame,dtype=float)
    if p.shape!=(3,2) or frame.shape!=(2,2) or not np.isfinite(p).all() or not np.isfinite(frame).all():raise ValueError('Finite triangle and source frame required')
    determinant=abs(float(np.linalg.det(np.column_stack((p[1]-p[0],p[2]-p[0])))))
    if determinant<=0:raise ValueError('Nondegenerate physical triangle required')
    z=quartic_value(p@frame,field);xy=BARY@p;source=quartic_value(xy@frame,field);w=WEIGHTS*determinant;area=determinant/2
    residual=source-BARY@z;load=BARY.T@(w*residual);saved=z+(12/area)*(load-load.sum()/4)
    delta=source-BARY@saved;orthogonality=float(np.abs(BARY.T@(w*delta)).max());e2_squared=float(w@(delta*delta));it_l1=float(w@(-residual))
    if not np.isfinite(saved).all() or np.abs(saved).max()>10000 or not math.isfinite(e2_squared) or it_l1<-1e-10*max(1,area):raise ValueError('Invalid saved projection / strictly convex interpolation residual')
    return {'z':saved,'area':area,'l2_squared':e2_squared,'it_l1':max(0.,it_l1),'orthogonality':orthogonality}

def encoded_model(entries):
    pool={};points=[];patches=[]
    for triangle,metric in entries:
        ids=[]
        for xy,z in zip(triangle,metric['z']):
            key=tuple([*map(float,xy),float(z)])
            if key not in pool:pool[key]=len(points);points.append(list(key))
            ids.append(pool[key])
        patches.append({'kind':'triangle-strip','indices':ids})
    return native_model(points,patches)

def meshes(field,frame,budgets):
    if not budgets or list(budgets)!=sorted(set(budgets)) or any(type(n) is not int or n<2 or n>2048 for n in budgets):raise ValueError('Increasing native triangle budgets 2..2048 required')
    heap=[];entries={};cache={};next_id=0;snapshots=[];trace=[]
    def metric(p):
        key=p.tobytes()
        if key not in cache:cache[key]=local(p,field,frame)
        return cache[key]
    def insert(p):
        nonlocal next_id
        m=metric(p);entries[next_id]=(p,m);heapq.heappush(heap,(-m['l2_squared'],next_id));next_id+=1
    insert(np.array([[-50.,-50.],[50.,-50.],[50.,50.]]))
    insert(np.array([[-50.,-50.],[50.,50.],[-50.,50.]]))
    for n in budgets:
        while len(entries)<n:
            negative,key=heapq.heappop(heap);p,parent=entries.pop(key)
            costs=[math.fsum(metric(c)['it_l1'] for c in bisect(p,e)) for e in range(3)]
            edge=min(range(3),key=lambda e:(costs[e],e));children=bisect(p,edge)
            child_error=math.fsum(metric(c)['l2_squared'] for c in children)
            if child_error>parent['l2_squared']+1e-10*max(1,parent['l2_squared']):raise ValueError('PT nested spaces increased projected squared energy')
            trace.append({'triangle_count_before':len(entries)+1,'selected_id':key,'selected_l2_squared':parent['l2_squared'],'heap_priority':negative,'child_it_l1_costs':costs,'edge':edge,'child_ids':[next_id,next_id+1]})
            for child in children:insert(child)
        area=math.fsum(m['area'] for p,m in entries.values())
        if abs(area-10000)>1e-8:raise ValueError('Adaptive partition changed physical domain')
        snapshots.append({'budget':n,'model':encoded_model(entries.values()),'e2_m2':math.sqrt(math.fsum(m['l2_squared'] for p,m in entries.values())),'integrated_area_m2':area,'largest_orthogonality_residual_m3':max(m['orthogonality'] for p,m in entries.values()),'trace_length':len(trace)})
    return snapshots,trace
