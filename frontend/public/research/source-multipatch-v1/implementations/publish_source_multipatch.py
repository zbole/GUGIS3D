"""Verify all actual exports before publishing the additive MultiPatch control."""
import csv,hashlib,json,shutil,sys,tempfile,zipfile
from pathlib import Path
from reportlab.graphics.shapes import Drawing,Rect,String
from reportlab.graphics import renderSVG
from reportlab.lib.colors import HexColor
import source_multipatch as mp
ROOT=mp.ROOT;DEST=ROOT/'frontend/public/research/source-multipatch-v1';SUMMARY=ROOT/'shared/source-multipatch-v1.json'
def sha(b):return hashlib.sha256(b).hexdigest()
def verify(folder):
    raw=(folder/'results.json').read_bytes();r=json.loads(raw);sraw=(mp.SOURCE/'publication.json').read_bytes();source=json.loads(sraw);reader=mp.pyshp_reader();prj=mp.PRJ.read_bytes()
    if r['schema']!='gugis-source-multipatch-v1' or sha(sraw)!=r['source_publication_sha256'] or sha(prj)!=r['prj_sha256'] or sha(Path(mp.__file__).read_bytes().replace(b'\r\n',b'\n'))!=r['source_script_sha256'] or [c['id'] for c in r['cases']]!=[c['id'] for c in source['cases']]:raise ValueError('Changed source or complete fixed case set')
    if r['independent_reader']!={'name':'PyShp','version':reader.__version__,'module_sha256':sha(Path(reader.__file__).read_bytes().replace(b'\r\n',b'\n'))}:raise ValueError('Independent reader changed')
    for c,s in zip(r['cases'],source['cases']):
        folder_case=folder/c['id'];native=next(m for m in s['models'] if m['family']=='source_p1');rawref=(mp.SOURCE/c['id']/'reference.json').read_bytes();rawmodel=(mp.SOURCE/c['id']/native['filename']).read_bytes();binmodel=(mp.SOURCE/c['id']/native['binary_filename']).read_bytes()
        if sha(rawref)!=c['reference_sha256'] or sha(rawmodel)!=c['source_p1_sha256'] or sha(binmodel)!=c['source_p1_binary_sha256'] or len(binmodel)!=c['native_p1_bytes'] or c['native_p1_bytes']!=native['binary_bytes']:raise ValueError('Source native files changed')
        if (c['e2_source_m2'],c['rms_source_m'],c['maximum_source_difference_m'])!=(native['e2_m2'],native['rms_integral_m'],native['maximum_residual_m']):raise ValueError('Source P1 residual changed')
        actual_cost=0
        for name,v in c['files'].items():
            body=(folder_case/name).read_bytes();actual_cost+=len(body)
            if len(body)!=v['bytes'] or sha(body)!=v['sha256']:raise ValueError('Actual five-file component changed')
        if set(c['files'])!={'terrain.'+ext for ext in ['shp','shx','dbf','prj','cpg']} or actual_cost!=c['bytes'] or c['saving_percent']!=100*(1-len(binmodel)/actual_cost):raise ValueError('Complete cost or saving changed')
        reference=json.loads(rawref);model=json.loads(rawmodel)
        with tempfile.TemporaryDirectory(dir=ROOT/'.local/qa') as temp:
            expected=Path(temp)/'fresh';cost=mp.write_files(reference,c['id'],expected,prj)
            for name in c['files']:
                if (expected/name).read_bytes()!=(folder_case/name).read_bytes():raise ValueError('Re-export differs')
        if cost['files']!=c['files'] or cost['parts']!=c['parts'] or cost['vertex_entries']!=c['vertex_entries'] or cost['triangles']!=c['triangles'] or c['measure_array_present'] is not False:raise ValueError('Topology or optional measure cost changed')
        audit=mp.readback(folder_case,model,reader,c['id'])
        if audit!=c['readback']:raise ValueError('Independent complete face audit differs')
        package=(folder_case/c['package']['filename']).read_bytes()
        if len(package)!=c['package']['bytes'] or sha(package)!=c['package']['sha256']:raise ValueError('Component ZIP changed')
        with zipfile.ZipFile(folder_case/c['package']['filename']) as z:
            if set(z.namelist())!=set(c['files']) or len(z.namelist())!=5:raise ValueError('Five-file ZIP incomplete')
            for name in c['files']:
                if z.read(name)!=(folder_case/name).read_bytes():raise ValueError('ZIP member changes component bytes')
        print(c['id']+': full geometry, all bytes, complete ZIP and source function independently rechecked',flush=True)
    return r,raw
