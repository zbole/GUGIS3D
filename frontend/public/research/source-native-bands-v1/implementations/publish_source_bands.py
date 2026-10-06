"""Verify and publish source-function vectors, compact grids and actual GeoTIFF inputs."""
import argparse
import csv
import io
import json
import math
from pathlib import Path
import platform
import shutil
import sys
import zipfile
import numpy as np
from PIL import Image,TiffImagePlugin,__version__ as pillow_version
from source_band_benchmark import ROOT,sha,packed,binary,grid_binary,make_models,integration,p1_closed_metrics
from plot_source_bands import plot
DEST=ROOT/'frontend/public/research/source-native-bands-v1';SUMMARY=ROOT/'shared/source-native-bands-v1.json'
def checked(path,digest,size=None):
    b=path.read_bytes()
    if sha(b)!=digest or (size is not None and len(b)!=size):raise ValueError('Changed source evidence '+path.name)
    return b
def verify(folder):
    raw=(folder/'results.json').read_bytes();r=json.loads(raw);ar=(folder/'native-audit.json').read_bytes();audit=json.loads(ar);parent_raw=checked(ROOT/'frontend/public/research/dem-curved-grid-v1/results.json',r['parent_report_sha256']);parent=json.loads(parent_raw);catalog_raw=checked(ROOT/'shared/public-terrain-sources-v8.json',r['source_catalogue_sha256']);catalog=json.loads(catalog_raw)
    if r['schema']!='gugis-source-native-bands-v1' or len(r['cases'])!=20 or [c['id'] for c in r['cases']]!=[c['id'] for c in parent['cases']] or audit['report_sha256']!=sha(raw):raise ValueError('Changed fixed case set or audit parent')
    scripts={'data-pipeline/source_band_benchmark.py':r['source_sha256'],**audit['scripts']}
    for p,h in scripts.items():
        if sha((ROOT/p).read_bytes().replace(b'\r\n',b'\n'))!=h:raise ValueError('Bound implementation changed '+p)
    expected=set();raster_checked=set()
    for c,p in zip(r['cases'],parent['cases']):
        for k in ('id','city_id','name','reference_sha256','source_raster_sha256','source_window'):
            if c[k]!=p[k]:raise ValueError('Source window was selected or altered')
        ref_raw=checked(folder/c['id']/'reference.json',c['reference_sha256'])
        if ref_raw!=checked(ROOT/'frontend/public/research/dem-curved-grid-v1'/c['id']/'reference.json',c['reference_sha256']):raise ValueError('Reference differs from original source')
        ref=json.loads(ref_raw);source=next(s for s in catalog['sources'] if s['city_id']==c['city_id'])
        if c['origin_bng']!=ref['origin_bng'] or c['source_identity']!={k:source[k] for k in c['source_identity']}:raise ValueError('Changed source datum, units, caveat or attribution')
        if c['city_id'] not in raster_checked:checked(ROOT/f"backend/data/terrain/{c['city_id']}-ea-dtm-1m.tif",source['raster_sha256'],source['raster_bytes']);raster_checked.add(c['city_id'])
        models=make_models(ref)
        if [e['family'] for e in c['models']]!=list(models):raise ValueError('Missing a vector representation')
        closed=p1_closed_metrics(ref);guard=1e-9+float(np.abs(ref['height']).max())*1e-12
        for e in c['models']:
            m=models[e['family']]
            if checked(folder/c['id']/e['filename'],e['sha256'],e['bytes'])!=packed(m) or checked(folder/c['id']/e['binary_filename'],e['binary_sha256'],e['binary_bytes'])!=binary(m):raise ValueError('Full source nodes, topology or georeference changed')
            measured=integration(ref,m,5)
            if measured['integrated_area_m2']!=4096 or abs(measured['e2_m2']-e['e2_m2'])>1e-8 or (e['family']!='source_p1' and measured['e2_m2']>=1e-8):raise ValueError('Independent whole-source integral failed')
            maximum=closed['maximum_residual_m'] if e['family']=='source_p1' else 0
            if e['continuous_bound_m']!=maximum+guard or e['float64_guard_m']!=guard or e['source_cells']!=4096 or e['native_primitives']!=(4096 if e['family']=='ruled' else 8192):raise ValueError('Changed source-field accuracy or topology')
            if e['family']=='source_p1' and (abs(e['e2_m2']-closed['e2_m2'])>1e-8 or e['maximum_witness']!=closed['maximum_witness']):raise ValueError('P1 mixed-term error does not reproduce')
            expected.add((c['id'],e['family']))
        grid=c['regular_grid']
        if checked(folder/c['id']/grid['filename'],grid['sha256'],grid['bytes'])!=grid_binary(ref) or grid['bytes']!=16980:raise ValueError('Original Float32 grid control changed')
        expected.add((c['id'],'regular_grid'));print(c['id']+': all source functions, full-node topology, file costs and five-point integrals rechecked',flush=True)
    if len(audit['rows'])!=80 or {(v['case_id'],v['family']) for v in audit['rows']}!=expected:raise ValueError('Missing a source representation in native audit')
    for row in audit['rows']:
        checked(folder/row['case_id']/row['binary_filename'],row['binary_sha256'],row['binary_bytes'])
        if (row['internal_requested'],row['internal_hits'],row['original_vertices_requested'],row['original_vertices_hits'])!=(8192,8192,4225,4225) or row['independent_height_difference_m']>=1e-8 or row['independent_gradient_difference']>=1e-9 or not row['source_world_frame_checked'] or not row['outside_clip_rejected'] or (row['family']=='source_p1' and not row['p1_maximum_witness_checked']):raise ValueError('Source native verification incomplete')
    return r,raw,ar,scripts
