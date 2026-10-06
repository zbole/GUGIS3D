"""Fixed rotation study: principal-axis P2xP1 strips versus paper-style P1.

Whole-square integration and complete Float64 binary files, including all
overhanging controls and the clipping rectangle. Higher-order representation,
not a claim of better P1 bisection, a new asymptotic theorem or real-DTM success.
"""
import argparse
import hashlib
import heapq
import json
import math
from pathlib import Path
import struct
import numpy as np
from paper_metric_benchmark import metrics as triangle_metrics,bisect,choose_edge,aggregate,BUDGETS
from raster_l2_audit import clip_rectangle
from research_triangle_strips import pack_triangle_strips
ROOT=Path(__file__).resolve().parents[1]
ANGLES=(0,15,30,45,60,75,90)
DENSITIES=tuple(2**j for j in range(12))
DOMAIN=(-50.,-50.,50.,50.)
def sha(b):return hashlib.sha256(b).hexdigest()
def packed(m):return json.dumps(m,separators=(',',':'),allow_nan=False).encode()
def source_value(xy,q):return 30+np.einsum('...i,ij,...j->...',xy,q,xy)
def model(points,patches):return {'format':'gugis-research-surface','version':3,'coordinate_system':'LOCAL_METERS','clip_bounds':list(DOMAIN),'points':points,'patches':patches}
def binary(m):
    out=bytearray(struct.pack('<4sHHII4d',b'GPR3',3,1,len(m['points']),len(m['patches']),*m['clip_bounds']))
    for p in m['points']:out.extend(struct.pack('<3d',*p))
    for p in m['patches']:
        ruled=p['kind']=='quadratic-ruled';ids=p['left']+p['right'] if ruled else p['indices']
        out.extend(struct.pack('<BBHII',1 if ruled else 2,2 if ruled else 1,0,len(ids),0));out.extend(struct.pack('<'+'I'*len(ids),*ids))
    return bytes(out)
def paper_snapshots(q,budgets=BUDGETS):
    heap=[];entries={};next_id=0;results=[]
    def insert(t):
        nonlocal next_id
        m=triangle_metrics(t,q);entries[next_id]=(t,m);heapq.heappush(heap,(-m['l2_squared'],next_id));next_id+=1
    insert(np.array([[-50.,-50.],[50.,-50.],[50.,50.]]));insert(np.array([[-50.,-50.],[50.,50.],[-50.,50.]]))
    for n in budgets:
        while len(entries)<n:
            _,key=heapq.heappop(heap);t,_=entries.pop(key)
            for child in bisect(t,choose_edge(t,q,'paper_l2_l1')):insert(child)
        points=[];pool={};faces=[]
        for t,_ in entries.values():
            ids=[]
            for xy in t:
                key=tuple(xy)
                if key not in pool:pool[key]=len(points);points.append([*map(float,xy),float(source_value(xy,q))])
                ids.append(pool[key])
            faces.append(ids)
        m=model(points,[{'kind':'triangle-strip','indices':s} for s in pack_triangle_strips(faces)])
        results.append((m,aggregate(entries,q,n)))
    return results
def principal_frame(q):
    eigenvalues,eigenvectors=np.linalg.eigh(q);strong=eigenvectors[:,1]
    if strong[0]<-1e-14 or (abs(strong[0])<=1e-14 and strong[1]<0):strong=-strong
    return np.column_stack((strong,[-strong[1],strong[0]])),eigenvalues.tolist()
def ruled_model(q,frame,density):
    if density not in DENSITIES:raise ValueError('Outside fixed density pool')
    corners=np.array([[-50.,-50.],[50.,-50.],[50.,50.],[-50.,50.]])@frame
    lo=corners.min(axis=0);hi=corners.max(axis=0);points=[];pool={};patches=[]
    for j in range(density):
        curves=[]
        for across in (j,j+1):
            v=lo[1]+(hi[1]-lo[1])*across/density
            coords=np.array([[u,v] for u in (lo[0],(lo[0]+hi[0])/2,hi[0])])@frame.T
            z=source_value(coords,q);z[1]=2*z[1]-(z[0]+z[2])/2;ids=[]
            for k,(xy,h) in enumerate(zip(coords,z)):
                key=(k,across)
                if key not in pool:pool[key]=len(points);points.append([*map(float,xy),float(h)])
                elif abs(points[pool[key]][2]-h)>1e-10:raise ValueError('Nonconforming boundary')
                ids.append(pool[key])
            curves.append(ids)
        patches.append({'kind':'quadratic-ruled','left':curves[0],'right':curves[1]})
    return model(points,patches)