def plot(r):
    d=Drawing(1050,410);font='Helvetica';green='#278c78';c=r['cases'][0];ratio=c['native_p1_bytes']/c['bytes']
    def text(x,y,v,size=11,color='#426557'):d.add(String(x,y,v,fontName=font,fontSize=size,fillColor=HexColor(color)))
    text(24,374,'Same source P1 surface, smaller complete native files',19)
    text(24,344,'All 20 fixed real-DTM sites: exact same 8,192 triangles, 4,096 m2 domain and Float64 Z.',11)
    for y,name,bytes_,color in [(268,'Compact MultiPatch / five files',c['bytes'],'#6f889f'),(202,'GUGIS shared XYZ / GPR4',c['native_p1_bytes'],green)]:
        text(24,y+17,name,12);d.add(Rect(300,y,610*bytes_/c['bytes'],18,fillColor=HexColor(color),strokeColor=None));text(920,y+4,f'{bytes_:,} B',11)
    text(24,149,f"{100*(1-ratio):.1f}% smaller actual files; MultiPatch omits the optional M array.",15,green)
    text(24,114,'The baseline uses one feature and 64 upward column strips; no degenerate or repeated faces.',11)
    text(24,88,'Independent PyShp readback checks every source face, Z, area, .shx record and .dbf identity.',11)
    text(24,62,'Ruled bands have the same native bytes, but retain the source bilinear function between nodes.',11)
    text(24,33,'Disk-format result only. No ArcGIS software run, CPU/GPU/heap claim or optimal-code proof.',11)
    return renderSVG.drawToString(d).encode()
def publish(folder):
    if DEST.exists() or SUMMARY.exists():raise FileExistsError('Additive release must be new')
    r,raw=verify(folder);DEST.mkdir(parents=True);(DEST/'results.json').write_bytes(raw);(DEST/'source-publication.json').write_bytes((mp.SOURCE/'publication.json').read_bytes())
    for c in r['cases']:
        output=DEST/c['id'];output.mkdir()
        for name in [*c['files'],c['package']['filename']]:shutil.copyfile(folder/c['id']/name,output/name)
        for name in ['reference.json','source_p1.json','source_p1.bin','ruled.json','ruled.bin']:shutil.copyfile(mp.SOURCE/c['id']/name,output/name)
    with (DEST/'sites.csv').open('w',encoding='utf8',newline='') as f:
        fields=['id','native_p1_bytes','multipatch_five_file_bytes','saving_percent','source_p1_e2_m2','source_p1_rms_m','triangles','vertex_entries','measure_array_present','all_faces_upward','face_sha256'];writer=csv.DictWriter(f,fieldnames=fields);writer.writeheader()
        for c in r['cases']:writer.writerow({'id':c['id'],'native_p1_bytes':c['native_p1_bytes'],'multipatch_five_file_bytes':c['bytes'],'saving_percent':c['saving_percent'],'source_p1_e2_m2':c['e2_source_m2'],'source_p1_rms_m':c['rms_source_m'],'triangles':c['triangles'],'vertex_entries':c['vertex_entries'],'measure_array_present':False,'all_faces_upward':True,'face_sha256':c['readback']['face_sha256']})
    (DEST/'same-source-format-results.svg').write_bytes(plot(r));scripts={'data-pipeline/source_multipatch.py':r['source_script_sha256'],'data-pipeline/publish_source_multipatch.py':sha(Path(__file__).read_bytes().replace(b'\r\n',b'\n'))};impl=DEST/'implementations';impl.mkdir()
    for p in scripts:(impl/Path(p).name).write_bytes((ROOT/p).read_bytes().replace(b'\r\n',b'\n'))
    (DEST/'README.txt').write_text('All 20 fixed real source-DTM windows: exact same P1 surface in native GPR4 and optional-M-free MultiPatch.\nActual .shp/.shx/.dbf/.prj/.cpg bytes; one feature, 64 upward column strips, 8320 XYZ entries, 8192 nondegenerate faces. Native row-strip faces and MultiPatch column-strip faces match exactly.\nIndependent PyShp 3.1.6 readback, complete geometric equivalence, index and identity checks. Re-exported bytes checked before publication.\nOriginal source reference grids and checksum-bound source-native models included. Sources: EA 2022, OGL v3.0. BNG XY, source ODN/metre convention retained in source-publication.json including unit metadata warning. Horizontal PRJ does not encode vertical datum.\nFile-format cost only; no ArcGIS Pro software execution or CPU/GPU/heap benchmark. No optimal coding proof. Smaller regular Float32 grid and lossless GeoTIFF controls remain in the source-native-bands-v1 release.\nSpec: '+mp.SPEC+'\n',encoding='utf8',newline='\n')
    with zipfile.ZipFile(DEST/'source-multipatch-evidence.zip','x',compression=zipfile.ZIP_DEFLATED) as z:
        for p in sorted(DEST.rglob('*')):
            if p.is_file() and p.name!='source-multipatch-evidence.zip':
                info=zipfile.ZipInfo('source-multipatch-v1/'+p.relative_to(DEST).as_posix(),(2026,10,6,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,p.read_bytes(),compresslevel=9)
    package=(DEST/'source-multipatch-evidence.zip').read_bytes();summary={**r,'scripts':scripts,'report_sha256':sha(raw),'csv_sha256':sha((DEST/'sites.csv').read_bytes()),'figure_sha256':sha((DEST/'same-source-format-results.svg').read_bytes()),'package':{'filename':'source-multipatch-evidence.zip','bytes':len(package),'sha256':sha(package)}};body=mp.packed(summary);(DEST/'publication.json').write_bytes(body);SUMMARY.write_bytes(body);print('Published complete exact-source MultiPatch comparison for all 20 sites',flush=True)
if __name__=='__main__':publish(Path(sys.argv[1]))
