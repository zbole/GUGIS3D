"""Finite-scale, sampled-error hybrid approximation on rectilinear grids.

An engineering prototype inspired by error-driven refinement, not a proof or
implementation of Mirebeau/Cohen's optimal anisotropic triangle bisection.
Global tensor cuts guarantee matching edges; no slope-based classification.
"""
import json
import math
import numpy as np
from ..environment_models import Terrain, TerrainPatch


def adaptive_grid(x_axis, y_axis, heights, *, tolerance=0.1, mode='hybrid',
                  max_points=300000, max_steps=2048, name='Hybrid research terrain',
                  longitude=0, latitude=0, datum='unknown', demonstration=True, source=None,
                  cell_certificate=None):
    x, y, z = np.asarray(x_axis,dtype=float), np.asarray(y_axis,dtype=float), np.asarray(heights,dtype=float)
    if x.ndim!=1 or y.ndim!=1 or len(x)<2 or len(y)<2 or z.shape!=(len(y),len(x)):
        raise ValueError('需要对应的二维高程与至少两个递增 x/y 坐标')
    if z.size>1_000_000 or not np.isfinite(x).all() or not np.isfinite(y).all():
        raise ValueError('源网格超过一百万点或坐标无效')
    if np.any(np.diff(x)<=1e-5) or np.any(np.diff(y)<=1e-5) or max(np.abs(x).max(),np.abs(y).max())>200000:
        raise ValueError('仅支持有限范围、严格递增的直角投影坐标')
    if not np.allclose(x,np.round(x,5),atol=1e-10,rtol=0) or not np.allclose(y,np.round(y,5),atol=1e-10,rtol=0):
        raise ValueError('本研究构建器要求坐标可精确保存到五位小数')
    if np.isinf(z).any() or np.any(np.isfinite(z)&((z<-500)|(z>9000))):
        raise ValueError('高程需在 -500 至 9000 米内，缺测使用 NaN')
    if isinstance(tolerance,bool) or not math.isfinite(tolerance) or tolerance<0.0001 or tolerance>100:
        raise ValueError('误差目标需为 0.0001 至 100 米')
    if (mode not in ('hybrid','triangles') or isinstance(max_points,bool) or not isinstance(max_points,int)
        or isinstance(max_steps,bool) or not isinstance(max_steps,int) or not 4<=max_points<=300000 or not 0<=max_steps<=2048):
        raise ValueError('构建模式或资源预算无效')
    # Coordinate rounding is exact; height rounding contributes at most 5e-6 m.
    fitting_tolerance=tolerance-0.000005
    xs,ys=[0,len(x)-1],[0,len(y)-1]
    cache={}

    def cell(r0,r1,c0,c1):
        key=(r0,r1,c0,c1)
        if key in cache:return cache[key]
        block=z[r0:r1+1,c0:c1+1]
        if not np.isfinite(block).all():
            value={'bounds':key,'omit':r1-r0==1 and c1-c0==1,'error':math.inf,'kind':None}
        else:
            u=((x[c0:c1+1]-x[c0])/(x[c1]-x[c0]))[None,:]
            v=((y[r0:r1+1]-y[r0])/(y[r1]-y[r0]))[:,None]
            a,b,c,d=block[0,0],block[0,-1],block[-1,0],block[-1,-1]
            bilinear=(1-u)*(1-v)*a+u*(1-v)*b+(1-u)*v*c+u*v*d
            diagonal_ad=np.where(u>=v,a+(b-a)*u+(d-b)*v,a+(d-c)*u+(c-a)*v)
            diagonal_bc=np.where(u+v<=1,a+(b-a)*u+(c-a)*v,d+(c-d)*(1-u)+(b-d)*(1-v))
            tri_errors=[float(np.abs(block-p).max()) for p in (diagonal_ad,diagonal_bc)]
            # Check the whole finite mother line, plus both boundary curves.
            mother_x=float(np.abs(block-((1-u)*block[:,0,None]+u*block[:,-1,None])).max())
            boundary_y=max(float(np.abs(block[:,0,None]-((1-v)*a+v*c)).max()),
                           float(np.abs(block[:,-1,None]-((1-v)*b+v*d)).max()))
            mother_y=float(np.abs(block-((1-v)*block[0,None,:]+v*block[-1,None,:])).max())
            boundary_x=max(float(np.abs(block[0,None,:]-((1-u)*a+u*b)).max()),
                           float(np.abs(block[-1,None,:]-((1-u)*c+u*d)).max()))
            direction='x' if mother_x+boundary_y<=mother_y+boundary_x else 'y'
            mother,boundary=(mother_x,boundary_y) if direction=='x' else (mother_y,boundary_x)
            ruled_bound=mother+boundary
            if cell_certificate is not None:
                certified=cell_certificate(float(x[c0]),float(x[c1]),float(y[r0]),float(y[r1]))
                if len(certified['triangles'])!=2 or any(not math.isfinite(v) or v<0
                    for v in [certified['ruled'],*certified['triangles']]):
                    raise ValueError('解析误差证书无效')
                ruled_bound=max(ruled_bound,certified['ruled'])
                tri_errors=[max(sample,bound) for sample,bound in zip(tri_errors,certified['triangles'])]
            diagonal=int(tri_errors[1]<tri_errors[0]);triangle_error=tri_errors[diagonal]
            # Four-index triangle strips encode less than two boundary arrays.
            # Prefer triangles if both meet the target; ruled faces must earn
            # their cost through fewer required control points at equal error.
            kind='triangle-strip'
            if mode=='hybrid' and triangle_error>fitting_tolerance and ruled_bound<triangle_error:
                kind='ruled-strip'
            error=ruled_bound if kind=='ruled-strip' else triangle_error
            value={'bounds':key,'omit':False,'kind':kind,'error':error,'diagonal':diagonal,
                'actual_error':float(np.abs(block-bilinear).max()) if kind=='ruled-strip' else float(np.abs(block-(diagonal_ad if diagonal==0 else diagonal_bc)).max()),
                'triangle_error':triangle_error,'ruled_bound':ruled_bound,'mother_direction':direction,
                'mother_error':mother,'boundary_error':boundary,
                'mother_length_m':float(x[c1]-x[c0] if direction=='x' else y[r1]-y[r0]),
                'band_width_m':float(y[r1]-y[r0] if direction=='x' else x[c1]-x[c0])}
        cache[key]=value;return value

    def current():return [cell(r0,r1,c0,c1) for r0,r1 in zip(ys,ys[1:]) for c0,c1 in zip(xs,xs[1:])]
    history=[];reason=None
    for iteration in range(max_steps+1):
        cells=current();active=[c for c in cells if not c['omit']]
        # Keep only this partition's scalar evaluations, not every past mesh.
        cache={item['bounds']:item for item in cells}
        worst=max(active,key=lambda c:c['error'],default=None)
        maximum=worst['error'] if worst else 0
        history.append({'iteration':iteration,'control_lattice_points':len(xs)*len(ys),
            'cells':len(cells),'max_selection_bound_m':maximum if math.isfinite(maximum) else None})
        if maximum<=fitting_tolerance:reason='target-met';break
        if iteration==max_steps:reason='step-budget';break
        r0,r1,c0,c1=worst['bounds'];options=[]
        for axis,lo,hi in [('x',c0,c1),('y',r0,r1)]:
            if hi-lo<2:continue
            mid=(lo+hi)//2
            point_cost=len(ys) if axis=='x' else len(xs)
            if (len(xs)+(axis=='x'))*(len(ys)+(axis=='y'))>max_points:continue
            children=[cell(r0,r1,c0,mid),cell(r0,r1,mid,c1)] if axis=='x' else [cell(r0,mid,c0,c1),cell(mid,r1,c0,c1)]
            remaining=[c for c in children if not c['omit']]
            child_error=max((c['error'] for c in remaining),default=0)
            if math.isfinite(maximum):score=(maximum-child_error)/point_cost
            else:
                # NoData cannot be bridged. Prefer cuts exposing valid regions;
                # when both remain missing, force geometric progress to cells.
                valid_area=sum((c['bounds'][1]-c['bounds'][0])*(c['bounds'][3]-c['bounds'][2])
                               for c in children if c['omit'] or math.isfinite(c['error']))
                score=valid_area/point_cost
            span=float(x[c1]-x[c0] if axis=='x' else y[r1]-y[r0])
            options.append((score,span,axis,mid))
        if not options:
            reason='source-resolution-limit' if r1-r0==1 and c1-c0==1 else 'point-budget'
            break
        _,_,axis,mid=max(options)
        (xs if axis=='x' else ys).append(mid);(xs if axis=='x' else ys).sort()

    lookup={};points=[]
    for r in ys:
        for c in xs:
            if np.isfinite(z[r,c]):
                lookup[r,c]=len(points);points.append([float(x[c]),float(y[r]),round(float(z[r,c]),5)])
    patches=[];diagnostics=[];predicted=np.full(z.shape,np.nan)
    for item in current():
        if item['omit'] or item['kind'] is None:continue
        r0,r1,c0,c1=item['bounds']
        a,b,c,d=[lookup[r,col] for r,col in [(r0,c0),(r0,c1),(r1,c0),(r1,c1)]]
        patch_id=f'h{len(patches)}'
        if item['kind']=='ruled-strip':
            patch=TerrainPatch(id=patch_id,kind='ruled-strip',left=[b,d],right=[a,c]) if item['mother_direction']=='x' else TerrainPatch(id=patch_id,kind='ruled-strip',left=[a,b],right=[c,d])
        else:patch=TerrainPatch(id=patch_id,kind='triangle-strip',indices=[c,a,d,b] if item['diagonal']==0 else [a,b,c,d])
        patches.append(patch)
        u=((x[c0:c1+1]-x[c0])/(x[c1]-x[c0]))[None,:];v=((y[r0:r1+1]-y[r0])/(y[r1]-y[r0]))[:,None]
        za,zb,zc,zd=[points[i][2] for i in (a,b,c,d)]
        if patch.kind=='ruled-strip':p=(1-u)*(1-v)*za+u*(1-v)*zb+(1-u)*v*zc+u*v*zd
        elif item['diagonal']==0:p=np.where(u>=v,za+(zb-za)*u+(zd-zb)*v,za+(zd-zc)*u+(zc-za)*v)
        else:p=np.where(u+v<=1,za+(zb-za)*u+(zc-za)*v,zd+(zc-zd)*(1-u)+(zb-zd)*(1-v))
        predicted[r0:r1+1,c0:c1+1]=p
        diagnostics.append({'patch':patch_id,**{k:v for k,v in item.items() if k not in ('bounds','omit')},
            'source_bounds':list(item['bounds']),'xy_bounds':[float(x[c0]),float(y[r0]),float(x[c1]),float(y[r1])]})
    if not patches:raise ValueError('预算内没有可构建的有效地形面')
    terrain=Terrain(name=name,longitude=longitude,latitude=latitude,vertical_datum=datum,reference_height=float(np.nanmedian(z)),
        demonstration=demonstration,source={**(source or {}),'构建方法':'有限尺度源网格误差 + 全局相容方向细分；工程原型',
            '误差口径':'解析样本另有逐单元误差界；源网格误差独立核验' if cell_certificate else '仅约束提供的源网格采样点，不是连续地形误差定理',
            '误差目标米':str(tolerance)},points=points,patches=patches)
    finite=np.isfinite(predicted)&np.isfinite(z);error=predicted[finite]-z[finite]
    actual_max=float(np.abs(error).max()) if len(error) else None
    report={'mode':mode,'target_m':tolerance,'status':reason,'target_met':reason=='target-met' and actual_max<=tolerance,
        'source_shape':list(z.shape),'source_finite_samples':int(np.isfinite(z).sum()),'covered_samples':int(finite.sum()),
        'missing_samples':int(np.isnan(z).sum()),'uncovered_finite_samples':int((np.isfinite(z)&~finite).sum()),
        'points':len(points),'patches':len(patches),'ruled_patches':sum(p.kind=='ruled-strip' for p in patches),
        'triangle_patches':sum(p.kind=='triangle-strip' for p in patches),'rmse_m':float(np.sqrt(np.mean(error**2))),
        'max_selection_bound_m':history[-1]['max_selection_bound_m'],
        'max_sampled_error_m':actual_max,'history':history,'diagnostics':diagnostics,
            'scope':'Rectilinear research grids only. Empirical finite-source error; not continuous certification or the cited paper algorithm.',
        'certificate_scope':'Caller-supplied analytic cell bounds, checked for finite nonnegative values; trusted research functions only' if cell_certificate else 'None; finite-source samples only',
        'seams':'One global tensor partition; shared control-point IDs and identical linear boundary traces; C0, not C1.'}
    report['native_bytes']=len(json.dumps(terrain.model_dump(exclude_none=True),separators=(',',':')).encode())
    return terrain,report,predicted
