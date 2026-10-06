"""Publish finite tradeoff tables and every referenced complete native file."""
import argparse, json, shutil, zipfile
from pathlib import Path
from paper_frontier_analysis import ROOT, sha, packed
from paper_frontier_audit import verify
DEST=ROOT/'frontend/public/research/paper-finite-frontier-v1'
SUMMARY=ROOT/'shared/paper-finite-frontier-v1.json'

def publish(folder):
    audit=verify(folder);r=json.loads((folder/'results.json').read_bytes())
    if DEST.exists() or SUMMARY.exists():raise FileExistsError('Immutable release already exists')
    DEST.mkdir()
    for name in ['results.json','protocol.json','all-decisions.csv']:shutil.copyfile(folder/name,DEST/name)
    (DEST/'independent-audit.json').write_bytes(packed(audit))
    receipts={}
    for package in ['variable-curvature-v1','paper-projection-stable-v1','paper-adaptive-projection-v1']:
        for name in ['results.json','native-audit.json','independent-audit.json','protocol.json']:
            path=ROOT/'frontend/public/research'/package/name
            if path.exists():
                target=DEST/'prior-audits'/package/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(path,target)
                receipts[target.relative_to(DEST).as_posix()]={'bytes':path.stat().st_size,'sha256':sha(path.read_bytes())}
    for name in ['paper_frontier_analysis.py','paper_frontier_audit.py','publish_paper_frontier.py']:
        target=DEST/'implementation'/name;target.parent.mkdir(exist_ok=True);target.write_bytes((ROOT/'data-pipeline'/name).read_bytes().replace(b'\r\n',b'\n'))
    package=DEST/'finite-frontier-evidence.zip'
    with zipfile.ZipFile(package,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        def add(name,blob):
            info=zipfile.ZipInfo(name,date_time=(2026,10,6,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,blob,compresslevel=9)
        for file in sorted(DEST.rglob('*')):
            if file.is_file() and file!=package:add(file.relative_to(DEST).as_posix(),file.read_bytes())
        for name,e in sorted(r['source_files'].items()):
            b=(ROOT/'frontend/public/research'/name).read_bytes()
            if len(b)!=e['bytes'] or sha(b)!=e['sha256']:raise ValueError('Source changed before packaging')
            add('native/'+name,b)
    view={key:r[key] for key in ['schema','defaults','cases','summary','source_report_sha256','protocol_sha256']}
    view.update(report_sha256=sha((DEST/'results.json').read_bytes()),audit=audit,prior_audits=receipts,package={'filename':package.name,'bytes':package.stat().st_size,'sha256':sha(package.read_bytes())})
    sr=packed(view);SUMMARY.write_bytes(sr);(DEST/'publication.json').write_bytes(sr)
    index={'schema':'gugis-paper-finite-frontier-index-v1','files':{file.relative_to(DEST).as_posix():{'bytes':file.stat().st_size,'sha256':sha(file.read_bytes())} for file in sorted(DEST.rglob('*')) if file.is_file()}}
    (DEST/'index.json').write_bytes(packed(index))
    print(json.dumps({'report_sha256':view['report_sha256'],'package':view['package'],'summary_bytes':len(sr),'indexed_files':len(index['files'])}))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('folder',type=Path);args=parser.parse_args();publish(args.folder)
