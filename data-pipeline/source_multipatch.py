"""Compact real-source MultiPatch baseline. Optional M coordinates are absent.

All 20 frozen source windows, not a fitted subset. Actual five-file costs and
full directed-face readback; no ArcGIS software execution or performance claim.
"""
import hashlib,importlib.util,json,math,struct,sys,zipfile
from collections import Counter
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'frontend/public/research/source-native-bands-v1'
PRJ=ROOT/'frontend/public/research/multicity-terrain/manchester-centre/local-triangles-10cm.prj'
READER=ROOT/'.venv/Lib/site-packages/shapefile.py'
SPEC='https://www.esri.com/library/whitepapers/pdfs/shapefile.pdf'
def sha(b):return hashlib.sha256(b).hexdigest()
def packed(x):return json.dumps(x,separators=(',',':'),allow_nan=False).encode()
def pyshp_reader():
    if READER.is_file():
        spec=importlib.util.spec_from_file_location('source_independent_pyshp',READER);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
    import shapefile
    return shapefile
def make_header(length,bounds):
    if length%2 or length<100:raise ValueError('Invalid Shapefile file length')
    return struct.pack('>7i',9994,0,0,0,0,0,length//2)+struct.pack('<2i8d',1000,31,*bounds,0,0)
def dbf(site):
    fields=[('SITE_ID',32),('SURFACE',16)];head=bytearray(32);head[:4]=bytes([3,126,10,6]);struct.pack_into('<IHH',head,4,1,97,49)
    out=bytearray(head)
    for name,size in fields:
        descriptor=bytearray(32);descriptor[:len(name)]=name.encode('ascii');descriptor[11]=ord('C');descriptor[16]=size;out.extend(descriptor)
    out.append(13);out.extend(b' ')
    for value,(_,size) in zip([site,'SOURCE_P1'],fields):
        raw=value.encode('ascii')
        if len(raw)>size:raise ValueError('DBF field capacity exceeded')
        out.extend(raw.ljust(size,b' '))
    out.append(26);return bytes(out)
def write_files(reference,site,destination,prj):
    if destination.exists():raise FileExistsError('Fresh output directory required')
    z=np.asarray(reference['height'],float);origin=np.asarray(reference['origin_bng'],float)
    if z.shape!=(65,65) or not np.isfinite(z).all() or reference['x']!=list(range(-32,33)) or reference['y']!=list(range(-32,33)):raise ValueError('Complete source window required')
    # Column strips orient every original anti-diagonal face upward. Geometry
    # equals the source-node row strips, with no degenerate or padding triangles.
    strips=[[(float(i+k-32+origin[0]),float(j-32+origin[1]),float(z[j,i+k])) for j in range(65) for k in (0,1)] for i in range(64)]
    points=[p for strip in strips for p in strip];n=len(points);bounds=[origin[0]-32,origin[1]-32,origin[0]+32,origin[1]+32,float(z.min()),float(z.max())]
    body=bytearray(struct.pack('<i4d2i',31,*bounds[:4],64,n));body.extend(struct.pack('<64i',*[130*i for i in range(64)]));body.extend(struct.pack('<64i',*([0]*64)))
    for x,y,_ in points:body.extend(struct.pack('<2d',x,y))
    body.extend(struct.pack('<2d',*bounds[4:]));body.extend(struct.pack('<'+'d'*n,*[p[2] for p in points]))
    length=100+8+len(body);files={'terrain.shp':make_header(length,bounds)+struct.pack('>2i',1,len(body)//2)+body,'terrain.shx':make_header(108,bounds)+struct.pack('>2i',50,len(body)//2),'terrain.dbf':dbf(site),'terrain.prj':prj,'terrain.cpg':b'UTF-8\n'}
    destination.mkdir(parents=True)
    for name,data in files.items():(destination/name).write_bytes(data)
    return {'files':{name:{'bytes':len(data),'sha256':sha(data)} for name,data in files.items()},'bytes':sum(len(data) for data in files.values()),'parts':64,'vertex_entries':n,'triangles':8192,'measure_array_present':False}
def canonical_face(points):return tuple(sorted(tuple(float(v) for v in p) for p in points))
def expected_faces(model):
    points=np.asarray(model['points'],float);points[:,:2]+=np.asarray(model['origin_bng']);out=Counter()
    for patch in model['patches']:
        if patch['kind']!='triangle-strip':raise ValueError('Source P1 strips required')
        ids=patch['indices']
        for k in range(len(ids)-2):out[canonical_face(points[ids[k:k+3]])]+=1
    return out
def readback(folder,model,reader,site=None):
    # Independent library consumes the actual .shp/.shx/.dbf, not producer arrays.
    with reader.Reader(str(folder/'terrain'),encoding='utf-8') as r:
        if r.shapeType!=31 or len(r)!=1:raise ValueError('Changed MultiPatch feature count/type')
        record=r.record(0)
        if site is not None and str(record[0]).strip()!=site:raise ValueError('DBF site identity missing')
        if str(record[1]).strip()!='SOURCE_P1':raise ValueError('DBF surface identity missing')
        shape=r.shape(0)
        if list(shape.partTypes)!=[0]*64 or list(shape.parts)!=[130*i for i in range(64)] or len(shape.points)!=8320 or len(shape.z)!=8320:raise ValueError('Lost native strips or Z coordinates')
        if any(v is not None for v in shape.m):raise ValueError('Unexpected measure values')
        xyz=[(p[0],p[1],z) for p,z in zip(shape.points,shape.z)];actual=Counter();area=[];upward=True
        for start,end in zip(shape.parts,list(shape.parts[1:])+[len(xyz)]):
            for k in range(end-start-2):
                ids=[start+k,start+k+1,start+k+2]
                if k%2:ids[0],ids[1]=ids[1],ids[0]
                p=[xyz[i] for i in ids];det=(p[1][0]-p[0][0])*(p[2][1]-p[0][1])-(p[1][1]-p[0][1])*(p[2][0]-p[0][0]);upward=upward and det>0;area.append(abs(det)/2);actual[canonical_face(p)]+=1
        expected=expected_faces(model)
        if actual!=expected or sum(actual.values())!=8192 or len(actual)!=8192 or math.fsum(area)!=4096 or not upward:raise ValueError('Saved MultiPatch does not preserve every source P1 face')
        # Header/index bounds and offsets audited independently of library parsing.
        shp=(folder/'terrain.shp').read_bytes();shx=(folder/'terrain.shx').read_bytes()
        for data in [shp,shx]:
            if struct.unpack_from('>i',data,24)[0]*2!=len(data) or struct.unpack_from('<ii',data,28)!=(1000,31):raise ValueError('Invalid SHP/SHX length or type')
        if struct.unpack_from('>ii',shx,100)!=(50,(len(shp)-108)//2) or struct.unpack_from('>ii',shp,100)!=(1,(len(shp)-108)//2):raise ValueError('SHX does not address full record')
        if len(shp)!=200360:raise ValueError('Optional-M-free record size changed')
        digest=sha(packed([[list(p) for p in tri] for tri in sorted(actual)]))
        return {'reader':'PyShp','reader_version':reader.__version__,'same_8192_source_faces':True,'no_duplicate_faces':True,'all_faces_upward':True,'area_m2':4096,'face_sha256':digest,'record_and_index_verified':True}
def build(folder):
    if folder.exists():raise FileExistsError('Fresh private output required')
    raw=(SOURCE/'publication.json').read_bytes();report=json.loads(raw);reader=pyshp_reader();prj=PRJ.read_bytes()
    if b'British_National_Grid' not in prj or b'Transverse_Mercator' not in prj:raise ValueError('Unexpected frozen BNG WKT')
    reader_path=Path(reader.__file__);folder.mkdir(parents=True);rows=[]
    for case in report['cases']:
        refraw=(SOURCE/case['id']/'reference.json').read_bytes()
        if sha(refraw)!=case['reference_sha256']:raise ValueError('Source reference changed')
        source=next(m for m in case['models'] if m['family']=='source_p1');modelraw=(SOURCE/case['id']/source['filename']).read_bytes()
        native=(SOURCE/case['id']/source['binary_filename']).read_bytes()
        if sha(modelraw)!=source['sha256'] or sha(native)!=source['binary_sha256'] or len(native)!=source['binary_bytes']:raise ValueError('Source P1 changed')
        destination=folder/case['id'];cost=write_files(json.loads(refraw),case['id'],destination,prj);audit=readback(destination,json.loads(modelraw),reader,case['id'])
        with zipfile.ZipFile(destination/'source-multipatch.zip','x',compression=zipfile.ZIP_DEFLATED) as z:
            for name in cost['files']:
                info=zipfile.ZipInfo(name,(2026,10,6,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,(destination/name).read_bytes(),compresslevel=9)
        package=(destination/'source-multipatch.zip').read_bytes();row={'id':case['id'],'city_id':case['city_id'],'name':case['name'],'reference_sha256':case['reference_sha256'],'source_p1_sha256':source['sha256'],'source_p1_binary_sha256':source['binary_sha256'],'native_p1_bytes':source['binary_bytes'],'e2_source_m2':source['e2_m2'],'rms_source_m':source['rms_integral_m'],'maximum_source_difference_m':source['maximum_residual_m'],**cost,'readback':audit,'saving_percent':100*(1-source['binary_bytes']/cost['bytes']),'package':{'filename':'source-multipatch.zip','bytes':len(package),'sha256':sha(package)}};rows.append(row);print(case['id']+': every face and source P1 function preserved in actual five-file MultiPatch',flush=True)
    result={'schema':'gugis-source-multipatch-v1','source_publication_sha256':sha(raw),'source_report_sha256':report['report_sha256'],'source_script_sha256':sha(Path(__file__).read_bytes().replace(b'\r\n',b'\n')),'specification':SPEC,'prj_source':PRJ.relative_to(ROOT).as_posix(),'prj_sha256':sha(prj),'independent_reader':{'name':'PyShp','version':reader.__version__,'module_sha256':sha(reader_path.read_bytes().replace(b'\r\n',b'\n'))},'scope':'All 20 fixed source DTM windows; exact same 8192 source-node P1 triangles in BNG/ODN. Compact optional-M-free MultiPatch baseline with one feature and 64 upward column strips. Native P1 and GUGIS bilinear bands have equal GPR4 file bytes, but only bands preserve the continuous source bilinear function. No ArcGIS software execution, raster-storage or heap-memory claim. No optimal encoding proof.','cases':rows};(folder/'results.json').write_bytes(packed(result));return result
if __name__=='__main__':build(Path(sys.argv[1]))
