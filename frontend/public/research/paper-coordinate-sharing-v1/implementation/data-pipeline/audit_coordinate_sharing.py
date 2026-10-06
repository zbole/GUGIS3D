"""Independent exact-bit decoder and exhaustive minima for the GPC1 archive."""
import argparse,hashlib,json,struct
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def sha(b):return hashlib.sha256(b).hexdigest()
def fail_if(condition,message):
    if condition:raise ValueError(message)

def restore(blob):
    fail_if(not 64<=len(blob)<=2000000,'Invalid compact length')
    magic,version,flags,distinct,length=struct.unpack_from('<4sHHII',blob)
    count,records=struct.unpack_from('<II',blob,24)
    fail_if((magic,version,flags)!=(b'GPC1',1,1),'Invalid compact header')
    fail_if(not 3<=distinct<=count<=20000 or not 1<=records<=8192 or not 48+24*count+24*records<=length<=2000000,'Invalid compact capacity')
    start=64+distinct*16;end=start+count*12
    fail_if(end+records*24>len(blob) or length!=48+count*24+len(blob)-end,'Invalid compact extent')
    table=[blob[64+16*i:80+16*i] for i in range(distinct)]
    fail_if(len(set(table))!=distinct,'Duplicate XY dictionary entry')
    points=[];seen=set()
    for i in range(count):
        offset=start+12*i;index=struct.unpack_from('<I',blob,offset)[0]
        fail_if(index>=distinct,'Invalid XY index')
        if index not in seen:
            fail_if(index!=len(seen),'Wrong dictionary order');seen.add(index)
        points.append(table[index]+blob[offset+4:offset+12])
    fail_if(len(seen)!=distinct,'Unused XY entry')
    return blob[16:64]+b''.join(points)+blob[end:]

