"""Same-control-net, Swiss-CRS MultiPatch triangle-strip file baseline.

Actual files are independently read back. This does not run ArcGIS software.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import time
from zipfile import ZipFile, ZIP_DEFLATED
import numpy as np
import shapefile
from pyproj import CRS
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'backend'))
from app.environment_models import Terrain


def rasterize(reader):
    grid = np.full((1000,1000), np.nan)
    triangle_count = part_count = 0
    for shape in reader.iterShapes():
        if any(kind != shapefile.TRIANGLE_STRIP for kind in shape.partTypes):
            raise ValueError('The benchmark must contain triangle strips only')
        points = np.column_stack([np.asarray(shape.points)-[2494500,1141500], np.asarray(shape.z)])
        ends = [*shape.parts[1:], len(points)]
        for start,end in zip(shape.parts,ends):
            part_count += 1
            strip = points[start:end]
            for i in range(len(strip)-2):
                a,b,c = strip[i:i+3]
                triangle_count += 1
                c0,c1 = max(0,int(np.ceil(min(a[0],b[0],c[0])+499.5))), min(999,int(np.floor(max(a[0],b[0],c[0])+499.5)))
                r0,r1 = max(0,int(np.ceil(min(a[1],b[1],c[1])+499.5))), min(999,int(np.floor(max(a[1],b[1],c[1])+499.5)))
                if c0>c1 or r0>r1:
                    continue
                x,y = np.meshgrid(np.arange(c0,c1+1)-499.5,np.arange(r0,r1+1)-499.5)
                determinant=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
                if abs(determinant)<1e-8:
                    raise ValueError('Degenerate baseline triangle')
                u=((x-a[0])*(c[1]-a[1])-(y-a[1])*(c[0]-a[0]))/determinant
                v=((b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0]))/determinant
                valid=(u>=-1e-8)&(v>=-1e-8)&(u+v<=1+1e-8)
                block=grid[r0:r1+1,c0:c1+1]
                block[valid]=(a[2]+u*(b[2]-a[2])+v*(c[2]-a[2]))[valid]
    if not np.isfinite(grid).all():
        raise ValueError('Read-back MultiPatch leaves reference pixels uncovered')
    return np.flipud(grid),part_count,triangle_count


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input',type=Path,required=True)
    args=parser.parse_args()
    records=[]
    for stride in (2,4,8,16,32,64):
        started=time.perf_counter()
        terrain=Terrain.model_validate_json((args.input/f'gugis-{stride}m.json').read_bytes())
        directory=args.input/f'multipatch-{stride}m'; directory.mkdir(exist_ok=True)
        base=directory/'terrain'
        def xyz(index):
            x,y,z=terrain.points[index];return [x+2494500,y+1141500,z]
        with shapefile.Writer(str(base),shapeType=shapefile.MULTIPATCH,encoding='utf-8') as writer:
            writer.field('PATCH_ID','C',size=16)
            writer.field('SURFACE','C',size=16)
            for patch in terrain.patches:
                if patch.kind=='triangle-strip':
                    parts=[[xyz(i) for i in patch.indices]]
                else:
                    parts=[[xyz(i) for i in (b,a,d,c)] for a,b,c,d in zip(patch.left,patch.right,patch.left[1:],patch.right[1:])]
                writer.multipatch(parts,partTypes=[shapefile.TRIANGLE_STRIP]*len(parts))
                writer.record(patch.id,patch.kind)
        base.with_suffix('.prj').write_text(CRS.from_epsg(2056).to_wkt('WKT1_ESRI'),encoding='utf-8')
        base.with_suffix('.cpg').write_text('UTF-8\n',encoding='ascii')
        construction_ms=(time.perf_counter()-started)*1000
        started=time.perf_counter()
        with shapefile.Reader(str(base)) as reader:
            if reader.shapeType!=shapefile.MULTIPATCH or len(reader)!=len(terrain.patches):
                raise ValueError('MultiPatch record count changed on readback')
            grid,parts,triangles=rasterize(reader)
        np.save(args.input/f'multipatch-{stride}m.npy',grid)
        components=[{'filename':p.name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
                    for p in [base.with_suffix(s) for s in ('.shp','.shx','.dbf','.prj','.cpg')]]
        report={'id':f'multipatch-{stride}m','stride_m':stride,'bytes':sum(p['bytes'] for p in components),
                'components':components,'parts':parts,'triangles':triangles,'construction_ms':construction_ms,
                'readback_rasterization_ms':(time.perf_counter()-started)*1000,
                'status':'file-format-readback-only','horizontal_crs':'EPSG:2056','arcgis_execution':None}
        records.append(report);print(json.dumps(report),flush=True)
        if stride in (8,16):
            package=ROOT/f'frontend/public/research/implicit-terrain/terrain-{stride}m.zip'
            with ZipFile(package,'w',compression=ZIP_DEFLATED) as archive:
                for component in components:archive.write(directory/component['filename'],component['filename'])
                archive.write(args.input/f'gugis-{stride}m.json','gugis-terrain.json')
                archive.writestr('readme.txt',f'Swiss ImplicitTerrain author demo, source SHA a7d90ba9b42712624d82cdfb3b7beae2ef7a2493f88d16846dea82fd8d1bc30d.\nDerived research lattice, {stride} m. MultiPatch XY EPSG:2056; native x/y are projection offsets from (2494500,1141500). Vertical datum unknown.\nNative ruled strips tessellated once; triangle strips unchanged. File-format comparison only; ArcGIS not executed.\nDEM attribution: ImplicitTerrain authors / swissALTI3D, Federal Office of Topography swisstopo.\nhttps://fengyee.github.io/implicit-terrain/\nhttps://www.swisstopo.admin.ch/en/terms-of-use-free-geodata-and-geoservices\nNot a UK city terrain. No author code or pretrained weights included.\n')
    (args.input/'multipatch.json').write_text(json.dumps(records,indent=2)+'\n',encoding='utf-8')


if __name__=='__main__':main()
