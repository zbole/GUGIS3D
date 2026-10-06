"""Fixed nonconstant-Hessian control, with an equal-budget P2 hierarchy."""
import hashlib,heapq,json,math,sys
from pathlib import Path
import numpy as np
import paper_metric_benchmark as paper
import principal_ruled_benchmark as principal
import principal_order_control as order
from research_triangle_strips import pack_triangle_strips
ROOT=principal.ROOT;PROTOCOL=ROOT/'data-pipeline/variable_curvature_protocol.json'
def sha(b):return hashlib.sha256(b).hexdigest()
def field_frame(angle):
    t=math.radians(angle);return np.array([[math.cos(t),-math.sin(t)],[math.sin(t),math.cos(t)]])
def value(xy,field,frame):return paper.quartic_value(np.asarray(xy)@frame,field)
def source_gradient(xy,field,frame):
    uv=np.asarray(xy)@frame;g=2*uv*np.asarray(field['quadratic'])+4*uv**3*np.asarray(field['quartic']);return g@frame.T
def p1_metrics(triangle,field,frame):return paper.quartic_metrics(np.asarray(triangle)@frame,field)
def paper_meshes(field,frame,budgets):
    heap=[];entries={};cache={};next_id=0;results=[]
    def metric(t):
        key=np.asarray(t,dtype=float).tobytes()
        if key not in cache:cache[key]=p1_metrics(t,field,frame)
        return cache[key]
    def insert(t):
        nonlocal next_id
        m=metric(t);entries[next_id]=(t,m);heapq.heappush(heap,(-m['l2_squared'],next_id));next_id+=1
    insert(np.array([[-50.,-50.],[50.,-50.],[50.,50.]]));insert(np.array([[-50.,-50.],[50.,50.],[-50.,50.]]))
    for n in budgets:
        while len(entries)<n:
            _,key=heapq.heappop(heap);t,_=entries.pop(key);costs=[sum(metric(c)['l1'] for c in paper.bisect(t,e)) for e in range(3)];edge=min(range(3),key=lambda e:(costs[e],e))
            for c in paper.bisect(t,edge):insert(c)
        results.append((n,[t.copy() for t,_ in entries.values()],{'e2_m2':math.sqrt(math.fsum(m['l2_squared'] for _,m in entries.values())),'linf_m':max(m['linf'] for _,m in entries.values()),'integrated_area_m2':math.fsum(m['area'] for _,m in entries.values())}))
    return results
def triangle_model(triangles,field,frame,degree=1):
    pool={};points=[];faces=[]
    def node(xy):
        key=tuple(xy)
        if key not in pool:pool[key]=len(points);points.append([*map(float,xy),float(value(xy,field,frame))])
        return pool[key]
    for t in triangles:
        if degree==1:faces.append([node(xy) for xy in t])
        else:
            a,b,c=t;faces.append([node(xy) for xy in [a,(a+b)/2,(a+c)/2,b,(b+c)/2,c]])
    patches=[{'kind':'triangle-strip','indices':ids} for ids in pack_triangle_strips(faces)] if degree==1 else [{'kind':'lagrange-triangle','degree':2,'indices':ids} for ids in faces]
    return principal.model(points,patches)
def ruled_grid(field,source_frame,frame,nx,ny):
    corners=np.array([[-50.,-50.],[50.,-50.],[50.,50.],[-50.,50.]])@frame;lo=corners.min(axis=0);hi=corners.max(axis=0);points=[];pool={};patches=[]
    for j in range(ny):
        for i in range(nx):
            curves=[]
            for jj in (j,j+1):
                uv=np.array([[lo[0]+(hi[0]-lo[0])*k/(2*nx),lo[1]+(hi[1]-lo[1])*jj/ny] for k in (2*i,2*i+1,2*i+2)]);xy=uv@frame.T;z=value(xy,field,source_frame);z[1]=2*z[1]-(z[0]+z[2])/2;ids=[]
                for kk,(p,h) in zip((2*i,2*i+1,2*i+2),zip(xy,z)):
                    key=(kk,jj)
                    if key not in pool:pool[key]=len(points);points.append([*map(float,p),float(h)])
                    elif abs(points[pool[key]][2]-h)>1e-9:raise ValueError('Ruled boundary not C0')
                    ids.append(pool[key])
                curves.append(ids)
            patches.append({'kind':'quadratic-ruled','left':curves[0],'right':curves[1]})
    return principal.model(points,patches)
