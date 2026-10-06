"""Publish every real C0 hybrid candidate after independent saved-function QA."""
import argparse,csv,io,json,math,shutil,zipfile
from pathlib import Path
import numpy as np
import hybrid_source_benchmark as producer
import hybrid_source_audit as independent
from plot_hybrid_source import plot
ROOT=producer.ROOT;sha=producer.sha;packed=producer.packed
DEST=ROOT/'frontend/public/research/hybrid-source-v1';SUMMARY=ROOT/'shared/hybrid-source-display-v1.json'
def checked(p,digest,size=None):
    b=p.read_bytes()
    if sha(b)!=digest or size is not None and len(b)!=size:raise ValueError('Evidence changed: '+str(p))
    return b
def verify(folder):
    raw=(folder/'results.json').read_bytes();r=json.loads(raw);protocolraw=(folder/'protocol.json').read_bytes();protocol=json.loads(protocolraw);parentraw=(folder/'source-report.json').read_bytes();parent=json.loads(parentraw);ar=(folder/'native-audit.json').read_bytes();audit=json.loads(ar)
    if protocolraw!=producer.PROTOCOL.read_bytes() or sha(protocolraw)!=r['protocol_sha256'] or sha(parentraw)!=r['source_report_sha256'] or parentraw!=(ROOT/protocol['source_report']).read_bytes() or audit['report_sha256']!=sha(raw):raise ValueError('Fixed protocol / source / audit changed')
    sourcepublication=json.loads((ROOT/'shared/source-native-bands-v1.json').read_bytes());scripts={**r['scripts'],**audit['scripts']}
    for p,h in scripts.items():checked(ROOT/p,h) if p.endswith('.json') else checked_text(ROOT/p,h)
    if [c['id'] for c in r['cases']]!=[c['id'] for c in parent['cases']] or len(r['cases'])!=20:raise ValueError('Incomplete or altered fixed cases')
    rows={(x['case_id'],x['filename']):x for x in audit['models']};expected=set();integrals=[];validated=set();total_seams=0
    for c,p in zip(r['cases'],parent['cases']):
        ref,refraw=producer.load_reference(p,validated);out=folder/c['id'];checked(out/'reference.json',c['reference_sha256']);published=next(v for v in sourcepublication['cases'] if v['id']==c['id']);crop=published['source_geotiff'];checked(out/'source-window.tif',crop['sha256'],crop['bytes'])
        if c['source_geotiff']!={'filename':'source-window.tif','bytes':crop['bytes'],'sha256':crop['sha256']} or c['origin_bng']!=p['origin_bng'] or c['source_identity']!=p['source_identity']:raise ValueError('Original input metadata differs')
        names=[f'{family}-{nx}x{ny}' for nx in protocol['axis_cells'] for ny in protocol['axis_cells'] for family in protocol['methods']]
        if [e['id'] for e in c['candidates']]!=names:raise ValueError('Missing grid/family candidates')
        measurements={}
        for e in c['candidates']:
            jr=checked(out/e['filename'],e['sha256'],e['bytes']);br=checked(out/e['binary_filename'],e['binary_sha256'],e['binary_bytes']);m=json.loads(jr);families=e['families'];nx,ny=e['nx'],e['ny']
            canonical=producer.hybrid.make_model(ref,nx,ny,families)
            if jr!=packed(canonical) or br!=producer.binary(canonical) or len(m['points'])!=e['stored_points'] or len(m['patches'])!=e['stored_patches'] or len(families)!=nx*ny:raise ValueError('Saved native geometry, sharing or records differ')
            if families.count('ruled')!=e['ruled_cells'] or 2*families.count('p1')!=e['p1_triangles'] or e['native_primitives']!=e['ruled_cells']+e['p1_triangles']:raise ValueError('Native primitive accounting differs')
            independent_values=independent.audit(ref,m,nx,ny,families);measurements[e['id']]=independent_values
            for key in ['e2_m2','continuous_maximum_m','integrated_area_m2']:
                if abs(independent_values[key]-e[key])>1e-8*max(1,abs(e[key])):raise ValueError('Independent source-relative metric differs')
            if e['continuous_bound_m']!=e['continuous_maximum_m']+e['float64_guard_m']:raise ValueError('Maximum-error guard changed')
            key=(c['id'],e['filename']);expected.add(key);a=rows[key];seams=7*((nx-1)*ny+(ny-1)*nx);total_seams+=seams
            if a['binary_sha256']!=e['binary_sha256'] or a['queries']!=5249 or a['independent_height_difference_m']>=1e-8 or a['independent_gradient_difference']>=1e-8 or a['seam_height_pairs']!=seams or not a['maximum_witness_verified'] or not a['outside_rejected']:raise ValueError('Incomplete native/continuity audit')
            integrals.append({'case_id':c['id'],'filename':e['filename'],**{k:v for k,v in independent_values.items() if k!='cell_l2_squared'},'producer_e2_difference_m2':abs(independent_values['e2_m2']-e['e2_m2']),'producer_maximum_difference_m':abs(independent_values['continuous_maximum_m']-e['continuous_maximum_m'])})
        for nx in protocol['axis_cells']:
            for ny in protocol['axis_cells']:
                rr=measurements[f'ruled-{nx}x{ny}']['cell_l2_squared'];pp=measurements[f'p1-{nx}x{ny}']['cell_l2_squared'];hh=measurements[f'hybrid-{nx}x{ny}']['cell_l2_squared'];entry=next(e for e in c['candidates'] if e['id']==f'hybrid-{nx}x{ny}')
                for family,a,b,actual in zip(entry['families'],rr,pp,hh):
                    selected=a if family=='ruled' else b
                    if abs(actual-selected)>1e-9*max(1,abs(selected)) or selected>min(a,b)+1e-9*max(1,abs(a),abs(b)):raise ValueError('Hybrid cell does not select the smaller independent integral')
        pairs,targets=producer.choices(c['candidates'],protocol)
        if pairs!=c['byte_pairs'] or targets!=c['target_pairs']:raise ValueError('Changed full-byte / guarded-maximum selection')
        expectedfiles={'reference.json','source-window.tif'}|{e[k] for e in c['candidates'] for k in ['filename','binary_filename']}
        if {p.name for p in out.iterdir()}!=expectedfiles:raise ValueError('Extra or missing source/native files')
        print(c['id']+': all 147 saved functions, diagonal maxima, C0 seams and local hybrid selections rechecked',flush=True)
    if set(rows)!=expected or len(audit['models'])!=len(expected) or audit['total_queries']!=len(expected)*5249 or audit['seam_height_pairs']!=total_seams:raise ValueError('Audit does not cover all candidates')
    return r,raw,ar,protocolraw,parentraw,scripts,integrals
