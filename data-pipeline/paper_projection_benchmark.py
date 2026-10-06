"""Fixed all-budget L2 fitting ablation against a paper-permitted stronger operator."""
import argparse,json
from pathlib import Path
import numpy as np
import paper_projection_math as projection
import variable_curvature_ruled as frozen
ROOT=frozen.ROOT;PROTOCOL=ROOT/'data-pipeline/paper_projection_protocol.json';sha=frozen.sha;packed=frozen.principal.packed
def build(folder):
    folder=folder.resolve()
    if folder.parent!=(ROOT/'.local/research').resolve() or folder.exists():raise ValueError('Fresh repository private study required')
    protocolraw=PROTOCOL.read_bytes();p=json.loads(protocolraw);raw=(ROOT/p['input']).read_bytes()
    if sha(raw)!=p['input_sha256']:raise ValueError('Frozen source experiment changed')
    source=json.loads(raw)
    if len(source['cases'])!=14 or sum(len(c['pairs']) for c in source['cases'])!=126:raise ValueError('Complete original fixed set required')
    folder.mkdir();(folder/'protocol.json').write_bytes(protocolraw);(folder/'source-report.json').write_bytes(raw);cases=[]
    for c in source['cases']:
        out=folder/c['id'];out.mkdir();original=ROOT/'frontend/public/research/variable-curvature-v1'/c['id'];frame=np.asarray(c['source_frame']);field=c['field'];fn=lambda xy:frozen.value(xy,field,frame);saved={};pairs=[]
        for pair in c['pairs']:
            row={'budget':pair['budget'],'prior':{k:pair[k] for k in ['p1','mean_hessian','p2']}}
            for method,key in [('pt','p1'),('c0-l2','mean_hessian')]:
                receipt=pair[key];name=method+'-'+receipt['filename'];inputraw=(original/receipt['filename']).read_bytes()
                if sha(inputraw)!=receipt['sha256']:raise ValueError('Fixed input model changed')
                try:
                    if name not in saved:
                        old=json.loads(inputraw);model,solver=(projection.project_p1(old,fn) if method=='pt' else projection.project_c0_ruled(old,fn));metric=frozen.integrate(model,field,frame,5);jr=packed(model);br=frozen.binary(model)
                        if method=='c0-l2' and (len(br)!=receipt['binary_bytes'] or model['patches']!=old['patches'] or [v[:2] for v in model['points']]!=[v[:2] for v in old['points']]):raise ValueError('C0 fit changed topology or complete cost')
                        (out/name).write_bytes(jr);binaryname=name[:-5]+'.bin';(out/binaryname).write_bytes(br)
                        saved[name]={'method':method,'filename':name,'sha256':sha(jr),'bytes':len(jr),'binary_filename':binaryname,'binary_sha256':sha(br),'binary_bytes':len(br),'prior_filename':receipt['filename'],'prior_sha256':receipt['sha256'],'points':len(model['points']),'patches':len(model['patches']),'solver':solver,**metric}
                    row[method]=saved[name]
                except (ValueError,np.linalg.LinAlgError) as error:
                    row[method]=None;row[method+'_failure']=str(error)
            pairs.append(row)
        cases.append({k:c[k] for k in ['id','name','field','angle_degrees','source_frame']}|{'pairs':pairs});print(c['id']+': all nine projection/control pairs retained',flush=True)
    paths=['data-pipeline/paper_projection_protocol.json','data-pipeline/paper_projection_math.py','data-pipeline/paper_projection_benchmark.py',*source['scripts']]
    result={'schema':'gugis-paper-projection-v1','protocol_sha256':sha(protocolraw),'source_report_sha256':sha(raw),'scripts':{p:sha((ROOT/p).read_bytes().replace(b'\r\n',b'\n')) for p in paths},'scope':p['reporting'],'pilot_disclosure':p['pilot_disclosure'],'cases':cases};(folder/'results.json').write_bytes(packed(result));return result
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('folder',type=Path);build(parser.parse_args().folder)
