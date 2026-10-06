"""Prospectively frozen fixed-space shared-C0 fitting on twenty original DTM windows."""
import argparse,json,shutil,platform
from pathlib import Path
import numpy as np
from source_band_benchmark import ROOT,sha,packed,binary
from hybrid_source_benchmark import load_reference,choices
from source_global_fit_math import fit
from source_fit_metrics import measure
PROTOCOL=ROOT/'data-pipeline/source_fit_protocol.json'
SCRIPTS=['data-pipeline/source_fit_protocol.json','data-pipeline/source_fit_benchmark.py','data-pipeline/source_global_fit_math.py','data-pipeline/source_fit_metrics.py','data-pipeline/source_fit_galerkin_audit.py','data-pipeline/diagonal_hybrid_audit.py','data-pipeline/hybrid_source_audit.py','data-pipeline/diagonal_hybrid_math.py','data-pipeline/hybrid_source_math.py','data-pipeline/hybrid_source_benchmark.py','data-pipeline/source_band_benchmark.py','frontend/scripts/audit-source-fit.mjs','frontend/tests/bundleWorkspaceModule.mjs','frontend/src/compare/sourceRuledBandMath.ts','frontend/src/compare/principalRuledMath.ts','frontend/src/compare/curvedRuledMath.ts','frontend/src/compare/terrainOrderMath.ts','frontend/src/compare/preparedOrderQuery.ts']

