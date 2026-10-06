"""Release the preregistered nonconstant-Hessian study without dropping losses."""
import csv
import io
import json
import math
from pathlib import Path
import shutil
import zipfile
import numpy as np
import variable_curvature_ruled as producer
from plot_variable_curvature import plot
ROOT=producer.ROOT
DEST=ROOT/'frontend/public/research/variable-curvature-v1'
SUMMARY=ROOT/'shared/variable-curvature-display-v1.json'
sha=producer.sha

def source(xy,field,frame):
    uv=xy@frame
    return 30+field['quadratic'][0]*uv[:,0]**2+field['quadratic'][1]*uv[:,1]**2+field['quartic'][0]*uv[:,0]**4+field['quartic'][1]*uv[:,1]**4

def clip(polygon):
    """Independent Sutherland-Hodgman clipping to the physical experiment square."""
    out=[np.array(p,dtype=float) for p in polygon]
    for axis,bound,sign in [(0,-50,1),(0,50,-1),(1,-50,1),(1,50,-1)]:
        inp=out;out=[]
        for i,b in enumerate(inp):
            a=inp[i-1];ai=sign*(a[axis]-bound)>=0;bi=sign*(b[axis]-bound)>=0
            if ai!=bi:
                t=(bound-a[axis])/(b[axis]-a[axis]);out.append(a+t*(b-a))
            if bi:out.append(b)
    return out

def integral(model,field,frame):
    """Independent seven-node Gauss-Duffy and Bernstein/barycentric evaluation."""
    t,w=np.polynomial.legendre.leggauss(7);t=(t+1)/2;w=w/2
    u,v=np.meshgrid(t,t,indexing='ij');wu,wv=np.meshgrid(w,w,indexing='ij')
    b=u.ravel();c=((1-u)*v).ravel();a=1-b-c;weights=(wu*wv*(1-u)).ravel()
    residuals=[];areas=[];primitives=0
    points=np.array(model['points'])
    for patch in model['patches']:
        if patch['kind']=='quadratic-ruled':
            left,right=points[patch['left']],points[patch['right']]
            pa,pb,pc=left[0,:2],left[2,:2],right[0,:2]
            inverse=np.linalg.inv(np.column_stack((pb-pa,pc-pa)))
            poly=clip([left[0,:2],left[2,:2],right[2,:2],right[0,:2]])
            faces=[np.array([poly[0],poly[i],poly[i+1]]) for i in range(1,len(poly)-1)]
            def evaluate(xy):
                uv=(xy-pa)@inverse.T;s,r=uv[:,0],uv[:,1]
                basis=np.column_stack(((1-s)**2,2*s*(1-s),s**2))
                return (1-r)*(basis@left[:,2])+r*(basis@right[:,2])
            primitives+=1
        else:
            ids=patch['indices'];indices=[ids] if patch['kind']=='lagrange-triangle' else [ids[i:i+3] for i in range(len(ids)-2)]
            faces=[];evaluators=[]
            for idx in indices:
                nodes=points[idx];vertices=nodes[[0,3,5],:2] if patch['kind']=='lagrange-triangle' else nodes[:,:2]
                faces.append(vertices);evaluators.append(nodes)
            primitives+=len(faces)
        for j,(p0,p1,p2) in enumerate(faces):
            det=abs(float(np.linalg.det(np.column_stack((p1-p0,p2-p0)))))
            xy=a[:,None]*p0+b[:,None]*p1+c[:,None]*p2
            if patch['kind']=='quadratic-ruled':z=evaluate(xy)
            elif patch['kind']=='lagrange-triangle':
                nodes=evaluators[j];z=(a*(2*a-1)*nodes[0,2]+4*a*b*nodes[1,2]+4*a*c*nodes[2,2]+b*(2*b-1)*nodes[3,2]+4*b*c*nodes[4,2]+c*(2*c-1)*nodes[5,2])
            else:
                nodes=evaluators[j];z=a*nodes[0,2]+b*nodes[1,2]+c*nodes[2,2]
            residuals.append(float(np.dot(weights,(z-source(xy,field,frame))**2))*det);areas.append(det/2)
    area=math.fsum(areas)
    if abs(area-10000)>1e-7:raise ValueError('Independent domain area failed')
    return math.sqrt(math.fsum(residuals)),area,primitives

