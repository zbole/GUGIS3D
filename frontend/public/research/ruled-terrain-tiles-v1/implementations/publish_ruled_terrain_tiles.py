"""Independent source-pixel and full native body verification before release."""
import hashlib,json,shutil,sys,zipfile
from pathlib import Path
import numpy as np
from PIL import Image
import ruled_terrain_tiles as rt
import source_band_benchmark as sb
ROOT=rt.ROOT;DEST=ROOT/'frontend/public/research/ruled-terrain-tiles-v1';SUMMARY=ROOT/'shared/ruled-terrain-tiles-v1.json'
def sha(b):return hashlib.sha256(b).hexdigest()
def publish(folder):
    if DEST.exists() or SUMMARY.exists():raise FileExistsError('New release required')
    raw=(folder/'results.json').read_bytes();r=json.loads(raw);auditraw=(folder/'native-audit.json').read_bytes();a=json.loads(auditraw);gridraw=(folder/r['reference']['filename']).read_bytes();z=np.frombuffer(gridraw,dtype='<f4').reshape(513,513)
    if r['schema']!='gugis-ruled-terrain-tiles-v1' or len(r['tiles'])!=64 or a['report_sha256']!=sha(raw) or sha(gridraw)!=r['reference']['sha256'] or r['source_script_sha256']!=sha(Path(rt.__file__).read_bytes().replace(b'\r\n',b'\n')):raise ValueError('Changed tile dataset')
    source=ROOT/'backend/data/terrain/manchester-ea-dtm-1m.tif'
    if sha(source.read_bytes())!=r['source_identity']['raster_sha256']:raise ValueError('Original source changed')
    top,left,w,h=r['source_window']
    if (w,h)!=(513,513):raise ValueError('Fixed source dimensions changed')
    with Image.open(source) as image:
        np.testing.assert_array_equal(z,np.asarray(image.crop((left,top,left+w,top+h)))[::-1]);tie=image.tag_v2[33922];scale=image.tag_v2[33550]
        if r['origin_bng']!=[tie[3]+(left+256.5-tie[0])*scale[0],tie[4]-(top+256.5-tie[1])*scale[1]]:raise ValueError('Original BNG source centre changed')
    with Image.open(folder/'source-window.tif') as image:
        np.testing.assert_array_equal(np.asarray(image)[::-1],z)
        if image.mode!='F' or tuple(image.tag_v2[33550])!=(1.,1.,0.) or tuple(image.tag_v2[33922])[3:5]!=(r['origin_bng'][0]-256.5,r['origin_bng'][1]+256.5):raise ValueError('Source-window GeoTIFF georeference changed')
        keys=image.tag_v2[34735];records={keys[i]:tuple(keys[i+1:i+4]) for i in range(4,len(keys),4)}
        if records.get(3072)!=(0,1,27700) or records.get(1025)!=(0,1,1):raise ValueError('Source-window GeoTIFF BNG/PixelIsArea changed')
    scripts={'data-pipeline/ruled_terrain_tiles.py':r['source_script_sha256'],'data-pipeline/source_band_benchmark.py':sha(Path(sb.__file__).read_bytes().replace(b'\r\n',b'\n')),**a['scripts'],'data-pipeline/publish_ruled_terrain_tiles.py':sha(Path(__file__).read_bytes().replace(b'\r\n',b'\n'))}
    for name,digest in scripts.items():
        if sha((ROOT/name).read_bytes().replace(b'\r\n',b'\n'))!=digest:raise ValueError('Bound implementation changed')
    if a['total_internal_queries']!=262144 or a['total_source_node_queries']!=270400 or a['seam_midpoint_pairs']!=7168 or a['seam_source_node_pairs']!=7280 or a['max_seam_height_difference_m']>=1e-8 or a['max_tangential_gradient_difference']>=1e-8 or [t['id'] for t in a['tiles']]!=[t['id'] for t in r['tiles']]:raise ValueError('Full native function and seam audit incomplete')
    tiles=[]
    for k,t in enumerate(r['tiles']):
        row,col=divmod(k,8);tile_origin=[r['origin_bng'][0]-224+64*col,r['origin_bng'][1]-224+64*row]
        if (t['row'],t['column'],t['id'],t['origin_bng'],t['filename'])!=(row,col,f'r{row}c{col}',tile_origin,f'tiles/row-{row:02d}-col-{col:02d}.bin'):raise ValueError('Tile layout changed')
        sub=z[row*64:row*64+65,col*64:col*64+65];points=[[float(i-32),float(j-32),float(sub[j,i])] for j in range(65) for i in range(65)];bands=[{'kind':'ruled-strip','left':[j*65+i for i in range(65)],'right':[(j+1)*65+i for i in range(65)]} for j in range(64)];expected=sb.binary(sb.surface({'origin_bng':tile_origin},points,bands));actual=(folder/t['filename']).read_bytes()
        if actual!=expected or len(actual)!=t['bytes'] or sha(actual)!=t['sha256'] or a['tiles'][k]['binary_sha256']!=t['sha256'] or a['tiles'][k]['internal_queries']!=4096 or a['tiles'][k]['original_node_queries']!=4225 or a['tiles'][k]['max_height_difference_m']>=1e-8 or a['tiles'][k]['max_gradient_difference']>=1e-8 or not a['tiles'][k]['world_coordinates_verified'] or not a['tiles'][k]['outside_rejected']:raise ValueError('Native tile or full audit changed')
        tiles.append({**t,'height_min_m':float(sub.min()),'height_max_m':float(sub.max()),'height_mean_m':float(sub.astype(float).mean())})
    if r['total_tile_bytes']!=sum(t['bytes'] for t in tiles):raise ValueError('Full tile cost changed')
    tif=(folder/r['source_geotiff']['filename']).read_bytes()
    if len(tif)!=r['source_geotiff']['bytes'] or sha(tif)!=r['source_geotiff']['sha256']:raise ValueError('Source GeoTIFF changed')
    DEST.mkdir(parents=True);shutil.copytree(folder/'tiles',DEST/'tiles')
    for name in ['results.json','native-audit.json','reference-grid.f32','source-window.tif']:shutil.copyfile(folder/name,DEST/name)
    impl=DEST/'implementations';impl.mkdir()
    for name in scripts:(impl/Path(name).name).write_bytes((ROOT/name).read_bytes().replace(b'\r\n',b'\n'))
    (DEST/'README.txt').write_text('Fixed 512x512m Manchester centre sample, not whole city. EA 2022 original 1m Float32 source pixels, BNG/ODN metre convention with original source unit metadata caveat.\n64 native GPR4 tiles, each 64x64m and 65x65 original nodes. Original cellwise bilinear source function retained without triangle tessellation. Source-relative agreement is not independently surveyed ground accuracy.\nAll 532544 internal/node queries and 14448 seam pairs checked; C0 heights and along-seam derivatives agree, normal derivatives may jump. Full raw reference grid included for reproduction, not an application preload.\nActual GeoTIFF pixels and georeference unchanged; footprint 513x513m, between-centre function domain 512x512m. No raster-storage, ArcGIS software or heap-memory superiority claim.\nNative file bytes and execution coefficients are different costs. Tile loading avoids mandatory full-dataset fetch; native-query correctness audit is not a browser performance benchmark.\nSource: Environment Agency, OGL v3.0; original source identity and metadata caveat in results.json.\n',encoding='utf8',newline='\n')
    with zipfile.ZipFile(DEST/'ruled-terrain-tiles-evidence.zip','x',compression=zipfile.ZIP_DEFLATED) as archive:
        for p in sorted(DEST.rglob('*')):
            if p.is_file() and p.name!='ruled-terrain-tiles-evidence.zip':
                info=zipfile.ZipInfo('ruled-terrain-tiles-v1/'+p.relative_to(DEST).as_posix(),(2026,10,6,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;archive.writestr(info,p.read_bytes(),compresslevel=9)
    package=(DEST/'ruled-terrain-tiles-evidence.zip').read_bytes();summary={**r,'tiles':tiles,'report_sha256':sha(raw),'native_audit_sha256':sha(auditraw),'audit_summary':{k:a[k] for k in ['total_internal_queries','total_source_node_queries','seam_midpoint_pairs','seam_source_node_pairs','max_seam_height_difference_m','max_tangential_gradient_difference']},'scripts':scripts,'package':{'filename':'ruled-terrain-tiles-evidence.zip','bytes':len(package),'sha256':sha(package)}};body=sb.packed(summary);(DEST/'publication.json').write_bytes(body);SUMMARY.write_bytes(body);print('Published original-resolution ruled tiles, source GeoTIFF and all native query/seam evidence',flush=True)
if __name__=='__main__':publish(Path(sys.argv[1]))
