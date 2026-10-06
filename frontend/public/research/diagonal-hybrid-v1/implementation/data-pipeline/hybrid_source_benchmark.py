"""Fixed real-source tensor grids, with costed C0 ruled/triangle mixing."""
import argparse,json,math,shutil
from pathlib import Path
import numpy as np
from PIL import Image
import hybrid_source_math as hybrid
from source_band_benchmark import ROOT,sha,packed,binary,reference_value
PROTOCOL=ROOT/'data-pipeline/hybrid_source_protocol.json'
def load_reference(case,validated):
    folder=ROOT/'frontend/public/research/source-native-bands-v1'/case['id'];raw=(folder/'reference.json').read_bytes()
    if sha(raw)!=case['reference_sha256']:raise ValueError('Frozen real-source reference changed')
    ref=json.loads(raw);z=np.array(ref['height'])
    if ref['x']!=list(range(-32,33)) or ref['y']!=list(range(-32,33)) or z.shape!=(65,65) or not np.isfinite(z).all() or not np.array_equal(z,z.astype(np.float32).astype(float)):raise ValueError('Original Float32 source window required')
    raster=ROOT/f"backend/data/terrain/{case['city_id']}-ea-dtm-1m.tif"
    if case['city_id'] not in validated:
        if sha(raster.read_bytes())!=case['source_identity']['raster_sha256']:raise ValueError('Original source raster changed')
        validated.add(case['city_id'])
    top,left,width,height=ref['source_window']
    with Image.open(raster) as image:
        scale,tie=image.tag_v2[33550],image.tag_v2[33922];origin=[tie[3]+(left+(width-1)/2+.5-tie[0])*scale[0],tie[4]-(top+(height-1)/2+.5-tie[1])*scale[1]]
        if image.mode!='F' or scale[:2]!=(1.,1.) or origin!=ref['origin_bng'] or not np.array_equal(np.asarray(image.crop((left,top,left+width,top+height)))[::-1],z):raise ValueError('Original source pixels / BNG origin differ')
    return ref,raw
def choices(entries,protocol):
    pairs=[];targets=[]
    for limit in protocol['byte_ceilings']:
        row={'byte_ceiling':limit}
        for family in protocol['methods']:
            pool=[e for e in entries if e['method']==family and e['binary_bytes']<=limit]
            row[family]=min(pool,key=lambda e:(e['e2_m2'],e['binary_bytes'],e['nx'],e['ny']),default=None)
        pairs.append(row)
    for target in protocol['height_targets_m']:
        row={'height_target_m':target}
        for family in protocol['methods']:
            pool=[e for e in entries if e['method']==family and e['continuous_bound_m']<=target]
            row[family]=min(pool,key=lambda e:(e['binary_bytes'],e['e2_m2'],e['nx'],e['ny']),default=None)
        targets.append(row)
    return pairs,targets
def build(folder):
    if folder.exists():raise FileExistsError('Fresh private research output required')
    protocolraw=PROTOCOL.read_bytes();protocol=json.loads(protocolraw);parentraw=(ROOT/protocol['source_report']).read_bytes();parent=json.loads(parentraw)
    if parent['schema']!='gugis-source-native-bands-v1' or len(parent['cases'])!=20:raise ValueError('All twenty fixed source windows required')
    folder.mkdir(parents=True);(folder/'protocol.json').write_bytes(protocolraw);(folder/'source-report.json').write_bytes(parentraw);cases=[];validated=set()
    for case in parent['cases']:
        ref,raw=load_reference(case,validated);out=folder/case['id'];out.mkdir();(out/'reference.json').write_bytes(raw)
        # Preserve the published original-pixel GeoTIFF crop as a directly usable input.
        crop=ROOT/'frontend/public/research/source-native-bands-v1'/case['id']/'source-window.tif';shutil.copyfile(crop,out/'source-window.tif')
        entries=[];cache={}
        for nx in protocol['axis_cells']:
            for ny in protocol['axis_cells']:
                grid=hybrid.grid(ref,nx,ny,cache)
                for method in protocol['methods']:
                    model,metrics=grid[method];jr=packed(model);br=binary(model);name=f'{method}-{nx}x{ny}'
                    if len(br)!=metrics['binary_bytes']:raise ValueError('Complete native accounting differs')
                    (out/(name+'.json')).write_bytes(jr);(out/(name+'.bin')).write_bytes(br)
                    entries.append({**metrics,'id':name,'filename':name+'.json','bytes':len(jr),'sha256':sha(jr),'binary_filename':name+'.bin','binary_sha256':sha(br)})
        pairs,targets=choices(entries,protocol);cases.append({k:v for k,v in case.items() if k in ['id','city_id','name','reference_sha256','source_window','origin_bng','source_identity']}|{'source_geotiff':{'filename':'source-window.tif','bytes':crop.stat().st_size,'sha256':sha(crop.read_bytes())},'candidates':entries,'byte_pairs':pairs,'target_pairs':targets})
        mixed=sum(e['ruled_cells']>0 and e['p1_triangles']>0 for e in entries if e['method']=='hybrid')
        print(case['id']+': all 147 C0 candidates retained; '+str(mixed)+' genuinely mixed grids',flush=True)
    scripts=['data-pipeline/hybrid_source_protocol.json','data-pipeline/hybrid_source_math.py','data-pipeline/hybrid_source_benchmark.py','data-pipeline/source_band_benchmark.py']
    report={'schema':'gugis-hybrid-source-v1','protocol_sha256':sha(protocolraw),'source_report_sha256':sha(parentraw),'source_catalogue_sha256':parent['source_catalogue_sha256'],'scripts':{p:sha((ROOT/p).read_bytes().replace(b'\r\n',b'\n')) for p in scripts},'scope':protocol['reporting'],'comparison':protocol['selection'],'continuity':protocol['continuity'],'metrics':protocol['metrics'],'cases':cases}
    (folder/'results.json').write_bytes(packed(report));return report
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('folder',type=Path);build(parser.parse_args().folder)