def checked(path,digest,size):
    b=path.read_bytes()
    if sha(b)!=digest or len(b)!=size:raise ValueError('Evidence changed: '+str(path))
    return b

def verify(folder):
    raw=(folder/'results.json').read_bytes();report=json.loads(raw)
    protocolraw=(folder/'protocol.json').read_bytes();protocol=json.loads(protocolraw)
    ar=(folder/'native-audit.json').read_bytes();audit=json.loads(ar)
    if protocolraw!=producer.PROTOCOL.read_bytes() or sha(protocolraw)!=report['protocol_sha256']:raise ValueError('Fixed protocol changed')
    if report['schema']!='gugis-variable-curvature-ruled-v1' or audit['report_sha256']!=sha(raw):raise ValueError('Audit/report identity differs')
    scripts={**report['scripts'],**audit['scripts']}
    for p,digest in scripts.items():
        if sha((ROOT/p).read_bytes().replace(b'\r\n',b'\n'))!=digest:raise ValueError('Implementation changed: '+p)
    cases=[(f,angle) for f in protocol['fields'] for angle in protocol['angles_degrees']]
    if [(c['field'],c['angle_degrees']) for c in report['cases']]!=cases:raise ValueError('Missing/reordered fixed case')
    auditrows={(r['case_id'],r['filename']):r for r in audit['models']};expected=set();integrals=[]
    for case in report['cases']:
        field=case['field'];frame=producer.field_frame(case['angle_degrees']);out=folder/case['id']
        if frame.tolist()!=case['source_frame'] or [p['budget'] for p in case['pairs']]!=protocol['budgets']:raise ValueError('Changed source/domain/budget series')
        candidates=[f'{family}-{nx}x{ny}' for family in protocol['frames'] for nx in protocol['ruling_segments'] for ny in protocol['across_segments']]
        if [e['id'] for e in case['candidates']]!=candidates:raise ValueError('Candidate pool incomplete')
        # Replay the immutable paper hierarchy, including every higher-order control size.
        snapshots=producer.paper_meshes(field,frame,protocol['p2_hierarchy_budgets'])
        for n,triangles,metrics in snapshots:
            for degree,entries in [(1,case['p1_baselines']),(2,case['p2_hierarchy'])]:
                entry=next((e for e in entries if e['native_triangles']==n),None)
                if entry is None:
                    if degree==1 and n not in protocol['budgets']:continue
                    raise ValueError('Missing hierarchy control')
                model=producer.triangle_model(triangles,field,frame,degree)
                if producer.principal.packed(model)!=checked(out/entry['filename'],entry['sha256'],entry['bytes']) or producer.binary(model)!=checked(out/entry['binary_filename'],entry['binary_sha256'],entry['binary_bytes']):raise ValueError('Hierarchy geometry differs')
                if degree==1:
                    for key,val in metrics.items():
                        if entry[key]!=val:raise ValueError('Paper metric changed')
        meanframe,eigen=producer.principal.principal_frame(frame@np.diag(np.asarray(field['quadratic'])+6*np.asarray(field['quartic'])*(10000/12))@frame.T)
        if case['mean_hessian_frame']!=meanframe.tolist() or case['mean_q_eigenvalues']!=eigen:raise ValueError('Mean Hessian differs')
        ceiling=max(e['binary_bytes'] for e in case['p1_baselines'])
        for e in case['candidates']:
            nx,ny=e['nx'],e['ny'];nodes=(2*nx+1)*(ny+1);cost=48+24*nodes+36*nx*ny
            if e['controls']!=nodes or e['patches']!=nx*ny or e['binary_bytes']!=cost:raise ValueError('Full overhanging file accounting changed')
            eligible=nx*ny<=max(protocol['budgets']) and cost<=ceiling
            if e['evaluated']!=eligible:raise ValueError('Feasibility exclusion changed')
            if not eligible:continue
            basis=meanframe if e['family']=='mean-hessian' else np.eye(2) if e['family']=='world-x' else np.array([[0.,-1.],[1.,0.]])
            model=producer.ruled_grid(field,frame,basis,nx,ny)
            if producer.principal.packed(model)!=checked(out/e['filename'],e['sha256'],e['bytes']) or producer.binary(model)!=checked(out/e['binary_filename'],e['binary_sha256'],e['binary_bytes']):raise ValueError('Ruled candidate geometry differs')
        entries=[*case['p1_baselines'],*case['p2_hierarchy'],*(e for e in case['candidates'] if e['evaluated'])]
        if {p.name for p in out.iterdir()}!={e[k] for e in entries for k in ['filename','binary_filename']}:raise ValueError('Extra or missing native files')
        for e in entries:
            rawmodel=checked(out/e['filename'],e['sha256'],e['bytes']);checked(out/e['binary_filename'],e['binary_sha256'],e['binary_bytes'])
            model=json.loads(rawmodel);error,area,count=integral(model,field,frame)
            if abs(error-e['e2_m2'])>1e-9*max(1,error) or count!=e.get('native_triangles',e['patches']) or len(model['points'])!=e['controls']:raise ValueError('Independent saved-function integration failed')
            key=(case['id'],e['filename']);expected.add(key);a=auditrows[key]
            if a['binary_sha256']!=e['binary_sha256'] or a['queries']!=1024 or a['max_independent_height_difference_m']>=1e-8 or a['max_independent_gradient_difference']>=1e-8 or a['coverage_corners']!=4 or not a['outside_rejected']:raise ValueError('Incomplete native audit')
            integrals.append({'case_id':case['id'],'filename':e['filename'],'e2_m2':error,'area_m2':area,'native_primitives':count,'producer_difference_m2':abs(error-e['e2_m2'])})
        for pair in case['pairs']:
            p1=next(e for e in case['p1_baselines'] if e['native_triangles']==pair['budget'])
            if p1!=pair['p1']:raise ValueError('P1 budget identity differs')
            choose=lambda entries:min((e for e in entries if e.get('evaluated',True) and e['patches']<=pair['budget'] and e['binary_bytes']<=p1['binary_bytes']),key=lambda e:(e['e2_m2'],e['binary_bytes'],e['filename']),default=None)
            for key,pool in [('world',[e for e in case['candidates'] if e['family'].startswith('world-')]),('mean_hessian',[e for e in case['candidates'] if e['family']=='mean-hessian']),('p2',case['p2_hierarchy'])]:
                if pair[key]!=choose(pool):raise ValueError('Joint ceiling selection differs')
        print(case['id']+': full hierarchy replay, every feasible candidate and independent seven-node integral passed',flush=True)
    if set(auditrows)!=expected or len(audit['models'])!=len(expected) or audit['total_internal_queries']!=1024*len(expected):raise ValueError('Native audit coverage differs')
    return report,raw,ar,protocolraw,scripts,integrals