def write_source_geotiff(ref,source_path,target):
    # Preserve real source samples and CRS tags; no resampling or datum conversion.
    with Image.open(source_path) as original:
        tags=TiffImagePlugin.ImageFileDirectory_v2()
        for code in (34735,34737,34736,42113):
            if code in original.tag_v2:tags[code]=original.tag_v2[code]
        tags[33550]=(1.,1.,0.);tags[33922]=(0.,0.,0.,ref['origin_bng'][0]-32.5,ref['origin_bng'][1]+32.5,0.)
        pixels=np.asarray(ref['height'],dtype=np.float32)[::-1].copy();Image.fromarray(pixels).save(target,format='TIFF',compression='tiff_deflate',tiffinfo=tags)
    with Image.open(target) as rebuilt:
        if rebuilt.mode!='F' or rebuilt.size!=(65,65) or not np.array_equal(np.asarray(rebuilt),pixels) or rebuilt.tag_v2[33550]!=(1.,1.,0.) or rebuilt.tag_v2[33922]!=(0.,0.,0.,ref['origin_bng'][0]-32.5,ref['origin_bng'][1]+32.5,0.):raise ValueError('Derived GeoTIFF not lossless or georeferenced')
    body=target.read_bytes();return {'filename':target.name,'bytes':len(body),'sha256':sha(body),'width':65,'height':65,'value_type':'Float32','compression':'lossless DEFLATE','source_pixels_unchanged':True,'source_crs':'EPSG:27700','vertical_datum_note':'ODN metre convention from published EA source identity; source GeoTIFF itself lacks elevation-unit metadata','pixel_area_extent_bng':[ref['origin_bng'][0]-32.5,ref['origin_bng'][1]-32.5,ref['origin_bng'][0]+32.5,ref['origin_bng'][1]+32.5],'model_domain_note':'Native comparison spans the 64x64m between the 65 original pixel centres; GeoTIFF pixel-area footprint is 65x65m.'}
