"""Research-only conforming local bisection with an L1 interpolation decision.

Callbacks are trusted authored functions, never expressions from a data file.
Conformity closure and certified Linfinity selection differ from the paper's
unconstrained algorithm; no transfer of its asymptotic optimality theorem.
"""
import heapq
import math
import numpy as np
from ..environment_models import Terrain, TerrainPatch


def triangle_area(vertices):
    a, b, c = np.asarray(vertices, dtype=float)
    return float(abs(np.linalg.det(np.column_stack((b-a, c-a))))/2)


def l1_interpolation(vertices, height):
    """Positive seven-point degree-five triangle quadrature; not a bound."""
    xy = np.asarray(vertices, dtype=float)
    weights = [.225]+[.132394152788506]*3+[.125939180544827]*3
    bary = [[1/3]*3]
    for a, b in [(.059715871789770, .470142064105115),
                 (.797426985353087, .101286507323456)]:
        bary.extend([[a,b,b], [b,a,b], [b,b,a]])
    bary = np.asarray(bary)
    sites = bary@xy
    actual = np.asarray(height(sites[:,0], sites[:,1]), dtype=float)
    controls = np.asarray(height(xy[:,0], xy[:,1]), dtype=float)
    return triangle_area(xy)*float(np.dot(weights, np.abs(actual-bary@controls)))


def pack_triangle_strips(faces, max_indices=256):
    """Greedily join adjacent faces without changing any directed triangle."""
    if not isinstance(max_indices,int) or not 3<=max_indices<=256:
        raise ValueError('Invalid strip length')
    faces = [tuple(f) for f in faces]
    edge_faces = {}
    for i, face in enumerate(faces):
        for a,b in zip(face, face[1:]+face[:1]):
            edge_faces.setdefault(tuple(sorted((a,b))), []).append(i)
    available = set(range(len(faces)))
    strips = []
    def trace(start, rotation):
        original=faces[start]
        indices=list(original[rotation:]+original[:rotation]);visited={start}
        while len(indices)<max_indices:
            a,b=indices[-2:]
            adjacent=[i for i in edge_faces[tuple(sorted((a,b)))] if i in available and i not in visited]
            if len(adjacent)!=1:break
            neighbor=adjacent[0];c=next(v for v in faces[neighbor] if v not in (a,b))
            candidate=(a,c,b) if (len(indices)-2)%2 else (a,b,c)
            f=faces[neighbor]
            if candidate not in (f,f[1:]+f[:1],f[2:]+f[:2]):break
            indices.append(c);visited.add(neighbor)
        return indices,visited
    for start in range(len(faces)):
        if start not in available:continue
        candidates=[trace(start,r) for r in range(3)]
        indices,visited=max(candidates,key=lambda c:len(c[1]))
        available.difference_update(visited);strips.append(indices)
    return strips