def build(folder):
    folder=folder.resolve()
    if folder.parent!=(ROOT/'.local/research').resolve() or folder.exists():raise ValueError('Fresh direct repository private research directory required')
    protocolraw=PROTOCOL.read_bytes();protocol=json.loads(protocolraw);inputs={}
    for key in ['source_report','diagonal_report','prior_hybrid_report']:
        raw=(ROOT/protocol[key]).read_bytes()
        if sha(raw)!=protocol[key+'_sha256']:raise ValueError('Original report changed: '+key)
        inputs[key]=(json.loads(raw),raw)
    parent=inputs['source_report'][0];diagonal=inputs['diagonal_report'][0];prior=inputs['prior_hybrid_report'][0]
    if len(parent['cases'])!=20 or any([c['id'] for c in parent['cases']]!=[c['id'] for c in inputs[k][0]['cases']] for k in ['diagonal_report','prior_hybrid_report']):raise ValueError('All original twenty sites required')
    scripts={p:sha((ROOT/p).read_bytes().replace(b'\r\n',b'\n')) for p in SCRIPTS}
    folder.mkdir();(folder/'protocol.json').write_bytes(protocolraw)
    for key,(_,raw) in inputs.items():(folder/(key.replace('_','-')+'.json')).write_bytes(raw)
    for p in scripts:
        dest=folder/'code'/p;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes((ROOT/p).read_bytes().replace(b'\r\n',b'\n'))
    cases=[];validated=set();cross_cache={}
    for source,old,oldpure in zip(parent['cases'],diagonal['cases'],prior['cases']):
        ref,raw=load_reference(source,validated);out=folder/source['id'];out.mkdir();(out/'reference.json').write_bytes(raw);shutil.copyfile(ROOT/'frontend/public/research/source-native-bands-v1'/source['id']/'source-window.tif',out/'source-window.tif');entries=[]
        for nx in protocol['axis_cells']:
            for ny in protocol['axis_cells']:
                for method in protocol['methods']:
                    oldmethod={'p1-fit':'p1-local','hybrid-fit':'hybrid-local','ruled-fit':'ruled'}[method];oldsite=oldpure if method=='ruled-fit' else old;public=ROOT/'frontend/public/research'/('hybrid-source-v1' if method=='ruled-fit' else 'diagonal-hybrid-v1')/source['id'];original_entry=next(e for e in oldsite['candidates'] if e['method']==oldmethod and e['nx']==nx and e['ny']==ny)
                    originalraw=(public/original_entry['filename']).read_bytes();originalbinary=(public/original_entry['binary_filename']).read_bytes()
                    if sha(originalraw)!=original_entry['sha256'] or sha(originalbinary)!=original_entry['binary_sha256']:raise ValueError('Prior fixed-space native file changed')
                    original=json.loads(originalraw);families=original_entry['families'];before=measure(ref,original,nx,ny,families);name=f'{method}-{nx}x{ny}';attempt=None
                    if abs(before['e2_m2']-original_entry['e2_m2'])>1e-8*max(1,original_entry['e2_m2']):raise ValueError('Original error integral differs')
                    try:
                        attempt,solver=fit(ref,nx,ny,families,cross_cache);metrics=measure(ref,attempt,nx,ny,families)
                        if attempt['patches']!=original['patches'] or any(a[:2]!=b[:2] for a,b in zip(attempt['points'],original['points'])) or len(binary(attempt))!=len(originalbinary):raise ValueError('Native topology XY or complete cost changed')
                        if metrics['e2_m2']>before['e2_m2']+1e-9*max(1,before['e2_m2']):raise ValueError('Saved fitted energy exceeded declared original guard')
                        model=attempt
                    except ValueError as failure:
                        solver={'status':'fallback_original','reason':str(failure)};model=original;metrics=before
                        if attempt is not None:
                            (out/(name+'-attempt.json')).write_bytes(packed(attempt));(out/(name+'-attempt.bin')).write_bytes(binary(attempt))
                            solver['attempted_model']={'filename':name+'-attempt.json','sha256':sha(packed(attempt)),'binary_filename':name+'-attempt.bin','binary_sha256':sha(binary(attempt))}
                    jr=packed(model);br=binary(model);(out/(name+'.json')).write_bytes(jr);(out/(name+'.bin')).write_bytes(br);guard=1e-9+float(np.abs(ref['height']).max())*1e-12
                    entries.append({**metrics,'rms_integral_m':metrics['e2_m2']/64,'continuous_bound_m':metrics['continuous_maximum_m']+guard,'float64_guard_m':guard,'method':method,'nx':nx,'ny':ny,'id':name,'filename':name+'.json','bytes':len(jr),'sha256':sha(jr),'binary_filename':name+'.bin','binary_bytes':len(br),'binary_sha256':sha(br),'stored_points':len(model['points']),'stored_patches':len(model['patches']),'ruled_cells':families.count('ruled'),'p1_triangles':2*(families.count('minus')+families.count('plus')),'native_primitives':families.count('ruled')+2*(families.count('minus')+families.count('plus')),'families':families,'solver':solver,'original':{k:original_entry[k] for k in ['method','filename','sha256','binary_filename','binary_sha256','binary_bytes','e2_m2','continuous_maximum_m','continuous_bound_m']}})
        pairs,targets=choices(entries,protocol)
        for rows,key,oldrows,purerows in [(pairs,'byte_ceiling',old['byte_pairs'],oldpure['byte_pairs']),(targets,'height_target_m',old['target_pairs'],oldpure['target_pairs'])]:
            for row in rows:
                d=next(p for p in oldrows if p[key]==row[key]);r=next(p for p in purerows if p[key]==row[key]);row['unfitted']={'p1-local':d['p1-local'],'hybrid-local':d['hybrid-local'],'ruled':r['ruled']}
        cases.append({k:v for k,v in source.items() if k in ['id','city_id','name','reference_sha256','source_window','origin_bng','source_identity']}|{'source_geotiff':old['source_geotiff'],'candidates':entries,'byte_pairs':pairs,'target_pairs':targets})
        print(source['id']+': all 147 fixed-space fitted candidates retained; fallbacks '+str(sum(e['solver']['status']=='fallback_original' for e in entries)),flush=True)
    if scripts!={p:sha((ROOT/p).read_bytes().replace(b'\r\n',b'\n')) for p in scripts}:raise ValueError('Frozen study code changed during execution')
    report={'schema':'gugis-source-global-fit-v1','protocol_sha256':sha(protocolraw),'source_report_sha256':sha(inputs['source_report'][1]),'diagonal_report_sha256':sha(inputs['diagonal_report'][1]),'prior_hybrid_report_sha256':sha(inputs['prior_hybrid_report'][1]),'source_catalogue_sha256':parent['source_catalogue_sha256'],'scripts':scripts,'environment':{'python':platform.python_version(),'numpy':np.__version__,'system':platform.system()},'scope':protocol['scope'],'structure':protocol['structure'],'metrics':protocol['metrics'],'cases':cases}
    (folder/'results.json').write_bytes(packed(report));return report
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('folder',type=Path);build(parser.parse_args().folder)