def audit(folder):
    protocol_bytes=(folder/'protocol.json').read_bytes();p=json.loads(protocol_bytes)
    raw=(ROOT/p['input']).read_bytes();fail_if(sha(raw)!=p['input_sha256'],'Frozen input changed')
    parent=(ROOT/'data-pipeline/compact_principal_protocol.json').read_bytes().replace(b'\r\n',b'\n')
    fail_if(sha(parent)!=p['parent_protocol_sha256'],'Rejected v1 protocol changed')
    r=json.loads((folder/'results.json').read_bytes());source=json.loads(raw)
    fail_if(r['source_report_sha256']!=sha(raw) or r['protocol_sha256']!=sha(protocol_bytes),'Bad report source identity')
    fail_if([c['id'] for c in r['cases']]!=[c['id'] for c in source['cases']],'Incomplete case set')
    frozen=ROOT/'frontend/public/research/paper-adaptive-projection-v1/implementation/frontend/src/compare/principalRuledMath.ts'
    normalize=lambda path:path.read_bytes().replace(b'\r\n',b'\n')
    fail_if(normalize(frozen)!=normalize(ROOT/'frontend/src/compare/principalRuledMath.ts'),'Original query kernel changed')
    script_paths={'codec_sha256':'frontend/src/compare/compactPrincipalBinary.ts','frozen_kernel_sha256':'frontend/src/compare/principalRuledMath.ts','producer_sha256':'frontend/scripts/build-coordinate-sharing.mjs'}
    for key,path in script_paths.items():fail_if(sha(normalize(ROOT/path))!=r['implementation'][key],'Implementation receipt changed')
    stats=dict(original_bytes=0,compact_bytes=0,smaller=0,equal=0,larger=0,full_byte_roundtrips=0);selections=0;files={};summary={}
    for c,old in zip(r['cases'],source['cases']):
        for key in ('id','name','field','source_frame','angle_degrees','provenance'):
            fail_if(c[key]!=old[key],'Original case or provenance changed')
        fail_if(set(c['models'])!=set(old['models']),'Missing or extra native model')
        for key,e in c['models'].items():
            original=old['models'][key];fail_if(e['original']!=original or e['e2_m2']!=original['e2_m2'],'Saved original error changed')
            source_path=f"{original['package']}/{c['id']}/{original['binary_filename']}"
            old_blob=(ROOT/'frontend/public/research'/source_path).read_bytes()
            fail_if(len(old_blob)!=original['binary_bytes'] or sha(old_blob)!=original['binary_sha256'],'Original model changed')
            filename=f"{original['method']}--{original['binary_filename'][:-4]}.gpc"
            fail_if(e['binary_filename']!=filename or e['package']!='paper-coordinate-sharing-v1','Compact identity changed')
            blob=(folder/'native'/c['id']/filename).read_bytes();restored=restore(blob)
            fail_if(len(blob)!=e['binary_bytes'] or sha(blob)!=e['binary_sha256'] or restored!=old_blob,'Exact original bytes not restored')
            fail_if(e['xy_dictionary_entries']!=struct.unpack_from('<I',blob,8)[0],'Wrong dictionary count')
            files[f"{c['id']}/{filename}"]={'bytes':len(blob),'sha256':sha(blob),'original_path':source_path,'original_bytes':len(old_blob),'original_sha256':sha(old_blob)}
            stats['original_bytes']+=len(old_blob);stats['compact_bytes']+=len(blob);stats['full_byte_roundtrips']+=1
            stats['smaller' if len(blob)<len(old_blob) else 'equal' if len(blob)==len(old_blob) else 'larger']+=1
        for method in p['methods']:
            fail_if(set(c['candidates'][method])!=set(old['candidates'][method]),'Incomplete finite candidate set')
            keys=c['candidates'][method];front=[]
            for k in keys:
                x=c['models'][k]
                if not any(q!=k and c['models'][q]['binary_bytes']<=x['binary_bytes'] and c['models'][q]['e2_m2']<=x['e2_m2'] and (c['models'][q]['binary_bytes']<x['binary_bytes'] or c['models'][q]['e2_m2']<x['e2_m2']) for q in keys):front.append(k)
            fail_if(set(front)!=set(c['frontiers'][method]),'Incorrect finite Pareto frontier')
        field=c['field']['id'];summary.setdefault(field,{mode:dict(wins=0,ties=0,losses=0,only_fitted=0,only_adaptive=0,neither=0) for mode in ('byte_rows','error_rows')})
        for mode,threshold,targets,column in [('byte_rows','ceiling_bytes',p['byte_ceilings'],'e2_m2'),('error_rows','target_e2_m2',p['e2_targets_m2'],'binary_bytes')]:
            fail_if([row[threshold] for row in c[mode]]!=targets,'Changed thresholds or incomplete rows')
            for row in c[mode]:
                for method in p['methods']:
                    candidates=[k for k in c['candidates'][method] if c['models'][k]['binary_bytes' if mode=='byte_rows' else 'e2_m2']<=row[threshold]]
                    order=lambda k:(c['models'][k][column],c['models'][k]['binary_bytes' if mode=='byte_rows' else 'e2_m2'],c['models'][k]['binary_filename'])
                    expected=min(candidates,key=order) if candidates else None
                    fail_if(row['selected'][method]!=expected,'Fabricated minimum or missing result');selections+=1
                f,a=row['selected']['fitted'],row['selected']['adaptive_pt']
                status=('only_fitted' if f else 'only_adaptive' if a else 'neither') if not f or not a else ('wins' if c['models'][f][column]<c['models'][a][column] else 'ties' if c['models'][f][column]==c['models'][a][column] else 'losses')
                summary[field][mode][status]+=1
    fail_if(stats!=r['stats'] or files!=r['native_files'] or summary!=r['summary'],'Wrong aggregate, receipts or complete outcomes')
    actual={path.relative_to(folder/'native').as_posix() for path in (folder/'native').rglob('*') if path.is_file()}
    fail_if(actual!=set(files),'Extra or missing compact binary')
    return {'schema':'gugis-coordinate-sharing-independent-audit-v1','report_sha256':sha((folder/'results.json').read_bytes()),'source_report_sha256':sha(raw),'protocol_sha256':sha(protocol_bytes),'cases_checked':len(r['cases']),'exact_full_byte_restorations':stats['full_byte_roundtrips'],'independent_decisions_checked':selections,'stats':stats,'summary':summary,'audit_implementation_sha256':sha(normalize(Path(__file__))),'scope':'Separate Python struct decoder reproduces every original GPR3 byte and native receipt. Finite minima, all missing results and losses checked exhaustively; E2 inherited only from byte-identical frozen models, no new error fit, timing or ArcGIS run.'}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('folder',type=Path);args=p.parse_args()
    result=audit(args.folder);(args.folder/'independent-audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print(json.dumps(result,ensure_ascii=False,indent=2))
