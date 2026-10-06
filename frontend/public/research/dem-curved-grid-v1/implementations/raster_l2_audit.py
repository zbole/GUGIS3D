"""Global L2 integration of immutable GUGIS strips over their source raster.

Cell intersections ensure Gauss quadrature integrates polynomial residual squared,
not a sparse point estimate. Does not edit backend kernels, archives or cities.
"""
import csv
import hashlib
import json
import math
from pathlib import Path
from zipfile import ZipFile
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
NODES, WEIGHTS = np.polynomial.legendre.leggauss(3)
NODES, WEIGHTS = (NODES+1)/2, WEIGHTS/2
U,V = np.meshgrid(NODES,NODES)
WU,WV = np.meshgrid(WEIGHTS,WEIGHTS)
UV = np.column_stack((U.ravel(),V.ravel()))
W = (WU*WV).ravel()


def clip_polygon(polygon, axis, boundary, keep_greater):
    out=[]
    previous=polygon[-1]
    previous_inside=previous[axis]>=boundary if keep_greater else previous[axis]<=boundary
    for current in polygon:
        inside=current[axis]>=boundary if keep_greater else current[axis]<=boundary
        if inside != previous_inside:
            t=(boundary-previous[axis])/(current[axis]-previous[axis])
            point=previous+t*(current-previous)
            point[axis]=boundary
            out.append(point)
        if inside:out.append(current)
        previous,previous_inside=current,inside
    return out


def clip_rectangle(triangle,west,east,south,north):
    polygon=list(np.asarray(triangle,dtype=float))
    for axis,boundary,greater in ((0,west,True),(0,east,False),(1,south,True),(1,north,False)):
        if len(polygon)<3:return []
        polygon=clip_polygon(polygon,axis,boundary,greater)
    return polygon


def integrate_triangle(triangle,residual):
    a,b,c=np.asarray(triangle)
    det=abs(float(np.linalg.det(np.column_stack((b-a,c-a)))))
    if det<=1e-16:return 0.,0.
    sites=a+UV[:,0,None]*(b-a)+(1-UV[:,0,None])*UV[:,1,None]*(c-a)
    values=residual(sites)
    return float(np.dot(W*(1-UV[:,0])*det,values*values)),det/2


def integrate_model(reference,terrain):
    xs,ys,z=(np.asarray(reference[key],dtype=float) for key in ('x','y','height'))
    if min(len(xs),len(ys))<2 or z.shape!=(len(ys),len(xs)) or np.any(np.diff(xs)<=0) or np.any(np.diff(ys)<=0) or not all(np.isfinite(a).all() for a in (xs,ys,z)):
        raise ValueError('Finite ordered complete source raster required')
    points=np.asarray(terrain['points'],dtype=float)
    if points.ndim!=2 or points.shape[1]!=3 or not np.isfinite(points).all():raise ValueError('Invalid points')
    contributions=[];areas=[];triangle_count=0;quad_count=0;intersection_count=0
    for patch in terrain['patches']:
        if patch['kind']=='ruled-strip':
            pieces=[('quad',points[[a,b,c,d]]) for a,b,c,d in zip(patch['left'],patch['right'],patch['left'][1:],patch['right'][1:])]
        elif patch['kind']=='triangle-strip':
            pieces=[('triangle',points[patch['indices'][i:i+3]]) for i in range(len(patch['indices'])-2)]
        else:raise ValueError('Only ruled strips and triangle strips supported')
        for kind,p in pieces:
            west,south=p[:,:2].min(axis=0);east,north=p[:,:2].max(axis=0)
            if west<xs[0]-1e-10 or east>xs[-1]+1e-10 or south<ys[0]-1e-10 or north>ys[-1]+1e-10:raise ValueError('Primitive outside reference')
            if kind=='quad':
                if east<=west or north<=south:raise ValueError('Degenerate ruled quad')
                lookup={(x,y):height for x,y,height in p}
                if len(lookup)!=4 or any(pos not in lookup for pos in ((west,south),(east,south),(west,north),(east,north))):raise ValueError('Axis-aligned nondegenerate quad required')
                a,b,c,d=[lookup[pos] for pos in ((west,south),(east,south),(west,north),(east,north))]
                def model(sites):
                    u=(sites[:,0]-west)/(east-west);v=(sites[:,1]-south)/(north-south)
                    return (1-u)*(1-v)*a+u*(1-v)*b+(1-u)*v*c+u*v*d
                quad_count+=1
            else:
                plane=np.linalg.solve(np.column_stack((p[:,:2],np.ones(3))),p[:,2])
                def model(sites):return sites @ plane[:2]+plane[2]
                triangle_count+=1
            c0=max(0,np.searchsorted(xs,west,side='right')-1);c1=min(len(xs)-1,np.searchsorted(xs,east,side='left'))
            r0=max(0,np.searchsorted(ys,south,side='right')-1);r1=min(len(ys)-1,np.searchsorted(ys,north,side='left'))
            for row in range(r0,r1):
                for column in range(c0,c1):
                    x0,x1=xs[column:column+2];y0,y1=ys[row:row+2]
                    za,zb,zc,zd=z[row,column],z[row,column+1],z[row+1,column],z[row+1,column+1]
                    def residual(sites):
                        u=(sites[:,0]-x0)/(x1-x0);v=(sites[:,1]-y0)/(y1-y0)
                        source=(1-u)*(1-v)*za+u*(1-v)*zb+(1-u)*v*zc+u*v*zd
                        return model(sites)-source
                    if kind=='quad':
                        lo=np.array([max(west,x0),max(south,y0)]);hi=np.array([min(east,x1),min(north,y1)])
                        area=float(np.prod(hi-lo))
                        if area<=0:continue
                        values=residual(lo+UV*(hi-lo))
                        contributions.append(float(np.dot(W,values*values))*area);areas.append(area);intersection_count+=1
                    else:
                        polygon=clip_rectangle(p[:,:2],x0,x1,y0,y1)
                        for i in range(1,len(polygon)-1):
                            value,area=integrate_triangle([polygon[0],polygon[i],polygon[i+1]],residual)
                            if area>0:contributions.append(value);areas.append(area);intersection_count+=1
    area=math.fsum(areas);expected=(xs[-1]-xs[0])*(ys[-1]-ys[0])
    if not math.isclose(area,expected,rel_tol=0,abs_tol=1e-7):raise ValueError('Integrated coverage area differs from reference domain')
    e2=math.sqrt(math.fsum(contributions))
    return {'e2_m2':e2,'rms_integral_m':e2/math.sqrt(area),'integrated_area_m2':area,
            'native_triangles':triangle_count,'ruled_quads':quad_count,'integration_pieces':intersection_count}


