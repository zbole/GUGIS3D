"""Fixed real-source orientation-adaptive triangle controls and three-way mixtures."""
import argparse,json,shutil
from pathlib import Path
import diagonal_hybrid_math as diagonal
from hybrid_source_benchmark import load_reference,choices
from source_band_benchmark import ROOT,sha,packed,binary
PROTOCOL=ROOT/'data-pipeline/diagonal_hybrid_protocol.json'
def build(folder):
    folder=folder.resolve()
    if folder.parent!=(ROOT/'.local/research').resolve() or folder.exists():raise ValueError('Fresh direct repository .local/research output required')
    protocolraw=PROTOCOL.read_bytes();protocol=json.loads(protocolraw);source_raw=(ROOT/protocol['source_report']).read_bytes();prior_raw=(ROOT/protocol['prior_hybrid_report']).read_bytes()
    if sha(source_raw)!=protocol['source_report_sha256'] or sha(prior_raw)!=protocol['prior_hybrid_report_sha256']:raise ValueError('Frozen source/prior report changed')
    parent=json.loads(source_raw);prior=json.loads(prior_raw)
    if len(parent['cases'])!=20 or [c['id'] for c in parent['cases']]!=[c['id'] for c in prior['cases']]:raise ValueError('Twenty fixed source sites required')
    folder.mkdir();(folder/'protocol.json').write_bytes(protocolraw);(folder/'source-report.json').write_bytes(source_raw);(folder/'prior-hybrid-report.json').write_bytes(prior_raw);cases=[];validated=set()
    for source,old in zip(parent['cases'],prior['cases']):
        if source['reference_sha256']!=old['reference_sha256'] or source['origin_bng']!=old['origin_bng']:raise ValueError('Prior native source/geoframe differs')
        ref,raw=load_reference(source,validated);out=folder/source['id'];out.mkdir();(out/'reference.json').write_bytes(raw);crop=ROOT/'frontend/public/research/source-native-bands-v1'/source['id']/'source-window.tif';shutil.copyfile(crop,out/'source-window.tif');entries=[];cache={};mirror_cache={}
        for nx in protocol['axis_cells']:
            for ny in protocol['axis_cells']:
                grid=diagonal.grid(ref,nx,ny,cache,mirror_cache)
                for method in protocol['methods']:
                    model,metrics=grid[method];jr=packed(model);br=binary(model);name=f'{method}-{nx}x{ny}';(out/(name+'.json')).write_bytes(jr);(out/(name+'.bin')).write_bytes(br)
                    if len(br)!=metrics['binary_bytes']:raise ValueError('Actual complete file accounting differs')
                    entries.append({**metrics,'id':name,'filename':name+'.json','bytes':len(jr),'sha256':sha(jr),'binary_filename':name+'.bin','binary_sha256':sha(br)})
        pairs,targets=choices(entries,protocol)
        for group,key in [(pairs,'byte_ceiling'),(targets,'height_target_m')]:
            originals=old['byte_pairs'] if key=='byte_ceiling' else old['target_pairs']
            for row in group:row['prior']={k:v for k,v in next(p for p in originals if p[key]==row[key]).items() if k in ['p1','ruled','hybrid']}
        cases.append({k:v for k,v in source.items() if k in ['id','city_id','name','reference_sha256','source_window','origin_bng','source_identity']}|{'source_geotiff':old['source_geotiff'],'candidates':entries,'byte_pairs':pairs,'target_pairs':targets})
        print(source['id']+': all 98 new costed candidates retained',flush=True)
    scripts=['data-pipeline/diagonal_hybrid_protocol.json','data-pipeline/diagonal_hybrid_math.py','data-pipeline/diagonal_hybrid_benchmark.py','data-pipeline/hybrid_source_math.py','data-pipeline/hybrid_source_benchmark.py','data-pipeline/source_band_benchmark.py']
    r={'schema':'gugis-diagonal-hybrid-v1','protocol_sha256':sha(protocolraw),'source_report_sha256':sha(source_raw),'prior_hybrid_report_sha256':sha(prior_raw),'source_catalogue_sha256':parent['source_catalogue_sha256'],'scripts':{p:sha((ROOT/p).read_bytes().replace(b'\r\n',b'\n')) for p in scripts},'scope':protocol['reporting'],'selection':protocol['selection'],'continuity':protocol['continuity'],'metrics':protocol['metrics'],'cases':cases};(folder/'results.json').write_bytes(packed(r));return r
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('folder',type=Path);build(parser.parse_args().folder)
