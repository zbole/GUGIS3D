"""Save all fixed-paper PT-driven adaptive controls, with complete refinement traces."""
import argparse,json,shutil
from pathlib import Path
import paper_adaptive_projection_math as adaptive
import variable_curvature_ruled as original
from principal_ruled_benchmark import packed
ROOT=original.ROOT;PROTOCOL=ROOT/'data-pipeline/paper_adaptive_projection_protocol.json';sha=original.sha

def build(folder):
    if folder.exists():raise FileExistsError('Fresh private study required')
    pr=PROTOCOL.read_bytes();protocol=json.loads(pr);raw=(ROOT/protocol['source_report']).read_bytes();fitted_raw=(ROOT/protocol['fitted_report']).read_bytes()
    if sha(raw)!=protocol['source_report_sha256'] or sha(fitted_raw)!=protocol['fitted_report_sha256']:raise ValueError('Fixed source/control changed')
    source=json.loads(raw);fitted=json.loads(fitted_raw);folder.mkdir(parents=True)
    for name,b in [('protocol.json',pr),('source-report.json',raw),('fitted-report.json',fitted_raw)]: (folder/name).write_bytes(b)
    cases=[]
    for site,previous in zip(source['cases'],fitted['cases']):
        if site['id']!=previous['id'] or [p['budget'] for p in site['pairs']]!=protocol['budgets']:raise ValueError('Fixed case or budget order changed')
        out=folder/site['id'];out.mkdir();snapshots,trace=adaptive.meshes(site['field'],site['source_frame'],protocol['budgets']);pairs=[]
        for row,old,fit in zip(snapshots,site['pairs'],previous['pairs']):
            model=row['model'];e=original.entry(model,'adaptive-pt-'+str(row['budget']),{k:v for k,v in row.items() if k!='model'});e['native_triangles']=row['budget'];original.save(out,model,e)
            pairs.append({'budget':row['budget'],'adaptive_pt':e,'p1':old['p1'],'fixed_pt':fit['pt'],'before':old['mean_hessian'],'fitted':fit['c0-stable'],'p2':old['p2']})
        trace_raw=packed(trace);(out/'refinement-trace.json').write_bytes(trace_raw)
        cases.append({k:site[k] for k in ['id','name','field','angle_degrees','source_frame']}|{'pairs':pairs,'trace_sha256':sha(trace_raw),'refinements':len(trace)})
        print(site['id']+': all PT-priority / IT-L1 edge controls and complete trace saved',flush=True)
    scripts=['data-pipeline/paper_adaptive_projection_protocol.json','data-pipeline/paper_adaptive_projection_math.py','data-pipeline/paper_adaptive_projection_benchmark.py','data-pipeline/paper_metric_benchmark.py','data-pipeline/variable_curvature_ruled.py','data-pipeline/principal_ruled_benchmark.py','data-pipeline/principal_order_control.py','data-pipeline/research_triangle_strips.py']
    r={'schema':'gugis-paper-adaptive-projection-v1','protocol_sha256':sha(pr),'source_report_sha256':sha(raw),'fitted_report_sha256':sha(fitted_raw),'scripts':{p:sha((ROOT/p).read_bytes().replace(b'\r\n',b'\n')) for p in scripts},'cases':cases,'scope':protocol['scope']}
    (folder/'results.json').write_bytes(packed(r));return r
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('folder',type=Path);a=p.parse_args();build(a.folder)