def local_triangles(domain, height, error_bound, *, tolerance=.1,
                    max_points=30000, max_steps=30000, convex=False,
                    name='Local triangle research', source=None,edge_decision='l1'):
    """Refine worst certified triangle; bisect its L1-best edge plus neighbor."""
    bounds=np.asarray(domain,dtype=float)
    if edge_decision not in ('l1','longest-edge'):raise ValueError('Invalid edge decision')
    if bounds.shape!=(4,) or not np.isfinite(bounds).all() or max(abs(bounds))>10000:
        raise ValueError('Invalid local domain')
    x0,y0,x1,y1=bounds
    if x1-x0<1e-4 or y1-y0<1e-4 or not np.allclose(bounds,np.round(bounds,5),atol=1e-10,rtol=0):
        raise ValueError('Domain must have positive area and five-decimal coordinates')
    if isinstance(tolerance,bool) or not math.isfinite(tolerance) or not .0001<=tolerance<=100:
        raise ValueError('Invalid tolerance')
    if (isinstance(max_points,bool) or not isinstance(max_points,int) or not 4<=max_points<=300000
        or isinstance(max_steps,bool) or not isinstance(max_steps,int) or not 0<=max_steps<=300000):
        raise ValueError('Invalid refinement budget')
    points=[(x0,y0),(x1,y0),(x0,y1),(x1,y1)]
    active={};edges={};heap=[];next_id=0
    history=[];closures=0;safeguards=0;propagations=0;status=None
    def measure(face):
        value=error_bound(np.asarray([points[i] for i in face]))
        if isinstance(value,bool) or not math.isfinite(value) or value<0:
            raise ValueError('Invalid authored triangle error bound')
        return float(value)
    def insert(face):
        nonlocal next_id
        value=measure(face);identity=next_id;next_id+=1
        active[identity]=(face,value);heapq.heappush(heap,(-value,identity))
        for a,b in zip(face,face[1:]+face[:1]):
            owners=edges.setdefault(tuple(sorted((a,b))),set());owners.add(identity)
            if len(owners)>2:raise ValueError('Nonmanifold refinement')
    def remove(identity):
        face,_=active.pop(identity)
        for a,b in zip(face,face[1:]+face[:1]):
            key=tuple(sorted((a,b)));edges[key].remove(identity)
            if not edges[key]:del edges[key]
    insert((0,1,3));insert((0,3,2))
    for step in range(max_steps+1):
        while heap and heap[0][1] not in active:heapq.heappop(heap)
        worst,identity=heap[0];worst=-worst
        history.append({'step':step,'points':len(points),'triangles':len(active),'max_bound_m':worst})
        if worst<=tolerance-5e-6:status='target-met';break
        if step==max_steps:status='step-budget';break
        if len(points)>=max_points:status='point-budget';break
        face,_=active[identity];vertices=np.asarray([points[i] for i in face])
        if triangle_area(vertices)<=1e-8:status='geometry-resolution-limit';break
        candidates=[]
        for i in range(3):
            a,b,c=face[i],face[(i+1)%3],face[(i+2)%3]
            midpoint=(np.asarray(points[a])+points[b])/2
            # Retain exact dyadic XY in binary64, without five-decimal rounding.
            # JSON supports these coordinates; actual additional bytes count.
            if np.linalg.norm(np.asarray(points[a])-points[b])<2e-5:continue
            if edge_decision=='longest-edge':
                score=-float(np.linalg.norm(np.asarray(points[a])-points[b]))
            elif convex:
                gap=float((height(*points[a])+height(*points[b]))/2-height(*midpoint))
                if not math.isfinite(gap) or gap<-1e-9:raise ValueError('Authored convex decision violated')
                score=-triangle_area(vertices)*max(0,gap)/3
            else:
                score=l1_interpolation([points[a],midpoint,points[c]],height)+l1_interpolation([midpoint,points[b],points[c]],height)
            if not math.isfinite(score):raise ValueError('Invalid authored interpolation values')
            length=float(np.linalg.norm(np.asarray(points[a])-points[b]))
            candidates.append((score,-length,i,tuple(midpoint)))
        if not candidates:status='coordinate-resolution-limit';break
        chosen=min(candidates)
        if not convex and edge_decision=='l1':
            _,_,i,midpoint=chosen
            a,b,c=face[i],face[(i+1)%3],face[(i+2)%3]
            child_bounds=[error_bound(np.asarray(p)) for p in
                ([points[a],midpoint,points[c]],[midpoint,points[b],points[c]])]
            if any(isinstance(v,bool) or not math.isfinite(v) or v<0 for v in child_bounds):
                raise ValueError('Invalid authored triangle error bound')
            # Absolute L1 quadrature can repeatedly choose a short edge while
            # a conservative Linfinity certificate stays unchanged. Force
            # physical diameter progress; this is NOT the paper's pure rule.
            if max(child_bounds)>=worst*.99:
                chosen=min(candidates,key=lambda candidate:(candidate[1],candidate[2]))
                safeguards+=1
        _,_,i,midpoint=chosen;a,b=face[i],face[(i+1)%3]
        if edge_decision=='longest-edge':
            # Prepare a longer neighboring edge first. Directly bisecting an
            # arbitrary edge of its neighbor can generate needle triangles.
            visited=set()
            while True:
                key=tuple(sorted((a,b)))
                if key in visited:raise ValueError('Longest-edge propagation cycle')
                visited.add(key);length=float(np.linalg.norm(np.asarray(points[a])-points[b]))
                longer=None
                for owner in sorted(edges[key]):
                    other=active[owner][0]
                    candidate=max([(float(np.linalg.norm(np.asarray(points[u])-points[v])),min(u,v),max(u,v))
                        for u,v in zip(other,other[1:]+other[:1])])
                    if candidate[0]>length*(1+1e-12):longer=candidate[1:];break
                if longer is None:break
                a,b=longer
            if len(visited)>1:propagations+=1
            midpoint=tuple((np.asarray(points[a])+points[b])/2)
        owners=sorted(edges[tuple(sorted((a,b)))])
        if any(triangle_area([points[v] for v in active[owner][0]])<=1e-8 for owner in owners):
            status='geometry-resolution-limit';break
        middle=len(points);points.append(midpoint)
        children=[]
        for owner in owners:
            old,_=active[owner]
            for j in range(3):
                u,v,w=old[j],old[(j+1)%3],old[(j+2)%3]
                if {u,v}=={a,b}:
                    children.extend([(u,middle,w),(middle,v,w)]);break
            remove(owner)
        closures+=len(owners)-1
        for child in children:insert(child)
        if len(heap)>4*len(active)+1024:
            heap=[(-error,key) for key,(_,error) in active.items()];heapq.heapify(heap)
    xy=np.asarray(points);z=np.asarray(height(xy[:,0],xy[:,1]),dtype=float)
    if z.shape!=(len(points),) or not np.isfinite(z).all() or np.any((z<-500)|(z>9000)):
        raise ValueError('Invalid authored heights')
    xyz=[[float(x),float(y),round(float(h),5)] for (x,y),h in zip(points,z)]
    faces=[face for face,_ in active.values()]
    strips=pack_triangle_strips(faces)
    terrain=Terrain(name=name,longitude=0,latitude=0,vertical_datum='unknown',
        reference_height=round(float(np.median(z)),5),demonstration=True,
        source={**(source or {}),'method':'Conforming local L1-decision bisection; certified Linfinity selection; no optimality claim'},
        points=xyz,patches=[TerrainPatch(id=f'h{i}',kind='triangle-strip',indices=indices) for i,indices in enumerate(strips)])
    report={'target_m':tolerance,'target_met':status=='target-met','status':status,'points':len(points),
        'triangles':len(faces),'patches':len(strips),'closure_splits':closures,'longest_edge_safeguards':safeguards,
        'longest_edge_preparation_splits':propagations,
        'max_bound_m':history[-1]['max_bound_m'],'rounding_margin_m':5e-6,'history':history,
        'decision':'Longest physical edge; not the paper L1 rule' if edge_decision=='longest-edge' else 'Exact convex L1 reduction' if convex else 'Seven-point absolute L1 quadrature; longest-edge safeguard when bound improves less than 1%; not an error bound',
        'edge_decision':edge_decision,
        'safeguard_minimum_bound_reduction_fraction':None if convex else .01,
        'coordinate_precision':'Unrounded binary64 dyadic XY; five-decimal Z; additional coordinate digits count in archive bytes',
        'seams':'C0 shared-edge bisection closure; no hanging nodes; not C1',
        'scope':'Trusted authored analytic functions; different stronger candidate family than the tensor-grid hybrid; no ArcGIS execution'}
    return terrain,report
