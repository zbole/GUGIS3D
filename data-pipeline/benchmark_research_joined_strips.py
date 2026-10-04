"""Stronger geometry baseline: join compatible strips without new triangles.

Only exact shared end pairs and even-length strips are joined. Independent
oriented-triangle multiset and raster readback reject changed triangulation.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct
from zipfile import ZipFile, ZIP_DEFLATED
import numpy as np
import shapefile
from benchmark_research_packing import omit_absent_measures, ROOT
from export_research_multipatch import rasterize


def triangles_digest(parts):
    signatures=[]
    for strip in parts:
        for i in range(len(strip)-2):
            a,b,c=strip[i:i+3]
            if i%2:b,c=c,b
            vertices=[struct.pack('<ddd',*p) for p in (a,b,c)]
            # Canonical cyclic rotation retains orientation, not just an XY set.
            rotations=[b''.join(vertices[j:]+vertices[:j]) for j in range(3)]
            signatures.append(hashlib.sha256(min(rotations)).digest())
    signatures.sort()
    return {'triangles':len(signatures),'oriented_triangle_multiset_sha256':hashlib.sha256(b''.join(signatures)).hexdigest()}


def join_strips(parts):
    starts,ends={},{}
    def pair(vertices):return tuple(tuple(p) for p in vertices)
    for i,strip in enumerate(parts):
        if len(strip)%2:continue
        starts.setdefault(pair(strip[:2]),[]).append(i)
        ends.setdefault(pair(strip[-2:]),[]).append(i)
    used=set();output=[];mapping=[None]*len(parts)
    # Start chains at an unmatched end so source ordering does not limit joins.
    order=sorted(range(len(parts)),key=lambda i:pair(parts[i][:2]) in ends)
    for original in order:
        if original in used:continue
        result=[list(p) for p in parts[original]]
        group=len(output);used.add(original);mapping[original]=[group,0,len(result)]
        while len(result)%2==0:
            key=pair(result[-2:]);candidates=starts.get(key,[])
            if len(candidates)!=1 or len(ends.get(key,[]))!=1:break
            following=candidates[0]
            if following in used:break
            offset=len(result)-2
            result.extend(parts[following][2:])
            used.add(following);mapping[following]=[group,offset,len(parts[following])]
        output.append(result)
    for old,(group,start,length) in zip(parts,mapping):
        if output[group][start:start+length]!=old:
            raise ValueError('Joining changed source strip vertices')
    return output,mapping


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input',type=Path,required=True)
    args=parser.parse_args()
    parent_bytes=(ROOT/'shared/implicit-terrain-packing.json').read_bytes()
    parent=json.loads(parent_bytes);records=[]
    for row in parent['variants']:
        stride=row['stride_m'];source=args.input/f'packed-{stride}m';original=source/'terrain'
        for item in row['components']:
            content=(source/item['filename']).read_bytes()
            if len(content)!=item['bytes'] or hashlib.sha256(content).hexdigest()!=item['sha256']:
                raise ValueError('Compact baseline files changed')
        source_parts=[]
        with shapefile.Reader(str(original)) as reader:
            for shape in reader.iterShapes():
                for start,end in zip(shape.parts,[*shape.parts[1:],len(shape.points)]):
                    source_parts.append([[*xy,z] for xy,z in zip(shape.points[start:end],shape.z[start:end])])
        expected=triangles_digest(source_parts)
        joined,mapping=join_strips(source_parts)
        if triangles_digest(joined)!=expected:raise ValueError('Joining changed oriented triangles')
        output=args.input/f'joined-{stride}m';output.mkdir(exist_ok=True);base=output/'terrain'
        with shapefile.Writer(str(base),shapeType=shapefile.MULTIPATCH,encoding='utf-8') as writer:
            writer.field('TERRAIN_ID','C',size=16)
            writer.multipatch(joined,partTypes=[shapefile.TRIANGLE_STRIP]*len(joined))
            writer.record(f'swiss-{stride}m')
        omit_absent_measures(base)
        for ext in ('.prj','.cpg'):base.with_suffix(ext).write_bytes(original.with_suffix(ext).read_bytes())
        (output/'patch-map.json').write_bytes((source/'patch-map.json').read_bytes())
        (output/'join-map.json').write_bytes((json.dumps({'schema':'gugis-strip-join-map-v1',
            'columns':['joined_part_zero_based','first_vertex_zero_based','original_vertex_count'],
            'original_parts':mapping},separators=(',',':'))+'\n').encode())
        readback_parts=[]
        with shapefile.Reader(str(base)) as reader:
            for shape in reader.iterShapes():
                for start,end in zip(shape.parts,[*shape.parts[1:],len(shape.points)]):
                    readback_parts.append([[*xy,z] for xy,z in zip(shape.points[start:end],shape.z[start:end])])
            if triangles_digest(readback_parts)!=expected:raise ValueError('Saved joined triangles changed')
            if stride in (8,16):
                grid,parts,triangles=rasterize(reader)
                reference=np.load(args.input/f'multipatch-{stride}m.npy')
                if not np.array_equal(grid,reference):raise ValueError('Joined readback heights changed')
                difference=float(np.abs(grid-reference).max())
            else:difference=None
        components=[{'filename':p.name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
            for p in [base.with_suffix(ext) for ext in ('.shp','.shx','.dbf','.prj','.cpg')]]
        sidecars=[{'filename':p.name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
            for p in [output/'patch-map.json',output/'join-map.json']]
        geometry_bytes=sum(p['bytes'] for p in components);metadata_bytes=sum(p['bytes'] for p in sidecars)
        result={'id':row['id'],'stride_m':stride,'native_sha256':row['native_sha256'],'native_bytes':row['native_bytes'],
            'before_parts':len(source_parts),'after_parts':len(joined),'before_vertices':sum(map(len,source_parts)),
            'after_vertices':sum(map(len,joined)),'geometry_only_bytes':geometry_bytes,
            'with_patch_metadata_bytes':geometry_bytes+metadata_bytes,'metadata_bytes':metadata_bytes,
            'native_saving_percent':100*(1-row['native_bytes']/geometry_bytes),
            'with_patch_metadata_native_saving_percent':100*(1-row['native_bytes']/(geometry_bytes+metadata_bytes)),
            **expected,'readback_vs_original_max_m':difference,'components':components,'sidecars':sidecars,'arcgis_execution':None}
        records.append(result)
        print(json.dumps({k:result[k] for k in ['id','before_parts','after_parts','geometry_only_bytes','native_saving_percent']}),flush=True)
        if stride in (8,16):
            with ZipFile(ROOT/f'frontend/public/research/implicit-terrain/terrain-{stride}m-joined.zip','w',compression=ZIP_DEFLATED) as archive:
                for item in components+sidecars:archive.write(output/item['filename'],item['filename'])
                archive.write(args.input/f'gugis-{stride}m.json','gugis-terrain.json')
                archive.writestr('readme.txt',f'Joined Triangle Strip XYZ benchmark, {stride} m, one EPSG:2056 terrain feature.\n'
                    'Exact compatible endpoint pairs joined; no added/removed/reversed triangles. Optional absent M omitted.\n'
                    'patch-map.json references original parts; join-map.json locates each original part within a joined strip.\n'
                    'Metadata cannot restore shared point IDs or native ruled surfaces. Uncompressed sizes, not ZIP bytes, compared.\n'
                    'Format/readback audit only. ArcGIS software not executed. Not UK city terrain; vertical datum unknown.\n'
                    'DEM: ImplicitTerrain authors / swissALTI3D, Federal Office of Topography swisstopo.\n'
                    'https://fengyee.github.io/implicit-terrain/\nhttps://www.swisstopo.admin.ch/en/terms-of-use-free-geodata-and-geoservices\n'
                    'No author weights or code included.\n')
    report={'schema':'gugis-joined-triangle-strip-benchmark-v1','parent_packing_sha256':hashlib.sha256(parent_bytes).hexdigest(),
        'source_sha256':parent['source_sha256'],'method':'Join exact compatible even-length endpoint pairs only; unique predecessor and successor. Same oriented triangle multiset before/after and after disk readback, all six variants. Million-pixel readback at 8m/16m. No ArcGIS runtime. Five XYZ components separate from two optional identity-mapping sidecars.',
        'variants':records}
    content=(json.dumps(report,indent=2)+'\n').encode()
    (ROOT/'shared/implicit-terrain-joined.json').write_bytes(content)
    (ROOT/'frontend/public/research/implicit-terrain/joined-results.json').write_bytes(content)


if __name__=='__main__':main()
