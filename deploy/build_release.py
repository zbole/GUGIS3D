"""Bundle the production app and only pinned public data, with full byte receipts."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT/'backend'))
from app.services.render_tiles import validate_manifest, digest, bounded_read
from deploy.verify_release import verify


def file_digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024*1024), b''):
            result.update(chunk)
    return result.hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--release', required=True)
    args = parser.parse_args()
    if not args.release or any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789-' for c in args.release):
        raise ValueError('Use a simple lowercase release identifier')
    output = ROOT/'.local/deploy/releases'/args.release
    output.mkdir(parents=True, exist_ok=False)
    tree = output/'tree'
    tree.mkdir()
    def copy(source, relative):
        if source.is_symlink() or not source.is_file():
            raise ValueError('Only regular source files may be bundled')
        target = tree/relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if str(relative).replace('\\', '/').startswith(('backend/app/', 'deploy/', 'data-pipeline/')) and source.suffix in ('.py', '.sh', '.conf', '.service', '.txt'):
            target.write_bytes(source.read_bytes().replace(b'\r\n', b'\n'))
        else:
            shutil.copyfile(source, target)
    # Runtime source sets are explicit; no local database, venv, git, or credentials.
    for directory in ('backend/app', 'shared', 'frontend/dist', 'deploy'):
        for p in sorted((ROOT/directory).rglob('*')):
            if p.is_file() and not any(part in ('__pycache__', 'tests') for part in p.relative_to(ROOT/directory).parts):
                copy(p, p.relative_to(ROOT))
    tracked = subprocess.check_output(['git', '-c', 'safe.directory='+ROOT.as_posix(),
        'ls-files', '-z', 'backend/data'], cwd=ROOT).decode().split('\0')
    for name in filter(None, tracked): copy(ROOT/name, name)
    for name in ('backend/requirements.txt', 'backend/requirements-lock.txt',
                 'data-pipeline/build_seed_summaries.py'):
        copy(ROOT/name, name)
    catalogue = json.loads((ROOT/'shared/public-city-datasets.json').read_bytes())
    for source in catalogue['sources']:
        city_id = source['city_id']
        seed = tree/('backend/data/bristol.gugis.json' if city_id == 'bristol' else
                     f'backend/data/cities/{city_id}.gugis.json')
        if seed.stat().st_size != source['bytes'] or digest(seed.read_bytes()) != source['sha256']:
            raise ValueError('Public city bytes changed: '+city_id)
        cache = ROOT/'.local/render-cache'/city_id
        pointer = json.loads((cache/'active.json').read_bytes())
        revision = pointer['revision']
        if revision != source['sha256']:
            raise ValueError('Render package must derive from the pinned public seed')
        package = cache/revision
        manifest = validate_manifest(json.loads((package/'manifest.json').read_bytes()), city_id, revision)
        if digest((package/'manifest.json').read_bytes()) != pointer['manifest_sha256']:
            raise ValueError('Render manifest fingerprint changed')
        copy(cache/'active.json', f'render-cache/{city_id}/active.json')
        copy(package/'manifest.json', f'render-cache/{city_id}/{revision}/manifest.json')
        for descriptor in manifest['tiles']:
            path = package/'tiles'/(descriptor['id']+'.json')
            raw = bounded_read(path, descriptor['byte_length'])
            if len(raw) != descriptor['byte_length'] or digest(raw) != descriptor['sha256']:
                raise ValueError('Render tile bytes changed')
            copy(path, f'render-cache/{city_id}/{revision}/tiles/{path.name}')
        print('Verified public render package:', city_id, len(manifest['tiles']), flush=True)
    # Deterministic compressed HTTP sidecars reduce CPU and bandwidth. Originals
    # retain their exact hashes; browser Content-Encoding restores those bytes.
    for p in list((tree/'frontend/dist').rglob('*')):
        if p.is_file() and p.suffix in ('.js', '.css', '.json', '.svg') and p.stat().st_size >= 1024:
            raw = p.read_bytes()
            compressed = gzip.compress(raw, compresslevel=6, mtime=0)
            if len(compressed) < len(raw)*.94:
                p.with_name(p.name+'.gz').write_bytes(compressed)
    entries = []
    for p in sorted(tree.rglob('*')):
        if p.is_file():
            entries.append({'path': p.relative_to(tree).as_posix(), 'bytes': p.stat().st_size,
                            'sha256': digest(p.read_bytes())})
    commit = subprocess.check_output(['git', '-c', 'safe.directory='+ROOT.as_posix(),
        'rev-parse', 'HEAD'], cwd=ROOT).decode().strip()
    report = {'schema': 'gugis-server-release-v1', 'release': args.release,
              'source_commit': commit, 'total_bytes': sum(e['bytes'] for e in entries),
              'public_cities': len(catalogue['sources']), 'files': entries}
    (tree/'release-manifest.json').write_bytes((json.dumps(report, ensure_ascii=False, indent=2)+'\n').encode())
    verify(tree)
    archive = output/(args.release+'.tar.gz')
    with archive.open('wb') as stream, gzip.GzipFile(fileobj=stream, mode='wb', compresslevel=1, mtime=0) as gz:
        with tarfile.open(fileobj=gz, mode='w', format=tarfile.PAX_FORMAT) as tar:
            for p in sorted(tree.rglob('*')):
                if p.is_file():
                    info = tar.gettarinfo(str(p), arcname=p.relative_to(tree).as_posix())
                    info.uid = info.gid = 0
                    info.uname = info.gname = ''
                    info.mtime = 0
                    info.mode = 0o755 if p.suffix == '.sh' else 0o644
                    with p.open('rb') as source: tar.addfile(info, source)
    receipt = {'archive': str(archive), 'bytes': archive.stat().st_size,
               'sha256': file_digest(archive), 'manifest_sha256': digest((tree/'release-manifest.json').read_bytes()),
               'files': len(entries), 'uncompressed_bytes': report['total_bytes']}
    (output/'package-receipt.json').write_text(json.dumps(receipt, indent=2)+'\n')
    print(json.dumps(receipt), flush=True)


if __name__ == '__main__': main()