def sha(data):return hashlib.sha256(data).hexdigest()


def build():
    manifest_bytes=(ROOT/'shared/bristol-viewer-models.json').read_bytes();manifest=json.loads(manifest_bytes)
    original=json.loads((ROOT/'shared/bristol-local-partition-summary.json').read_bytes())
    rows=[]
    for case in original['cases']:
        package=ROOT/'frontend/public/research/bristol-local-partition'/case['download']['filename']
        with ZipFile(package) as archive:reference_bytes=archive.read('reference.json')
        if sha(reference_bytes)!=case['reference_sha256']:raise ValueError('Reference changed')
        reference=json.loads(reference_bytes)
        for m in manifest['models']:
            if m['case_id']!=case['id']:continue
            model_bytes=(ROOT/'frontend/public/research/bristol-viewer/models'/m['case_id']/m['filename']).read_bytes()
            if sha(model_bytes)!=m['sha256'] or len(model_bytes)!=m['bytes']:raise ValueError('Immutable model changed')
            result=integrate_model(reference,json.loads(model_bytes))
            if result['rms_integral_m']>m['continuous_bound_m']+1e-10:raise ValueError('RMS exceeds existing maximum reference certificate')
            row={**m,**result,'reference_sha256':sha(reference_bytes)};rows.append(row)
            print(m['case_id'],m['family'],m['target_m'],f"E2={result['e2_m2']:.8f}, RMS={result['rms_integral_m']:.8f}",flush=True)
    report={'schema':'gugis-bristol-global-l2-v1','viewer_manifest_sha256':sha(manifest_bytes),
            'source_sha256':sha(Path(__file__).read_bytes().replace(b'\r\n',b'\n')),
            'scope':'Integral against original piecewise-bilinear raster over the whole 4096m2 domain; not ground-truth accuracy, not an ArcGIS software result. Native triangle count excludes ruled quads.',
            'integration':'Each native primitive intersected with every touched source cell. Residual squared has polynomial degree at most four; 3x3 Gauss tensor/Duffy integration, float64. No sampling RMSE substituted.',
            'models':rows}
    content=(json.dumps(report,indent=2,ensure_ascii=False,allow_nan=False)+'\n').encode()
    output=ROOT/'frontend/public/research/bristol-global-l2';output.mkdir(exist_ok=True)
    (output/'results.json').write_bytes(content);(ROOT/'shared/bristol-global-l2.json').write_bytes(content)
    fields=['case_id','family','target_m','bytes','points','native_triangles','ruled_quads','e2_m2','rms_integral_m','continuous_bound_m','rmse_m','integrated_area_m2','sha256','reference_sha256']
    with (output/'results.csv').open('w',encoding='utf-8',newline='') as stream:
        writer=csv.DictWriter(stream,fieldnames=fields,extrasaction='ignore');writer.writeheader();writer.writerows(rows)


if __name__=='__main__':build()
