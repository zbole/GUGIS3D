"""Prepare a reproducible public extract without unrelated contact/free text.

The original download and manifest remain unchanged in the retention directory.
Only tag filtering is allowed: every object identifier and geometry is retained.
Output paths are new staging files, never formal-city or existing seed writes.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
from collections import Counter
from acquire_city_samples import atomic_new, MAX_BYTES

DROP_TAGS={'phone','email','fax','mobile','website','url','note','description'}


def public_source(raw, manifest):
    if len(raw)>MAX_BYTES or len(raw)!=manifest.get('bytes') or hashlib.sha256(raw).hexdigest()!=manifest.get('sha256'):
        raise ValueError('Retained source length or checksum is invalid')
    city_id=manifest.get('city_id')
    if not isinstance(city_id,str) or not re.fullmatch(r'[a-z][a-z0-9-]{0,60}',city_id):
        raise ValueError('Invalid retained source city identifier')
    source=json.loads(raw)
    if not isinstance(source,dict) or not isinstance(source.get('elements'),list) or source.get('remark'):
        raise ValueError('Retained source is not a complete OSM result')
    counts=Counter();elements=[]
    for element in source['elements']:
        if not isinstance(element,dict):raise ValueError('Invalid OSM element')
        tags=element.get('tags',{})
        if not isinstance(tags,dict):raise ValueError('Invalid OSM tags')
        filtered={}
        for key,value in tags.items():
            if key in DROP_TAGS or key.startswith('contact:') or key.startswith('note:') or key.startswith('description:'):
                counts[key]+=1
            else:filtered[key]=value
        elements.append({**element,**({'tags':filtered} if 'tags' in element else {})})
    filtered_source={**source,'elements':elements}
    content=(json.dumps(filtered_source,ensure_ascii=False,separators=(',',':'))+'\n').encode()
    result={**manifest,'sha256':hashlib.sha256(content).hexdigest(),'bytes':len(content),
        'retained_download_sha256':manifest['sha256'],'retained_download_bytes':len(raw),
        'publication_filter':{'method':'Only unrelated contact and free-text tags removed; original IDs, geometry, modelling tags and attribution retained.',
            'removed_tag_counts':dict(sorted(counts.items()))},
        'preparer_source_sha256':hashlib.sha256(Path(__file__).read_bytes().replace(b'\r\n',b'\n')).hexdigest()}
    return content,result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--city',required=True);parser.add_argument('--source-dir',type=Path,required=True)
    parser.add_argument('--output-dir',type=Path,required=True);args=parser.parse_args()
    if not re.fullmatch(r'[a-z][a-z0-9-]{0,60}',args.city):parser.error('Invalid city identifier')
    outputs=[args.output_dir/f'{args.city}-osm.json',args.output_dir/f'{args.city}-source.json']
    if any(path.exists() for path in outputs):parser.error('Output exists; choose a new staging directory')
    raw=(args.source_dir/f'{args.city}-osm.json').read_bytes()
    manifest=json.loads((args.source_dir/f'{args.city}-source.json').read_bytes())
    if manifest.get('city_id')!=args.city:parser.error('Requested city differs from source manifest')
    content,result=public_source(raw,manifest);args.output_dir.mkdir(parents=True,exist_ok=True)
    atomic_new(outputs[0],content)
    atomic_new(outputs[1],(json.dumps(result,ensure_ascii=False,indent=2)+'\n').encode())
    print(json.dumps({'city':args.city,'raw_bytes':len(raw),'public_bytes':len(content),
        'removed_tags':sum(result['publication_filter']['removed_tag_counts'].values()),'sha256':result['sha256']}))


if __name__=='__main__':main()
