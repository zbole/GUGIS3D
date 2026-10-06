import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from deploy.verify_release import verify


class ReleaseTests(unittest.TestCase):
    def test_changed_or_unlisted_bytes_cannot_be_deployed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root/'backend').mkdir()
            p = root/'backend/model.bin'
            p.write_bytes(b'original')
            entry = {'path': 'backend/model.bin', 'bytes': 8,
                     'sha256': hashlib.sha256(b'original').hexdigest()}
            report = {'schema': 'gugis-server-release-v1', 'source_commit': 'a'*40,
                      'files': [entry], 'total_bytes': 8}
            (root/'release-manifest.json').write_text(json.dumps(report))
            self.assertEqual(verify(root)['total_bytes'], 8)
            p.write_bytes(b'altered!')
            with self.assertRaisesRegex(ValueError, 'fingerprint'): verify(root)
            p.write_bytes(b'original')
            (root/'password.txt').write_text('must not be shipped')
            with self.assertRaisesRegex(ValueError, 'tree differs'): verify(root)

    def test_traversal_private_paths_and_duplicate_entries_are_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for name in ('../outside', '/outside', 'C:/outside', 'backend\\outside',
                         '.local/city/current.json', 'backend/.env', '.git/config',
                         'backend/../outside'):
                report = {'schema': 'gugis-server-release-v1', 'source_commit': 'a'*40,
                          'files': [{'path': name, 'bytes': 0, 'sha256': '0'*64}], 'total_bytes': 0}
                (root/'release-manifest.json').write_text(json.dumps(report))
                with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'Unsafe'): verify(root)


if __name__ == '__main__': unittest.main()