def primitive_coefficients(m,p):
    a,b=np.array([m['points'][i] for i in p['left']]),np.array([m['points'][i] for i in p['right']]);delta=b[:,2]-a[:,2]
    matrix=np.column_stack((a[2,:2]-a[0,:2],b[0,:2]-a[0,:2]));inverse=np.linalg.inv(matrix)
    c=np.array([a[0,2],2*(a[1,2]-a[0,2]),a[0,2]-2*a[1,2]+a[2,2],delta[0],2*(delta[1]-delta[0]),delta[0]-2*delta[1]+delta[2]])
    def query(xy):
        uv=(xy-a[0,:2])@inverse.T;u,v=uv[:,0],uv[:,1]
        return c[0]+u*(c[1]+u*c[2])+v*(c[3]+u*(c[4]+u*c[5]))
    return query,a,b,inverse
def ruled_metrics(m,q,nodes=3):
    t,w=np.polynomial.legendre.leggauss(nodes);t=(t+1)/2;w=w/2;u,v=np.meshgrid(t,t,indexing='ij');wu,wv=np.meshgrid(w,w,indexing='ij')
    sites_uv=np.column_stack((u.ravel(),v.ravel()));weights=(wu*wv*(1-u)).ravel();areas=[];errors=[];maximum=0.;witness=None
    for p in m['patches']:
        query,a,b,inverse=primitive_coefficients(m,p);polygon=clip_rectangle([a[0,:2],a[2,:2],b[2,:2],b[0,:2]],-50,50,-50,50)
        if len(polygon)<3:continue
        for i in range(1,len(polygon)-1):
            pa,pb,pc=np.array([polygon[0],polygon[i],polygon[i+1]]);det=abs(float(np.linalg.det(np.column_stack((pb-pa,pc-pa)))))
            if det<1e-16:continue
            xy=pa+sites_uv[:,0,None]*(pb-pa)+(1-sites_uv[:,0,None])*sites_uv[:,1,None]*(pc-pa)
            residual=query(xy)-source_value(xy,q);errors.append(float(np.dot(weights,residual*residual))*det);areas.append(det/2)
        # Quadratic source has residual Q(across,across)*v*(1-v).
        # Find a point on the clipped polygon at the constrained maximum v.
        polygon=np.asarray(polygon);vs=((polygon-a[0,:2])@inverse.T)[:,1];peak=float(np.clip(.5,vs.min(),vs.max()))
        candidates=[]
        for j in range(len(polygon)):
            k=(j+1)%len(polygon)
            if abs(vs[j]-peak)<1e-12:candidates.append(polygon[j])
            if (vs[j]-peak)*(vs[k]-peak)<0:candidates.append(polygon[j]+(peak-vs[j])/(vs[k]-vs[j])*(polygon[k]-polygon[j]))
        if not candidates:raise ValueError('Missing continuous maximum witness')
        xy=np.mean(candidates,axis=0);error=abs(float(query(xy[None,:])[0]-source_value(xy,q)))
        if error>maximum:maximum=error;witness={'x':float(xy[0]),'y':float(xy[1]),'absolute_error_m':error}
    area=math.fsum(areas)
    if abs(area-10000)>1e-7:raise ValueError('Incomplete clipped native coverage')
    e2=math.sqrt(math.fsum(errors));guard=1e-9+float(np.linalg.norm(q))*10000*1e-12
    return {'e2_m2':e2,'integrated_area_m2':area,'rms_integral_m':e2/100,'maximum_residual_m':maximum,'continuous_bound_m':maximum+guard,'maximum_witness':witness,'float64_guard_m':guard}