def binary(model):return order.control_binary(model) if model['patches'][0]['kind']=='lagrange-triangle' else principal.binary(model)
def integrate(model,field,frame,nodes=5):
    t,w=np.polynomial.legendre.leggauss(nodes);t=(t+1)/2;w=w/2;u,v=np.meshgrid(t,t,indexing='ij');wu,wv=np.meshgrid(w,w,indexing='ij');b=u.ravel();c=((1-u)*v).ravel();a=1-b-c;weights=(wu*wv*(1-u)).ravel();errors=[];areas=[]
    for patch in model['patches']:
        if patch['kind']=='quadratic-ruled':
            query,left,right,_=principal.primitive_coefficients(model,patch);polygon=principal.clip_rectangle([left[0,:2],left[2,:2],right[2,:2],right[0,:2]],-50,50,-50,50);faces=[np.array([polygon[0],polygon[i],polygon[i+1]]) for i in range(1,len(polygon)-1)]
            for pa,pb,pc in faces:
                det=abs(float(np.linalg.det(np.column_stack((pb-pa,pc-pa)))));xy=a[:,None]*pa+b[:,None]*pb+c[:,None]*pc;residual=query(xy)-value(xy,field,frame);errors.append(float(np.dot(weights,residual**2))*det);areas.append(det/2)
        else:
            ids_list=[patch['indices']] if patch['kind']=='lagrange-triangle' else [patch['indices'][i:i+3] for i in range(len(patch['indices'])-2)]
            for ids in ids_list:
                p=np.array([model['points'][i] for i in ids]);pa,pb,pc=p[[0,3,5],:2] if patch['kind']=='lagrange-triangle' else p[:,:2];det=abs(float(np.linalg.det(np.column_stack((pb-pa,pc-pa)))));xy=a[:,None]*pa+b[:,None]*pb+c[:,None]*pc
                z=np.column_stack((a*(2*a-1),4*a*b,4*a*c,b*(2*b-1),4*b*c,c*(2*c-1)))@p[:,2] if patch['kind']=='lagrange-triangle' else a*p[0,2]+b*p[1,2]+c*p[2,2];errors.append(float(np.dot(weights,(z-value(xy,field,frame))**2))*det);areas.append(det/2)
    area=math.fsum(areas)
    if abs(area-10000)>1e-7:raise ValueError('Saved native model does not cover whole physical square')
    return {'e2_m2':math.sqrt(math.fsum(errors)),'integrated_area_m2':area,'rms_integral_m':math.sqrt(math.fsum(errors))/100}
def entry(model,name,extra):
    jb=principal.packed(model);bb=binary(model);return {'filename':name+'.json','bytes':len(jb),'sha256':sha(jb),'binary_filename':name+'.bin','binary_bytes':len(bb),'binary_sha256':sha(bb),'controls':len(model['points']),'patches':len(model['patches']),**extra}
