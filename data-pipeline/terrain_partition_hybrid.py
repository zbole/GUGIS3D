"""Research-only local rectangles with conforming boundary triangles.

A cell keeps a bilinear ruled surface when the whole-cell certificate permits
it. Hanging boundary vertices force a centre-to-boundary triangulation encoded
as triangle strips, never triangle-fan primitives. Global source vertex IDs and
identical edge traces guarantee C0. This is not an optimality theorem.
"""
from functools import lru_cache
import math
from pathlib import Path
import sys
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'backend'))
from app.environment_models import Terrain, TerrainPatch
from app.services.terrain_raster_reference import RasterReference


def partition_hybrid(reference: RasterReference, *, tolerance=.1, max_steps=2048,
                     max_points=300000, name='Locally partitioned hybrid terrain'):
    if not isinstance(reference, RasterReference):
        raise ValueError('A validated finite raster reference is required')
    if isinstance(tolerance,bool) or not isinstance(tolerance,(int,float)) or not math.isfinite(tolerance) or not .0001<=tolerance<=100:
        raise ValueError('Invalid tolerance')
    if isinstance(max_steps,bool) or not isinstance(max_steps,int) or not 0<=max_steps<=2048:
        raise ValueError('Invalid step budget')
    if isinstance(max_points,bool) or not isinstance(max_points,int) or not 4<=max_points<=300000:
        raise ValueError('Invalid point budget')
    x,y,z=reference.x,reference.y,reference.height
    if max(np.abs(x).max(),np.abs(y).max())>200000 or not all(np.allclose(a,np.round(a,5),rtol=0,atol=1e-10) for a in (x,y)) or min(np.diff(x).min(),np.diff(y).min())<.0001:
        raise ValueError('Local grid must preserve five-decimal positions and nondegenerate cells')
    threshold=tolerance-5e-6
    cells=[(0,len(y)-1,0,len(x)-1)]

    @lru_cache(maxsize=131072)
    def triangle_error(vertices):
        return reference.triangle_error(np.asarray(vertices))

    @lru_cache(maxsize=131072)
    def shape(bounds,boundary):
        r0,r1,c0,c1=bounds
        corners=[(float(x[c0]),float(y[r0])),(float(x[c1]),float(y[r0])),
                 (float(x[c0]),float(y[r1])),(float(x[c1]),float(y[r1]))]
        if len(boundary)==4:
            certificate=reference.cell_certificate(float(x[c0]),float(x[c1]),float(y[r0]),float(y[r1]))
            diagonal=int(np.argmin(certificate['triangles']));tri=certificate['triangles'][diagonal]
            if tri>threshold and certificate['ruled']<tri:
                return {'kind':'ruled-strip','error':certificate['ruled'],'corners':corners,'faces':[]}
            a,b,c,d=corners
            faces=[(c,a,d),(d,a,b)] if diagonal==0 else [(a,b,c),(c,b,d)]
            return {'kind':'triangle-strip','error':tri,'corners':corners,'faces':faces}
        centre=(round(float((x[c0]+x[c1])/2),5),round(float((y[r0]+y[r1])/2),5))
        polygon=[(float(x[c]),float(y[r])) for r,c in boundary]
        faces=[(centre,a,b) for a,b in zip(polygon,polygon[1:]+polygon[:1])]
        return {'kind':'triangle-strip','error':max(triangle_error(face) for face in faces),
                'corners':corners,'faces':faces,'boundary_triangles':True}

    def layout(rectangles):
        vertices={(r,c) for r0,r1,c0,c1 in rectangles for r,c in [(r0,c0),(r0,c1),(r1,c0),(r1,c1)]}
        horizontal={};vertical={}
        for r,c in vertices:
            horizontal.setdefault(r,[]).append(c);vertical.setdefault(c,[]).append(r)
        for values in [*horizontal.values(),*vertical.values()]:values.sort()
        output=[];sites=set()
        for r0,r1,c0,c1 in rectangles:
            bottom=[(r0,c) for c in horizontal[r0] if c0<=c<=c1]
            right=[(r,c1) for r in vertical[c1] if r0<=r<=r1]
            top=[(r1,c) for c in reversed(horizontal[r1]) if c0<=c<=c1]
            left=[(r,c0) for r in reversed(vertical[c0]) if r0<=r<=r1]
            boundary=tuple(bottom[:-1]+right[:-1]+top[:-1]+left[:-1])
            item=shape((r0,r1,c0,c1),boundary)
            sites.update(item['corners'])
            for face in item['faces']:sites.update(face)
            output.append(item)
        return output,sites

    history=[];status='step-budget'
    for step in range(max_steps+1):
        current,sites=layout(cells);worst_index=max(range(len(cells)),key=lambda i:current[i]['error'])
        maximum=current[worst_index]['error']
        history.append({'step':step,'points':len(sites),'cells':len(cells),'max_selection_bound_m':maximum})
        if maximum<=threshold:
            status='target-met';break
        if step==max_steps:break
        r0,r1,c0,c1=cells[worst_index];options=[]
        for direction,start,end in [('x',c0,c1),('y',r0,r1)]:
            if end-start<=1:continue
            mid=(start+end)//2
            children=[(r0,r1,c0,mid),(r0,r1,mid,c1)] if direction=='x' else [(r0,mid,c0,c1),(mid,r1,c0,c1)]
            proposed=cells[:worst_index]+cells[worst_index+1:]+children
            proposed_shapes,proposed_sites=layout(proposed)
            if len(proposed_sites)>max_points:continue
            # Count all changed boundary closure, not just the two new children.
            after=max(s['error'] for s in proposed_shapes)
            delta=max(1,len(proposed_sites)-len(sites))
            span=float(x[c1]-x[c0] if direction=='x' else y[r1]-y[r0])
            options.append(((maximum-after)/delta,span,direction,proposed))
        if not options:
            status='source-resolution-limit' if r1-r0==1 and c1-c0==1 else 'point-budget';break
        cells=max(options,key=lambda item:item[:3])[3]

    current,sites=layout(cells)
    points=[[px,py,round(float(reference(px,py)),5)] for px,py in sorted(sites)]
    lookup={tuple(p[:2]):i for i,p in enumerate(points)}
    patches=[]
    for item in current:
        a,b,c,d=[lookup[p] for p in item['corners']]
        if item['kind']=='ruled-strip':
            patches.append(TerrainPatch(id=f'lp{len(patches)}',kind='ruled-strip',left=[a,b],right=[c,d]))
        else:
            for face in item['faces']:
                patches.append(TerrainPatch(id=f'lp{len(patches)}',kind='triangle-strip',indices=[lookup[p] for p in face]))
    terrain=Terrain(name=name,longitude=0,latitude=0,vertical_datum='unknown',reference_height=float(np.median(z)),
                    demonstration=False,source={'构建方法':'局部矩形分区 + 接缝三角带闭合；研究工程原型'},points=points,patches=patches)
    bound=reference.model_error(terrain.model_dump(exclude_none=True))
    receipt={'status':status,'target_m':tolerance,'target_met':status=='target-met' and bound['max_error_bound_m']<=tolerance,
             'continuous_bound_m':bound['max_error_bound_m'],'points':len(points),'patches':len(patches),
             'local_cells':len(cells),'boundary_triangulated_cells':sum(s.get('boundary_triangles',False) for s in current),
             'cells_source_indices':[list(c) for c in cells], 'history':history,'rounding_margin_m':5e-6,
             'seams':'Every cell edge is subdivided at all adjacent rectangle vertices, using shared global point IDs and Z. Hanging edges use centre-to-boundary triangles encoded as triangle strips. C0, not C1.',
             'scope':'Complete source raster; whole-cell reference bounds; engineering candidate family, no optimality theorem or city ENU conversion.'}
    return terrain,receipt