def publish(folder):
    if DEST.exists() or SUMMARY.exists():raise FileExistsError('Evidence publication cannot be replaced')
    r,raw,ar,scripts=verify(folder);DEST.mkdir(parents=True);(DEST/'results.json').write_bytes(raw);(DEST/'native-audit.json').write_bytes(ar);cases=[];rows=[]
    for c in r['cases']:
        out=DEST/c['id'];out.mkdir()
        for p in (folder/c['id']).iterdir():
            if p.suffix in ('.bin','.json'):shutil.copyfile(p,out/p.name)
        ref=json.loads((out/'reference.json').read_bytes());tif=write_source_geotiff(ref,ROOT/f"backend/data/terrain/{c['city_id']}-ea-dtm-1m.tif",out/'source-window.tif');cases.append(c|{'source_geotiff':tif})
        models={e['family']:e for e in c['models']};a=models['ruled'];b=models['source_p2'];p1=models['source_p1'];rows.append({'site':c['id'],'city':c['city_id'],'ruled_binary_bytes':a['binary_bytes'],'p2_binary_bytes':b['binary_bytes'],'source_p1_binary_bytes':p1['binary_bytes'],'regular_grid_bytes':c['regular_grid']['bytes'],'lossless_geotiff_bytes':tif['bytes'],'ruled_vs_p2_file_saving_percent':100*(1-a['binary_bytes']/b['binary_bytes']),'ruled_e2_m2':a['e2_m2'],'p2_e2_m2':b['e2_m2'],'source_p1_e2_m2':p1['e2_m2'],'source_p1_rms_m':p1['rms_integral_m'],'origin_easting_bng':c['origin_bng'][0],'origin_northing_bng':c['origin_bng'][1]})
    stream=io.StringIO(newline='');w=csv.DictWriter(stream,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows);(DEST/'sites.csv').write_bytes(stream.getvalue().encode());name='source-function-results.svg';plot(r,DEST/name)
    (DEST/'README.txt').write_text('Complete source-function dataset: all 20 fixed real DTM windows, ten cities, 65x65 original Float32 samples each.\nModels cover the same 64x64m domain between pixel centres; derived source GeoTIFF footprint is 65x65m PixelIsArea.\nGPR4: common 80-byte BNG/ODN/metre/clip header, shared Float64 XYZ, native bands / P1 strips / P2 triangles. Ruled bands and P2 preserve the reference cellwise bilinear function, E2 < 1e-8 m2. Native 1m source-node P1 has a nonzero between-node residual.\nCompact ZGR1 regular-grid and actual lossless georeferenced Float32 GeoTIFF controls are included and can be smaller than the vectors; no raster-storage superiority claim.\nSource-relative numerical consistency is not surveyed ground accuracy. Float64 numerical guard, not interval proof. No paper-author or ArcGIS software execution, no heap-memory/CPU/GPU performance claim.\nEA source-unit caveat and ODN convention are retained in source_identity. Source data: Environment Agency 2022, OGL v3.0.\nAll native source nodes and gradients verified. Execution midpoint controls are caches, not saved file or heap measurement.\n',encoding='utf8',newline='\n')
    scripts={**scripts,'data-pipeline/publish_source_bands.py':sha(Path(__file__).read_bytes().replace(b'\r\n',b'\n')),'data-pipeline/plot_source_bands.py':sha((ROOT/'data-pipeline/plot_source_bands.py').read_bytes().replace(b'\r\n',b'\n'))};impl=DEST/'implementations';impl.mkdir()
    for p in scripts:(impl/Path(p).name).write_bytes((ROOT/p).read_bytes().replace(b'\r\n',b'\n'))
    with zipfile.ZipFile(DEST/'source-native-bands-evidence.zip','x',compression=zipfile.ZIP_DEFLATED) as z:
        for p in sorted(DEST.rglob('*')):
            if p.is_file() and p.suffix!='.zip':
                info=zipfile.ZipInfo('source-native-bands-v1/'+p.relative_to(DEST).as_posix(),date_time=(2026,10,6,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,p.read_bytes(),compresslevel=9)
    b=(DEST/'source-native-bands-evidence.zip').read_bytes();summary={k:v for k,v in r.items() if k not in ('cases','source_sha256')};summary.update(cases=cases,scripts=scripts,report_sha256=sha(raw),native_audit_sha256=sha(ar),csv_sha256=sha((DEST/'sites.csv').read_bytes()),figures={name:sha((DEST/name).read_bytes())},package={'filename':'source-native-bands-evidence.zip','bytes':len(b),'sha256':sha(b)},publication_environment={'python':sys.version,'numpy':np.__version__,'pillow':pillow_version,'platform':platform.platform()})
    body=(json.dumps(summary,ensure_ascii=False,indent=2,allow_nan=False)+'\n').encode();SUMMARY.write_bytes(body);(DEST/'publication.json').write_bytes(body);print('Published 20 real source windows, 80 complete native representations, and all lossless georeferenced GeoTIFF inputs')

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('folder',type=Path);publish(p.parse_args().folder)