def save(folder,model,e):(folder/e['filename']).write_bytes(principal.packed(model));(folder/e['binary_filename']).write_bytes(binary(model))
def build(folder):
    if folder.exists():raise FileExistsError('Fresh private study required')
    protocolraw=PROTOCOL.read_bytes();protocol=json.loads(protocolraw);folder.mkdir(parents=True);(folder/'protocol.json').write_bytes(protocolraw);parent=json.loads((ROOT/'shared/paper-terrain-metrics.json').read_bytes());cases=[]
    for field in protocol['fields']:
        for angle in protocol['angles_degrees']:
            frame=field_frame(angle);cid=field['id']+'-'+str(angle).zfill(2);out=folder/cid;out.mkdir();snapshots=paper_meshes(field,frame,protocol['p2_hierarchy_budgets']);p1s=[];p2s=[];saved={}
            for n,triangles,metrics in snapshots:
                if n in protocol['budgets']:
                    m=triangle_model(triangles,field,frame,1);measured=integrate(m,field,frame)
                    if abs(measured['e2_m2']-metrics['e2_m2'])>1e-8:raise ValueError('P1 whole-domain integral mismatch')
                    if angle==0 and field['id']=='published-quartic':
                        row=next(row for c in parent['cases'] if c['id']=='variable_curvature' for method in c['methods'] if method['id']=='paper_l2_l1' for row in method['rows'] if row['triangles']==n)
                        if row['e2_m2']!=metrics['e2_m2']:raise ValueError('Unrotated baseline changed from frozen paper experiment')
                    e=entry(m,'paper-p1-'+str(n),{'native_triangles':n,**metrics});save(out,m,e);p1s.append(e);saved[e['filename']]=m
                m=triangle_model(triangles,field,frame,2);e=entry(m,'hierarchy-p2-'+str(n),{'native_triangles':n,**integrate(m,field,frame)});save(out,m,e);p2s.append(e);saved[e['filename']]=m
            meanq=np.diag(np.asarray(field['quadratic'])+6*np.asarray(field['quartic'])*(10000/12));meanframe,eigen=principal.principal_frame(frame@meanq@frame.T);candidates=[];maximum=max(e['binary_bytes'] for e in p1s)
            for name,basis in [('world-x',np.eye(2)),('world-y',np.array([[0.,-1.],[1.,0.]])),('mean-hessian',meanframe)]:
                for nx in protocol['ruling_segments']:
                    for ny in protocol['across_segments']:
                        identity=name+'-'+str(nx)+'x'+str(ny);np_=((2*nx)+1)*(ny+1);patches=nx*ny;cost=48+24*np_+36*patches
                        if patches>max(protocol['budgets']) or cost>maximum:
                            candidates.append({'id':identity,'family':name,'nx':nx,'ny':ny,'controls':np_,'patches':patches,'binary_bytes':cost,'evaluated':False,'reason':'Exceeds every fixed P1 primitive or complete-file budget'});continue
                        m=ruled_grid(field,frame,basis,nx,ny);e=entry(m,identity,{'id':identity,'family':name,'nx':nx,'ny':ny,'evaluated':True,**integrate(m,field,frame)})
                        if e['binary_bytes']!=cost:raise ValueError('Predicted complete file cost differs')
                        candidates.append(e);save(out,m,e);saved[e['filename']]=m
            pairs=[]
            for p1,n in zip(p1s,protocol['budgets']):
                eligible=lambda e:e.get('evaluated',True) and e['patches']<=n and e['binary_bytes']<=p1['binary_bytes']
                choose=lambda pool:min((e for e in pool if eligible(e)),key=lambda e:(e['e2_m2'],e['binary_bytes'],e['filename']),default=None)
                pairs.append({'budget':n,'p1':p1,'world':choose([e for e in candidates if e['family'].startswith('world-')]),'mean_hessian':choose([e for e in candidates if e['family']=='mean-hessian']),'p2':choose(p2s)})
            cases.append({'id':cid,'name':field['name'],'field':field,'angle_degrees':angle,'source_frame':frame.tolist(),'mean_hessian_frame':meanframe.tolist(),'mean_q_eigenvalues':eigen,'p1_baselines':p1s,'p2_hierarchy':p2s,'candidates':candidates,'pairs':pairs});print(cid+': fixed full-domain curves and complete P2 hierarchy retained',flush=True)
    scripts=[PROTOCOL.relative_to(ROOT).as_posix(),'data-pipeline/variable_curvature_ruled.py','data-pipeline/paper_metric_benchmark.py','data-pipeline/principal_ruled_benchmark.py','data-pipeline/principal_order_control.py','data-pipeline/research_triangle_strips.py','data-pipeline/raster_l2_audit.py'];r={'schema':'gugis-variable-curvature-ruled-v1','protocol_sha256':sha(protocolraw),'scripts':{p:sha((ROOT/p).read_bytes().replace(b'\r\n',b'\n')) for p in scripts},'cases':cases,'scope':protocol['reporting'],'comparison':protocol['selection'],'direction':protocol['direction'],'integration':protocol['integration']};(folder/'results.json').write_bytes(principal.packed(r));return r
if __name__=='__main__':build(Path(sys.argv[1]))