def checked_text(path,digest):
    if sha(path.read_bytes().replace(b'\r\n',b'\n'))!=digest:raise ValueError('Bound implementation changed: '+str(path))
def slim(e):return {k:v for k,v in e.items() if k!='families'} if e else None
def publish(folder):
    if DEST.exists() or SUMMARY.exists():raise FileExistsError('Published version cannot be overwritten')
    r,raw,ar,protocolraw,parentraw,scripts,integrals=verify(folder);DEST.mkdir(parents=True)
    for name,b in [('results.json',raw),('native-audit.json',ar),('protocol.json',protocolraw),('source-report.json',parentraw)]:(DEST/name).write_bytes(b)
    ir=packed({'schema':'gugis-hybrid-source-integral-audit-v1','report_sha256':sha(raw),'quadrature_nodes':5,'basis':'Independent nodal Bernstein/barycentric evaluation; independent source-cell diagonal clipping; local family choices checked against both complete per-cell integrals','rows':integrals});(DEST/'integral-audit.json').write_bytes(ir)
    parent=json.loads((ROOT/'shared/source-native-bands-v1.json').read_bytes());cases=[];csvrows=[]
    for c in r['cases']:
        shutil.copytree(folder/c['id'],DEST/c['id']);published=next(v for v in parent['cases'] if v['id']==c['id']);case={k:v for k,v in c.items() if k not in ['candidates','byte_pairs','target_pairs']};case['regular_grid']={'url':'/research/source-native-bands-v1/'+c['id']+'/regular-grid.bin',**published['regular_grid']};case['full_source_ruled_bytes']=next(e for e in c['candidates'] if e['id']=='ruled-64x64')['binary_bytes']
        for key in ['byte_pairs','target_pairs']:case[key]=[{k:slim(v) if k in ['ruled','p1','hybrid'] else v for k,v in row.items()} for row in c[key]]
        cases.append(case)
        for kind,key in [('file-budget','byte_pairs'),('maximum-target','target_pairs')]:
            for row in c[key]:
                for family in ['ruled','p1','hybrid']:
                    e=row[family];csvrows.append({'site':c['id'],'selection':kind,'byte_ceiling':row.get('byte_ceiling',''),'maximum_target_m':row.get('height_target_m',''),'method':family,'available':bool(e),'binary_bytes':e['binary_bytes'] if e else '', 'e2_m2':e['e2_m2'] if e else '', 'continuous_bound_m':e['continuous_bound_m'] if e else '', 'ruled_cells':e['ruled_cells'] if e else '', 'p1_triangles':e['p1_triangles'] if e else '', 'nx':e['nx'] if e else '', 'ny':e['ny'] if e else '', 'binary_file':e['binary_filename'] if e else ''})
    stream=io.StringIO(newline='');writer=csv.DictWriter(stream,fieldnames=list(csvrows[0]));writer.writeheader();writer.writerows(csvrows);(DEST/'selections.csv').write_bytes(stream.getvalue().encode());plot(r,DEST/'hybrid-source-results.svg')
    (DEST/'README.txt').write_text('All 20 frozen original 1m DTM windows; 49 fixed tensor grids x 3 methods = 2940 complete native candidates. Ruled bilinear, antidiagonal P1 triangles and local smaller-L2 mixtures. All source-node heights preserved at retained shared corners, no source rounding.\nC0: a common tensor grid without T junctions; both native cell types restrict to the same linear edge function. No C1 gradient claim. This is local source-function approximation, not surveyed ground, a globally optimal adaptive mesh, a paper-style P1 algorithm or ArcGIS software.\n200 complete-file byte-budget rows and 120 guarded continuous maximum-error targets, including absent P1 solutions and all losses. Whole-domain E2 and continuous maximum independently recalculated using saved models with five-node full-cell/diagonal-cut integration and diagonal stationary points. Float64 guard, not interval proof.\nAll actual GPR4 bytes include the same BNG/ODN/clip header, shared Float64 XYZ and all split-run record/index overhead. A mixed grid can cost more than pure grids even with lower E2. Maximum-target choice and E2-based local family choice need not prefer the same model.\nAll original source crops and reference values, native functions, SHA receipts, audits and implementations included. No query timing, rendering/GPU, RAM or universal high-order/raster superiority claim.\n',encoding='utf8',newline='\n')
    for path in ['data-pipeline/hybrid_source_audit.py','data-pipeline/publish_hybrid_source.py','data-pipeline/plot_hybrid_source.py']:scripts[path]=sha((ROOT/path).read_bytes().replace(b'\r\n',b'\n'))
    impl=DEST/'implementations';impl.mkdir()
    for p in scripts:(impl/Path(p).name).write_bytes((ROOT/p).read_bytes().replace(b'\r\n',b'\n'))
    with zipfile.ZipFile(DEST/'hybrid-source-evidence.zip','x',compression=zipfile.ZIP_DEFLATED) as archive:
        for p in sorted(DEST.rglob('*')):
            if p.is_file() and p.suffix!='.zip':
                info=zipfile.ZipInfo('hybrid-source-v1/'+p.relative_to(DEST).as_posix(),date_time=(2026,10,6,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;archive.writestr(info,p.read_bytes(),compresslevel=9)
    b=(DEST/'hybrid-source-evidence.zip').read_bytes();summary={k:v for k,v in r.items() if k not in ['cases','scripts']};summary.update(cases=cases,scripts=scripts,report_sha256=sha(raw),native_audit_sha256=sha(ar),integral_audit_sha256=sha(ir),native_models=len(integrals),native_queries=json.loads(ar)['total_queries'],seam_height_pairs=json.loads(ar)['seam_height_pairs'],selections_csv_sha256=sha((DEST/'selections.csv').read_bytes()),figure_sha256=sha((DEST/'hybrid-source-results.svg').read_bytes()),package={'filename':'hybrid-source-evidence.zip','bytes':len(b),'sha256':sha(b)})
    body=(json.dumps(summary,ensure_ascii=False,indent=2,allow_nan=False)+'\n').encode();SUMMARY.write_bytes(body);(DEST/'publication.json').write_bytes(body);print('Published all 2940 real C0 native candidates and every fixed selection',flush=True)
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('folder',type=Path);publish(parser.parse_args().folder)