def entry(m,filename,extra):
    jb=packed(m);bb=binary(m);return {'filename':filename+'.json','bytes':len(jb),'sha256':sha(jb),'binary_filename':filename+'.bin','binary_bytes':len(bb),'binary_sha256':sha(bb),'controls':len(m['points']),'patches':len(m['patches']),**extra}
def save(folder,m,e):
    (folder/e['filename']).write_bytes(packed(m));(folder/e['binary_filename']).write_bytes(binary(m))
def build(folder):
    if folder.exists():raise FileExistsError('Fresh private output required')
    folder.mkdir(parents=True);scripts=['data-pipeline/principal_ruled_benchmark.py','data-pipeline/paper_metric_benchmark.py','data-pipeline/research_triangle_strips.py','data-pipeline/raster_l2_audit.py','backend/app/services/terrain_triangles.py']
    report={'schema':'gugis-principal-ruled-v1','angles_degrees':list(ANGLES),'densities':list(DENSITIES),'budgets':list(BUDGETS),'domain_m':list(DOMAIN),'curvatures':[.004,.00004],
      'scripts':{p:sha((ROOT/p).read_bytes().replace(b'\r\n',b'\n')) for p in scripts},
      'scope':'Seven fixed global SPD quadratic fields, not real DTM or variable Hessian. Higher-order P2xP1 versus paper-style vertex P1 interpolation; P2 triangles can represent these quadratics exactly. No paper-author code, ArcGIS run, CPU timing or asymptotic optimality claim.',
      'comparison':'Shared Float64 XYZ pool and 12-byte native patch records in GPR3 binary, identical 48-byte header including clip rectangle. Complete overhanging controls counted. Directional ruled pool has one segment along the quadratic axis and fixed densities across the linear axis. Select minimum whole-domain E2 under BOTH full P1 binary bytes and primitive-count N ceilings.',
      'accuracy':'Exact-degree Gauss integration of saved model residual squared over each clipped parallelogram; binary64 rounding, not interval proof. Native queries use common square clipping. Paper bisection is nonconforming, no added C0 closure. Ruled shared boundaries are C0. Principal frame from exact constant analytic Hessian, not estimated noisy DTM.', 'cases':[]}
    for angle in ANGLES:
        theta=math.radians(angle);r=np.array([[math.cos(theta),-math.sin(theta)],[math.sin(theta),math.cos(theta)]]);q=r@np.diag([.004,.00004])@r.T;principal,eigen=principal_frame(q)
        cid=f'angle-{angle:02d}';out=folder/cid;out.mkdir();c={'id':cid,'angle_degrees':angle,'q_matrix':q.tolist(),'principal_frame':principal.tolist(),'eigenvalues':eigen,'candidates':[],'pairs':[]};models={}
        for name,frame in [('world-x',np.eye(2)),('world-y',np.array([[0.,-1.],[1.,0.]])),('principal',principal)]:
            for density in DENSITIES:
                identity=f'{name}-{density}';m=ruled_model(q,frame,density);e=entry(m,identity,{'id':identity,'family':name,'density':density,**ruled_metrics(m,q)});c['candidates'].append(e);models[identity]=m
        for n,(m,metrics) in zip(BUDGETS,paper_snapshots(q)):
            p1=entry(m,f'paper-p1-{n}',{'native_triangles':n,**metrics});save(out,m,p1);pair={'budget':n,'p1':p1}
            for name in ('world','principal'):
                pool=[e for e in c['candidates'] if (e['family']=='principal' if name=='principal' else e['family'].startswith('world-')) and e['patches']<=n and e['binary_bytes']<=p1['binary_bytes']]
                best=min(pool,key=lambda e:(e['e2_m2'],e['binary_bytes'],e['id'])) if pool else None
                pair[name]=best
                if best:save(out,models[best['id']],best)
            c['pairs'].append(pair)
        report['cases'].append(c);print(json.dumps({'angle':angle,'at_N2048':{k:(v['e2_m2'] if isinstance(v,dict) else v) for k,v in c['pairs'][-1].items()}}),flush=True)
    (folder/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf8',newline='\n')

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True);build(p.parse_args().output)
