"""Frozen-method, size-selected new Exeter windows; never modify the old cohort."""
import argparse,json,platform
from pathlib import Path
import numpy as np
import rasterio
from rasterio.windows import Window
import diagonal_hybrid_math as diagonal
from source_band_benchmark import ROOT,sha,packed,binary,grid_binary,make_models,integration
from source_global_fit_math import fit
from source_fit_metrics import measure
from hybrid_source_benchmark import choices

PROTOCOL=ROOT/'data-pipeline/exeter_source_fit_protocol_v1.json'
def pinned_inputs():
    raw=PROTOCOL.read_bytes();p=json.loads(raw)
    for path,digest in p['inputs'].items():
        if sha((ROOT/path).read_bytes())!=digest:raise ValueError('Frozen input changed: '+path)
    for path,digest in p['code'].items():
        if sha((ROOT/path).read_bytes().replace(b'\r\n',b'\n'))!=digest:raise ValueError('Frozen method changed: '+path)
    return p,raw

def build(folder):
    folder=folder.resolve()
    if folder.parent!=(ROOT/'.local/research').resolve() or folder.exists():raise ValueError('Fresh direct private research folder required')
    p,protocolraw=pinned_inputs();raster=ROOT/p['raster'];folder.mkdir();(folder/'protocol.json').write_bytes(protocolraw)
    for path in p['code']:
        out=folder/'implementation'/path;out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes((ROOT/path).read_bytes().replace(b'\r\n',b'\n'))
    cases=[];cross_cache={}
    with rasterio.open(raster) as src:
        if src.crs.to_epsg()!=27700 or src.dtypes!=('float32',) or src.count!=1 or src.res!=(1.,1.) or src.scales!=(1.,) or src.offsets!=(0.,) or (src.width,src.height)!=(3032,3287):raise ValueError('Frozen Float32 1m Exeter raster required')
        for spec in p['windows']:
            window=Window(spec['left'],spec['top'],65,65);values=src.read(1,window=window)
            if values.shape!=(65,65) or not np.isfinite(values).all() or (src.nodata is not None and np.any(values==src.nodata)) or np.abs(values).max()>10000:raise ValueError('Complete finite original source pixels required')
            origin=list(src.xy(spec['top']+32,spec['left']+32));reference={'x':list(range(-32,33)),'y':list(range(-32,33)),'height':values[::-1].astype(float).tolist(),'origin_bng':[float(v) for v in origin]}
            out=folder/spec['id'];out.mkdir();raw=packed(reference);(out/'reference.json').write_bytes(raw)
            profile=src.profile.copy();profile.update(width=65,height=65,transform=src.window_transform(window),compress='DEFLATE',predictor=3,tiled=False);profile.pop('blockxsize',None);profile.pop('blockysize',None)
            with rasterio.open(out/'source-window.tif','w',**profile) as crop:crop.write(values,1);crop.update_tags(**src.tags())
            with rasterio.open(out/'source-window.tif') as crop:
                if not np.array_equal(crop.read(1),values) or crop.transform!=src.window_transform(window) or crop.crs!=src.crs:raise ValueError('Lossless source crop check failed')
            grid=grid_binary(reference);(out/'regular-grid.bin').write_bytes(grid);controls=[]
            for family,model in make_models(reference).items():
                blob=binary(model);name='control-'+family+'.bin';(out/name).write_bytes(blob);metric=integration(reference,model,3)
                if family!='source_p1' and metric['e2_m2']>=1e-8:raise ValueError('Full exact-function control failed')
                controls.append({'family':family,'binary_filename':name,'binary_bytes':len(blob),'binary_sha256':sha(blob),**metric})
            entries=[];cache={};mirror_cache={}
            for nx in p['axis_cells']:
                for ny in p['axis_cells']:
                    original_grids=diagonal.grid(reference,nx,ny,cache,mirror_cache)
                    for method in p['methods']:
                        if method=='ruled-fit':families=['ruled']*(nx*ny);original=diagonal.make_model(reference,nx,ny,families)
                        else:original,old=original_grids[{'p1-fit':'p1-local','hybrid-fit':'hybrid-local'}[method]];families=old['families']
                        before=measure(reference,original,nx,ny,families);name=f'{method}-{nx}x{ny}';old_raw=packed(original);old_binary=binary(original)
                        (out/(name+'-unfitted.json')).write_bytes(old_raw);(out/(name+'-unfitted.bin')).write_bytes(old_binary);attempt=None
                        try:
                            attempt,solver=fit(reference,nx,ny,families,cross_cache);metrics=measure(reference,attempt,nx,ny,families)
                            if attempt['patches']!=original['patches'] or any(a[:2]!=b[:2] for a,b in zip(attempt['points'],original['points'])) or len(binary(attempt))!=len(old_binary):raise ValueError('Fixed space or complete byte cost changed')
                            if metrics['e2_m2']>before['e2_m2']+1e-9*max(1,before['e2_m2']):raise ValueError('Fitted error exceeds original guard')
                            model=attempt
                        except ValueError as failure:
                            solver={'status':'fallback_original','reason':str(failure)};model=original;metrics=before
                            if attempt is not None:
                                jr,br=packed(attempt),binary(attempt);(out/(name+'-attempt.json')).write_bytes(jr);(out/(name+'-attempt.bin')).write_bytes(br);solver['attempted_model']={'filename':name+'-attempt.json','sha256':sha(jr),'binary_filename':name+'-attempt.bin','binary_sha256':sha(br)}
                        jr,br=packed(model),binary(model);(out/(name+'.json')).write_bytes(jr);(out/(name+'.bin')).write_bytes(br);guard=1e-9+float(np.abs(values).max())*1e-12
                        entries.append({'id':name,'method':method,'nx':nx,'ny':ny,'families':families,'filename':name+'.json','bytes':len(jr),'sha256':sha(jr),'binary_filename':name+'.bin','binary_bytes':len(br),'binary_sha256':sha(br),'stored_points':len(model['points']),'stored_patches':len(model['patches']),'ruled_cells':families.count('ruled'),'p1_triangles':2*(families.count('minus')+families.count('plus')),'solver':solver,'original':{'filename':name+'-unfitted.json','bytes':len(old_raw),'sha256':sha(old_raw),'binary_filename':name+'-unfitted.bin','binary_bytes':len(old_binary),'binary_sha256':sha(old_binary),**before},'rms_integral_m':metrics['e2_m2']/64,'float64_guard_m':guard,'continuous_bound_m':metrics['continuous_maximum_m']+guard,**metrics})
            rows,targets=choices(entries,p);tif=(out/'source-window.tif').read_bytes()
            cases.append({'id':spec['id'],'city_id':'exeter','name':spec['name'],'source_window':spec,'origin_bng':reference['origin_bng'],'reference_sha256':sha(raw),'source_geotiff':{'filename':'source-window.tif','bytes':len(tif),'sha256':sha(tif)},'regular_grid':{'filename':'regular-grid.bin','bytes':len(grid),'sha256':sha(grid)},'controls':controls,'candidates':entries,'byte_pairs':rows,'target_pairs':targets})
            print(spec['id']+': 147 fitted models and complete unfitted controls saved',flush=True)
    pinned_inputs()
    report={'schema':'gugis-exeter-source-fit-v1','protocol_sha256':sha(protocolraw),'inputs':p['inputs'],'code':p['code'],'scope':p['scope'],'environment':{'python':platform.python_version(),'numpy':np.__version__,'rasterio':rasterio.__version__,'system':platform.system()},'cases':cases};(folder/'results.json').write_bytes(packed(report));return report
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('folder',type=Path);build(parser.parse_args().folder)
