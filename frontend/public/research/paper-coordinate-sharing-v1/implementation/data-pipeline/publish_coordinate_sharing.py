"""Publish the exact compact archive, original files and independent evidence."""
import argparse,hashlib,json,shutil,zipfile
from pathlib import Path
from audit_coordinate_sharing import ROOT,audit
DEST=ROOT/'frontend/public/research/paper-coordinate-sharing-v1'
SUMMARY=ROOT/'shared/paper-coordinate-sharing-v1.json'
def sha(blob):return hashlib.sha256(blob).hexdigest()
def packed(value):return (json.dumps(value,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n').encode()

def publish(folder):
    proof=audit(folder);r=json.loads((folder/'results.json').read_bytes())
    if DEST.exists() or SUMMARY.exists():raise FileExistsError('Keep immutable publication; use another version')
    DEST.mkdir()
    for name in ('protocol.json','results.json','all-decisions.csv'):shutil.copyfile(folder/name,DEST/name)
    shutil.copytree(folder/'native',DEST/'native')
    # Retain the rejected declaration as evidence of the pre-measurement gate.
    (DEST/'rejected-protocol-v1.json').write_bytes((ROOT/'data-pipeline/compact_principal_protocol.json').read_bytes().replace(b'\r\n',b'\n'))
    (DEST/'independent-audit.json').write_bytes(packed(proof))
    implementation=DEST/'implementation';implementation.mkdir()
    for relative in ('frontend/src/compare/compactPrincipalBinary.ts','frontend/src/compare/principalRuledMath.ts','frontend/scripts/build-coordinate-sharing.mjs','data-pipeline/audit_coordinate_sharing.py','data-pipeline/publish_coordinate_sharing.py'):
        path=implementation/relative;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes((ROOT/relative).read_bytes().replace(b'\r\n',b'\n'))
    prior=DEST/'prior';prior.mkdir()
    shutil.copyfile(ROOT/'frontend/public/research/paper-finite-frontier-v1/results.json',prior/'finite-frontier-results.json')
    for package in ('variable-curvature-v1','paper-projection-stable-v1','paper-adaptive-projection-v1'):
        target=prior/package;target.mkdir()
        for name in ('protocol.json','results.json','native-audit.json','independent-audit.json'):
            path=ROOT/'frontend/public/research'/package/name
            if path.exists():shutil.copyfile(path,target/name)
    package=DEST/'coordinate-sharing-evidence.zip'
    with zipfile.ZipFile(package,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
        def add(name,blob):
            info=zipfile.ZipInfo(name,date_time=(2026,10,6,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;archive.writestr(info,blob,compresslevel=9)
        for path in sorted(DEST.rglob('*')):
            if path.is_file() and path!=package:add(path.relative_to(DEST).as_posix(),path.read_bytes())
        for receipt in sorted(r['native_files'].values(),key=lambda x:x['original_path']):
            blob=(ROOT/'frontend/public/research'/receipt['original_path']).read_bytes()
            if sha(blob)!=receipt['original_sha256']:raise ValueError('Original changed before packaging')
            add('original/'+receipt['original_path'],blob)
    view={key:r[key] for key in ('schema','cases','defaults','summary','stats','source_report_sha256','protocol_sha256','implementation')}
    view.update(report_sha256=sha((DEST/'results.json').read_bytes()),audit={**proof,'exhaustive_selections':proof['independent_decisions_checked'],'complete_source_files':proof['exact_full_byte_restorations']},package={'filename':package.name,'bytes':package.stat().st_size,'sha256':sha(package.read_bytes())})
    blob=packed(view);SUMMARY.write_bytes(blob);(DEST/'publication.json').write_bytes(blob)
    index={'schema':'gugis-coordinate-sharing-index-v1','files':{path.relative_to(DEST).as_posix():{'bytes':path.stat().st_size,'sha256':sha(path.read_bytes())} for path in sorted(DEST.rglob('*')) if path.is_file()}}
    (DEST/'index.json').write_bytes(packed(index))
    print(json.dumps({'report_sha256':view['report_sha256'],'summary_bytes':len(blob),'indexed_files':len(index['files']),'package':view['package']},indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('folder',type=Path);publish(p.parse_args().folder)
