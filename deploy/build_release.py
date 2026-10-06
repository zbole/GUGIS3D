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
    parser.add_argument('--prepared-tree', type=Path, help='Reuse mutable local staging after an interrupted build; every source is rechecked')
    args = parser.parse_args()
    if not args.release or any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789-' for c in args.release):
        raise ValueError('Use a simple lowercase release identifier')
    output = ROOT/'.local/deploy/releases'/args.release
    output.mkdir(parents=True, exist_ok=False)
    git = ['git', '-c', 'safe.directory='+ROOT.as_posix()]
    commit = subprocess.check_output(git+['rev-parse', 'HEAD'], cwd=ROOT).decode().strip()
    tree = args.prepared_tree.resolve(strict=True) if args.prepared_tree else output/'tree'
    if args.prepared_tree:
        tree.relative_to((ROOT/'.local/deploy/releases').resolve())
        if tree.name != 'tree' or tree.is_symlink(): raise ValueError('Only local mutable release staging can be reused')
    else:
        tree.mkdir()
    def copy(source, relative):
        if source.is_symlink() or not source.is_file():
            raise ValueError('Only regular source files may be bundled')
        target = tree/relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.is_symlink(): raise ValueError('No linked staging targets')
        if str(relative).replace('\\', '/').startswith(('backend/app/', 'deploy/', 'data-pipeline/')) and source.suffix in ('.py', '.sh', '.conf', '.service', '.txt'):
            raw = source.read_bytes().replace(b'\r\n', b'\n')
            if not target.exists() or target.read_bytes() != raw: target.write_bytes(raw)
        else:
            if not target.exists() or source.stat().st_size != target.stat().st_size or file_digest(source) != file_digest(target):
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
        if p.is_file() and p.suffix in ('.js', '.css', '.json', '.svg') and p.stat().st_size >= 32768:
            raw = p.read_bytes()
            sidecar = p.with_name(p.name+'.gz')
            if sidecar.exists():
                try:
                    if gzip.decompress(sidecar.read_bytes()) == raw: continue
                except (OSError, EOFError): pass
            compressed = gzip.compress(raw, compresslevel=6, mtime=0)
            if len(compressed) < len(raw)*.94:
                sidecar.write_bytes(compressed)
    for p in (tree/'frontend/dist').rglob('*.gz'):
        original = p.with_name(p.name[:-3])
        if not original.is_file(): raise ValueError('Unexpected compressed sidecar')
        raw = original.read_bytes()
        try: valid = gzip.decompress(p.read_bytes()) == raw
        except (OSError, EOFError): valid = False
        if not valid: p.write_bytes(gzip.compress(raw, compresslevel=6, mtime=0))
    print('Original bytes and compressed sidecars verified; collecting receipts', flush=True)
    entries = []
    for p in sorted(tree.rglob('*')):
        if p.is_file() and p.name != 'release-manifest.json':
            entries.append({'path': p.relative_to(tree).as_posix(), 'bytes': p.stat().st_size,
                            'sha256': digest(p.read_bytes())})
    if subprocess.check_output(git+['rev-parse', 'HEAD'], cwd=ROOT).decode().strip() != commit:
        raise ValueError('Source commit changed during release assembly')
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