def publish(folder):
    if DEST.exists() or SUMMARY.exists():raise FileExistsError('Published evidence must be immutable')
    report,raw,ar,protocolraw,scripts,integrals=verify(folder)
    DEST.mkdir(parents=True);(DEST/'results.json').write_bytes(raw);(DEST/'native-audit.json').write_bytes(ar);(DEST/'protocol.json').write_bytes(protocolraw)
    ir=producer.principal.packed({'schema':'gugis-variable-curvature-integral-audit-v1','report_sha256':sha(raw),'quadrature_nodes':7,'evaluation':'Independent Bernstein / barycentric nodal basis; independently clipped physical square','rows':integrals})
    (DEST/'integral-audit.json').write_bytes(ir)
    for c in report['cases']:
        shutil.copytree(folder/c['id'],DEST/c['id'])
    rows=[]
    for c in report['cases']:
        for p in c['pairs']:
            row={'field':c['field']['id'],'angle_degrees':c['angle_degrees'],'budget_N':p['budget']}
            for name in ['p1','world','mean_hessian','p2']:
                e=p[name];row[name+'_e2_m2']=e['e2_m2'] if e else '';row[name+'_binary_bytes']=e['binary_bytes'] if e else '';row[name+'_native_primitives']=e.get('native_triangles',e['patches']) if e else '';row[name+'_file']=e['binary_filename'] if e else ''
            rows.append(row)
    stream=io.StringIO(newline='');writer=csv.DictWriter(stream,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows);(DEST/'pairs.csv').write_bytes(stream.getvalue().encode())
    plot(report,DEST/'variable-curvature-results.svg')
    (DEST/'README.txt').write_text('Prerecorded fixed 2 fields x 7 rotations x 9 P1 budgets = 126 pairs. All 2520 candidates remain in the raw report; only candidates infeasible for every budget are not evaluated. All 2071 evaluated P1/P2/ruled files and independent native queries retained.\nEvery method covers the same 100x100m physical square. Same GPR3 encoding, complete Float64 control points, indices, patch records and clipping header; overhanging controls count. Ruled and P2 selections obey BOTH P1 file bytes and primitive budget.\nP1 follows the frozen L2 greedy / L1 edge-decision bisection, without C0 closure. P2 is nodal interpolation on this fixed P1 hierarchy, not a globally optimal P2 algorithm.\nRuled method uses P2xP1 quadratic boundaries with 1..32 segments, 1..512 cross-band intervals; fixed world axes or analytic domain-mean Hessian. Mean direction is not always better on nonconstant-curvature surfaces.\nWhole-domain E2 is square root of integrated squared height residual, in m2. Five-node producer integrals independently checked at seven nodes using saved functions and separate basis evaluation/clipping. Float64, not interval proof. Query RMS/max are sampled diagnostics, not integral error/global maximum.\nNo author-original execution, ArcGIS performance, GPU/CPU timings, RAM or surveyed ground accuracy. All losses and ties remain visible.\n',encoding='utf8',newline='\n')
    scripts={**scripts,'data-pipeline/publish_variable_curvature.py':sha(Path(__file__).read_bytes().replace(b'\r\n',b'\n')),'data-pipeline/plot_variable_curvature.py':sha((ROOT/'data-pipeline/plot_variable_curvature.py').read_bytes().replace(b'\r\n',b'\n'))}
    impl=DEST/'implementations';impl.mkdir()
    for p in scripts:(impl/Path(p).name).write_bytes((ROOT/p).read_bytes().replace(b'\r\n',b'\n'))
    with zipfile.ZipFile(DEST/'variable-curvature-evidence.zip','x',compression=zipfile.ZIP_DEFLATED) as archive:
        for p in sorted(DEST.rglob('*')):
            if p.is_file() and p.suffix!='.zip':
                info=zipfile.ZipInfo('variable-curvature-v1/'+p.relative_to(DEST).as_posix(),date_time=(2026,10,6,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;archive.writestr(info,p.read_bytes(),compresslevel=9)
    package=(DEST/'variable-curvature-evidence.zip').read_bytes()
    summary={k:v for k,v in report.items() if k not in ['cases','scripts']}
    summary.update(cases=[{k:v for k,v in c.items() if k not in ['candidates','p1_baselines','p2_hierarchy']} for c in report['cases']],scripts=scripts,report_sha256=sha(raw),native_audit_sha256=sha(ar),integral_audit_sha256=sha(ir),native_model_count=len(integrals),native_internal_queries=1024*len(integrals),pairs_csv_sha256=sha((DEST/'pairs.csv').read_bytes()),figure_sha256=sha((DEST/'variable-curvature-results.svg').read_bytes()),package={'filename':'variable-curvature-evidence.zip','bytes':len(package),'sha256':sha(package)})
    body=(json.dumps(summary,ensure_ascii=False,indent=2,allow_nan=False)+'\n').encode();SUMMARY.write_bytes(body);(DEST/'publication.json').write_bytes(body)
    print('Published all 126 pairs and '+str(len(integrals))+' independently verified native functions',flush=True)

if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('folder',type=Path);publish(parser.parse_args().folder)
