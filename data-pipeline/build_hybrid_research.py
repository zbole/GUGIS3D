"""Build matched-error hybrid/triangle datasets from known functions and DEM.

Known quadratic interpolation errors are bounded exactly over triangles.
General C2 functions use explicit conservative Hessian bounds. Real DEM errors
remain finite-source statistics. No claim of optimality or a new proved theorem.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import time
from zipfile import ZipFile, ZIP_DEFLATED
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))
from app.services.terrain_hybrid import adaptive_grid

SOURCE_SHA='a7d90ba9b42712624d82cdfb3b7beae2ef7a2493f88d16846dea82fd8d1bc30d'


def quadratic_triangle_error(vertices,hessian):
    a,b,c=np.asarray(vertices,dtype=float)
    transform=np.column_stack((b-a,c-a));k=transform.T@np.asarray(hessian)@transform
    candidates=[abs(k[0,0])/8,abs(k[1,1])/8,abs(k[0,0]+k[1,1]-2*k[0,1])/8]
    if abs(np.linalg.det(k))>1e-15:
        s,t=np.linalg.solve(k,np.diag(k)/2)
        if s>=0 and t>=0 and s+t<=1:
            candidates.append(abs(.5*(k[0,0]*s*s+2*k[0,1]*s*t+k[1,1]*t*t-k[0,0]*s-k[1,1]*t)))
    return float(max(candidates))


def quadratic_certificate(hessian):
    def bounds(x0,x1,y0,y1):
        a,b,c,d=[(x0,y0),(x1,y0),(x0,y1),(x1,y1)]
        return {'ruled':abs(hessian[0][0])*(x1-x0)**2/8+abs(hessian[1][1])*(y1-y0)**2/8,
            'triangles':[max(quadratic_triangle_error(t,hessian) for t in tris)
                         for tris in [((a,b,d),(a,d,c)),((a,b,c),(b,d,c))]]}
    return bounds


def hessian_certificate(bound_function):
    def bounds(x0,x1,y0,y1):
        xx,yy,xy=bound_function(x0,x1,y0,y1);dx,dy=x1-x0,y1-y0
        return {'ruled':(xx*dx*dx+yy*dy*dy)/8,
                'triangles':[(xx*dx*dx+2*xy*dx*dy+yy*dy*dy)/6]*2}
    return bounds


def cases():
    def ridge_certificate(x0,x1,y0,y1):
        error=0 if y0>=0 or y1<=0 else .4*(-y0)*y1/(y1-y0)
        return {'ruled':error,'triangles':[error,error]}
    return [
        {'id':'steep-plane','name':'陡坡平面','function':lambda x,y:20+.6*x+.3*y,
            'certificate':quadratic_certificate([[0,0],[0,0]]),'expectation':'坡度大但没有曲率；两类表达应具有相同控制成本。'},
        {'id':'bilinear-saddle','name':'双线性鞍面','function':lambda x,y:20+.004*x*y,
            'certificate':quadratic_certificate([[0,.004],[.004,0]]),'expectation':'两方向母线均为直线；单个直纹面可精确表达，三角面需继续细分。'},
        {'id':'linear-flow','name':'长母线与弯曲边界','function':lambda x,y:20+8*np.sin(y/35)+.003*x*y,
            'certificate':hessian_certificate(lambda *b:(0,8/35**2,.003)),'expectation':'沿 x 母线线性，沿 y 边界弯曲；必须把边界逼近成本算入。'},
        {'id':'convex-bowl','name':'严格凸碗形','function':lambda x,y:20+.002*(x*x+1.5*y*y),
            'certificate':quadratic_certificate([[.004,0],[0,.006]]),'expectation':'曲率在两方向均非零；本矩形候选族内混合表示不应取得虚假优势。'},
        {'id':'rotating-direction','name':'方向变化的四次曲面','function':lambda x,y:20+1e-7*(x*x-y*y)**2,
            'certificate':hessian_certificate(lambda x0,x1,y0,y1:(
                1e-7*(12*max(x0*x0,x1*x1)+4*max(y0*y0,y1*y1)),
                1e-7*(12*max(y0*y0,y1*y1)+4*max(x0*x0,x1*x1)),
                8e-7*max(abs(x0),abs(x1))*max(abs(y0),abs(y1)))),
            'expectation':'局部低曲率方向不断变化；单点方向不能保证长母线适用。'},
        {'id':'sharp-ridge','name':'非光滑折脊','function':lambda x,y:20+.2*np.abs(y)+.05*x,
            'certificate':ridge_certificate,'expectation':'在折线处分区，两侧均可用三角面；不套用 C² 论文条件。'},
    ]


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--reference',type=Path,required=True)
    args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    axis=np.linspace(-100,100,65);xx,yy=np.meshgrid(axis,axis)
    datasets=cases()
    for data in datasets:data.update(x=axis,y=axis,z=data['function'](xx,yy),demonstration=True)
    tif=args.reference/'implicitterrain_demo/2494_1141.tif'
    if hashlib.sha256(tif.read_bytes()).hexdigest()!=SOURCE_SHA:raise ValueError('Author DEM differs from pinned source')
    import rasterio
    with rasterio.open(tif) as reader:
        from rasterio.windows import Window
        # 64m square around the centre: source pixel centres at 0.5m.
        dem=reader.read(1,window=Window(936,936,129,129)).astype(float)[::-1]
    dem_axis=np.arange(129)*.5-32
    datasets.append({'id':'swiss-dem-crop','name':'瑞士真实 DEM 局部','x':dem_axis,'y':dem_axis,'z':dem,
        'demonstration':False,'certificate':None,'expectation':'真实 0.5m 源网格核验；未知连续曲率，不给出连续误差保证。',
        'source_sha256':SOURCE_SHA,'source_window':[936,936,129,129],'physical_span_m':[64,64]})
    records=[]
    for data in datasets:
        case_dir=args.output/data['id'];case_dir.mkdir(exist_ok=True)
        np.savez_compressed(case_dir/'reference.npz',x=data['x'],y=data['y'],height=data['z'])
        rng=np.random.default_rng(20261007)
        xy=rng.uniform([data['x'][0],data['y'][0]],[data['x'][-1],data['y'][-1]],(4096,2))
        if data['demonstration']:expected=data['function'](xy[:,0],xy[:,1])
        else:
            cx=(xy[:,0]-data['x'][0])/.5;cy=(xy[:,1]-data['y'][0])/.5
            ix,iy=np.floor(cx).astype(int),np.floor(cy).astype(int);u,v=cx-ix,cy-iy
            expected=(1-u)*(1-v)*data['z'][iy,ix]+u*(1-v)*data['z'][iy,ix+1]+(1-u)*v*data['z'][iy+1,ix]+u*v*data['z'][iy+1,ix+1]
        fixture={'seed':20261007,'xy':xy.tolist(),'reference':expected.tolist(),
            'reference_kind':'exact-analytic-function' if data['demonstration'] else 'bilinear-interpolation-of-original-0.5m-DEM-crop; not independent measured heights'}
        (case_dir/'query-fixture.json').write_text(json.dumps(fixture,separators=(',',':')),encoding='utf-8')
        variants=[]
        for tolerance in (.05,.1,.25,.5):
            pair=[]
            for mode in ('hybrid','triangles'):
                start=time.perf_counter()
                terrain,report,prediction=adaptive_grid(data['x'],data['y'],data['z'],tolerance=tolerance,mode=mode,
                    name=data['name'],demonstration=data['demonstration'],cell_certificate=data['certificate'],
                    source={'研究样本':data['id'],'来源':'已知解析函数' if data['demonstration'] else 'ImplicitTerrain / swissALTI3D 原始 DEM 局部',
                        '源SHA256':data.get('source_sha256','analytic'),'坐标域':'局部投影偏移；非英国城市地形'})
                report['build_and_validate_ms']=(time.perf_counter()-start)*1000
                filename=f'{mode}-{tolerance:g}m.json'
                content=json.dumps(terrain.model_dump(exclude_none=True),separators=(',',':')).encode()
                (case_dir/filename).write_bytes(content)
                report.update(filename=filename,sha256=hashlib.sha256(content).hexdigest(),bytes=len(content))
                # Bound claims concern the explicit analytic certificates; real
                # DEM target_met applies only to source-grid samples.
                report['continuous_bound_available']=data['certificate'] is not None
                np.save(case_dir/f'{mode}-{tolerance:g}m.npy',prediction)
                pair.append(report)
            eligible=all(p['target_met'] for p in pair)
            variants.append({'target_m':tolerance,'hybrid':pair[0],'triangles':pair[1],'comparison_eligible':eligible,
                'native_file_saving_percent':100*(1-pair[0]['bytes']/pair[1]['bytes']) if eligible else None,
                'control_point_saving_percent':100*(1-pair[0]['points']/pair[1]['points']) if eligible else None})
            print(json.dumps({'case':data['id'],'target_m':tolerance,'hybrid_points':pair[0]['points'],
                'triangle_points':pair[1]['points'],'file_saving_percent':variants[-1]['native_file_saving_percent'],
                'target_met':[p['target_met'] for p in pair]}),flush=True)
        case_record={k:v for k,v in data.items() if k not in ('function','certificate','x','y','z')}
        case_record.update(source_shape=list(data['z'].shape),source_reference_sha256=hashlib.sha256((case_dir/'reference.npz').read_bytes()).hexdigest(),variants=variants)
        (case_dir/'results.json').write_text(json.dumps(case_record,indent=2)+'\n',encoding='utf-8')
        records.append(case_record)
        public=ROOT/f'frontend/public/research/hybrid-terrain/{data["id"]}.zip';public.parent.mkdir(parents=True,exist_ok=True)
        with ZipFile(public,'w',compression=ZIP_DEFLATED) as archive:
            for p in sorted(case_dir.glob('*.json')):archive.write(p,p.name)
            archive.write(case_dir/'reference.npz','reference.npz')
            archive.writestr('readme.txt','GUGIS finite-scale hybrid research dataset. Native JSON in local projection offsets, not georeferenced UK city terrain.\n'
                'Global tensor cuts, C0 shared boundaries. Pure triangles use the same cut family and target; not globally optimal triangulation or paper algorithm.\n'
                'Analytic cases include explicit cell error certificates. DEM case has finite-source sampling checks only.\n'
                'Results include model, diagnostics, seams/metadata, build validation and all errors; file saving may be negative.\n'
                'Swiss DEM attribution: ImplicitTerrain authors / swissALTI3D, Federal Office of Topography swisstopo.\n'
                'https://www.swisstopo.admin.ch/en/terms-of-use-free-geodata-and-geoservices\nNo author code or weights.\n')
    report={'schema':'gugis-finite-scale-hybrid-research-v1','generated_at':'2026-10-04',
        'paper':'https://arxiv.org/abs/1101.1452','method':'Error-driven global tensor refinement, two strip kinds, full finite-line and boundary residuals; C0 shared-edge partition. Triangle candidate examines both diagonals. Same representation fields and tolerance. Not greedy triangle bisection or proved global optimality.',
        'cost':'Complete uncompressed native JSON, including control XYZ, patch indices, metadata and implicit shared-edge topology. Results/diagnostics external to both model files; ZIP size not compared.',
        'certificate':'Analytic quadratics: exact extrema of interpolation error over each triangle, tensor bound for bilinear. Other C2 cases: conservative stated Hessian bounds. Sharp ridge: exact piecewise-linear breakpoint error. Real DEM: source-sample checks only.',
        'pending':['Rotated/general polygon patches','Local conforming anisotropic bisection baseline','Proved near-optimal mixed cost including seams','Independent real terrain data and continuous bounds','ArcGIS software runs'],
        'cases':records}
    (args.output/'results.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')


if __name__=='__main__':main()
