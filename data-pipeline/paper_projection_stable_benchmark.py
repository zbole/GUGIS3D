"""Repair fixed-space fitting without dropping or rewriting its unstable prototype."""
import argparse,json,shutil
from pathlib import Path
import numpy as np
import paper_projection_stable_math as stable
import paper_projection_math as projection
import variable_curvature_ruled as frozen
ROOT=frozen.ROOT;PROTOCOL=ROOT/'data-pipeline/paper_projection_stable_protocol.json';sha=frozen.sha;packed=frozen.principal.packed
def build(folder):
    folder=folder.resolve()
    if folder.parent!=(ROOT/'.local/research').resolve() or folder.exists():raise ValueError('Fresh repository private study required')
    protocolraw=PROTOCOL.read_bytes();p=json.loads(protocolraw);raw=(ROOT/p['input']).read_bytes();prototype_path=ROOT/p['prototype_report']
    if not prototype_path.exists():prototype_path=ROOT/p['prototype_report_fallback']
    proto_raw=prototype_path.read_bytes()
    if sha(raw)!=p['input_sha256'] or sha(proto_raw)!=p['prototype_report_sha256']:raise ValueError('Original or prototype report changed')
    source=json.loads(raw);prototype=json.loads(proto_raw)
    if len(source['cases'])!=14 or sum(len(c['pairs']) for c in source['cases'])!=126 or [c['id'] for c in source['cases']]!=[c['id'] for c in prototype['cases']]:raise ValueError('Complete original fixed set required')
    folder.mkdir();(folder/'protocol.json').write_bytes(protocolraw);(folder/'source-report.json').write_bytes(raw);(folder/'prototype-report.json').write_bytes(proto_raw);cases=[]
    for c,prior in zip(source['cases'],prototype['cases']):
        out=folder/c['id'];out.mkdir();original=ROOT/'frontend/public/research/variable-curvature-v1'/c['id'];frame=np.asarray(c['source_frame']);field=c['field'];fn=lambda xy:frozen.value(xy,field,frame);saved={};pairs=[]
        for pair,oldpair in zip(c['pairs'],prior['pairs']):
            row={'budget':pair['budget'],'prior':{k:pair[k] for k in ['p1','mean_hessian','p2']},'prototype':{k:oldpair[k] for k in ['pt','c0-l2']}}
            for method,key in [('pt','p1'),('c0-stable','mean_hessian')]:
                receipt=pair[key];name=method+'-'+receipt['filename'];inputraw=(original/receipt['filename']).read_bytes()
                if sha(inputraw)!=receipt['sha256']:raise ValueError('Fixed input model changed')
                if name not in saved:
                    old=json.loads(inputraw);model,solver=(projection.project_p1(old,fn) if method=='pt' else stable.project_c0_ruled(old,fn));metric=frozen.integrate(model,field,frame,5);jr=packed(model);br=frozen.binary(model)
                    if method=='c0-stable' and (len(br)!=receipt['binary_bytes'] or model['patches']!=old['patches'] or [v[:2] for v in model['points']]!=[v[:2] for v in old['points']]):raise ValueError('Constrained fit changed topology/cost')
                    if method=='pt' and (sha(jr)!=oldpair['pt']['sha256'] or sha(br)!=oldpair['pt']['binary_sha256']):raise ValueError('PT control changed from complete prototype')
                    (out/name).write_bytes(jr);binaryname=name[:-5]+'.bin';(out/binaryname).write_bytes(br)
                    saved[name]={'method':method,'filename':name,'sha256':sha(jr),'bytes':len(jr),'binary_filename':binaryname,'binary_sha256':sha(br),'binary_bytes':len(br),'prior_filename':receipt['filename'],'prior_sha256':receipt['sha256'],'points':len(model['points']),'patches':len(model['patches']),'solver':solver,**metric}
                row[method]=saved[name]
            pairs.append(row)
        cases.append({k:c[k] for k in ['id','name','field','angle_degrees','source_frame']}|{'pairs':pairs});print(c['id']+': all nine rank-aware fitting and PT controls retained',flush=True)
    paths=['data-pipeline/paper_projection_stable_protocol.json','data-pipeline/paper_projection_stable_math.py','data-pipeline/paper_projection_stable_benchmark.py','data-pipeline/paper_projection_math.py',*source['scripts']]
    result={'schema':'gugis-paper-projection-stable-v1','protocol_sha256':sha(protocolraw),'source_report_sha256':sha(raw),'prototype_report_sha256':sha(proto_raw),'scripts':{path:sha((ROOT/path).read_bytes().replace(b'\r\n',b'\n')) for path in paths},'scope':p['reporting'],'observations_disclosure':p['observations_disclosure'],'cases':cases};(folder/'results.json').write_bytes(packed(result));return result
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('folder',type=Path);build(parser.parse_args().folder)
