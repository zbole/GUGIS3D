"""Extract only hash-verified published models for the local research viewer."""
import json
from pathlib import Path
from zipfile import ZipFile
from build_bristol_terrain_benchmark import ROOT,digest,Terrain


def main():
    parents={name:(ROOT/'shared'/name).read_bytes() for name in ('bristol-certified-terrain.json','bristol-local-partition.json')}
    base=json.loads(parents['bristol-certified-terrain.json']);local=json.loads(parents['bristol-local-partition.json'])
    if local['parent_sha256']!=digest(parents['bristol-certified-terrain.json']):raise ValueError('Derivative source changed')
    public=ROOT/'frontend/public/research/bristol-viewer'
    report={'schema':'gugis-bristol-research-viewer-v1',
            'parents':{k:digest(v) for k,v in parents.items()},
            'publisher_sha256':digest(Path(__file__).read_bytes().replace(b'\r\n',b'\n')),
            'coordinate_scope':'BNG offsets displayed 1:1 in an abstract local frame at zero longitude/latitude; no city georeferencing or vertical datum conversion. Native X/Y/Z unchanged.',
            'models':[]}
    for case in base['cases']:
        counterpart=next(c for c in local['cases'] if c['id']==case['id'])
        for target in (.1,.25,.5):
            variants={'global_compact':(case,next(p for p in case['variants'] if p['target_m']==target)['compact_hybrid'],'bristol-certified'),
                      'local_triangles':(case,next(p for p in case['variants'] if p['target_m']==target)['local_triangles'],'bristol-certified'),
                      'local_compact':(counterpart,next(p for p in counterpart['variants'] if p['target_m']==target)['compact_local_hybrid'],'bristol-local-partition')}
            for family,(source,model,prefix) in variants.items():
                archive_path=ROOT/'frontend/public/research'/prefix/source['download']['filename']
                if digest(archive_path.read_bytes())!=source['download']['sha256']:raise ValueError('Published package changed')
                with ZipFile(archive_path) as archive:content=archive.read(model['filename'])
                if len(content)!=model['bytes'] or digest(content)!=model['sha256']:raise ValueError('Model differs from parent receipt')
                parsed=Terrain.model_validate(json.loads(content))
                if parsed.demonstration or parsed.vertical_datum!='ODN' or any(p.kind=='triangle-fan' for p in parsed.patches):
                    raise ValueError('Expected real-source ODN strips only')
                filename=f'{family}-{target:g}m.json';folder=public/'models'/case['id'];folder.mkdir(parents=True,exist_ok=True)
                (folder/filename).write_bytes(content)
                report['models'].append({'case_id':case['id'],'case_name':case['name'],'family':family,'target_m':target,
                                         'filename':filename,'bytes':len(content),'sha256':digest(content),'points':len(parsed.points),
                                         'continuous_bound_m':model['continuous_bound_m'],'rmse_m':model['query_audit']['rmse_m'],
                                         'source_package_sha256':source['download']['sha256']})
    content=(json.dumps(report,ensure_ascii=False,indent=2)+'\n').encode()
    (ROOT/'shared/bristol-viewer-models.json').write_bytes(content);(public/'models.json').write_bytes(content)


if __name__=='__main__':main()
