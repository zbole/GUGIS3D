"""Verify a deployment tree without following links or reading user workspaces."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import sys


def verify(root):
    root = Path(root).resolve(strict=True)
    report = json.loads((root/'release-manifest.json').read_bytes())
    if report.get('schema') != 'gugis-server-release-v1':
        raise ValueError('Unknown deployment manifest')
    names = set()
    total = 0
    for entry in report['files']:
        name = entry['path']
        parts = PurePosixPath(name).parts
        if (not parts or name in names or PurePosixPath(name).is_absolute()
                or '\\' in name or ':' in name or any(p in ('.', '..', '.git', '.local', '.venv',
                                            'node_modules', '__pycache__') for p in parts)
                or any(p.startswith('.env') for p in parts)
                or PurePosixPath(name).as_posix() != name):
            raise ValueError('Unsafe, duplicate, or private release path')
        names.add(name)
        path = root
        for part in parts:
            path = path/part
            if path.is_symlink():
                raise ValueError('Deployment files cannot be symlinks')
        if not path.is_file() or path.stat().st_size != entry['bytes']:
            raise ValueError('Deployment file missing or size changed: '+name)
        digest = hashlib.sha256()
        with path.open('rb') as stream:
            for chunk in iter(lambda: stream.read(1024*1024), b''):
                digest.update(chunk)
        if digest.hexdigest() != entry['sha256']:
            raise ValueError('Deployment fingerprint changed: '+name)
        total += entry['bytes']
    actual = {p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file()}
    if actual != names | {'release-manifest.json'} or total != report['total_bytes']:
        raise ValueError('Deployment tree differs from manifest')
    print(json.dumps({'verified_files': len(names), 'verified_bytes': total,
                      'source_commit': report['source_commit']}))
    return report


if __name__ == '__main__':
    verify(sys.argv[1])
