import errno
import hashlib
import os
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import NamedTemporaryFile, TemporaryDirectory
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app
from app.routers import studio
from app.services.building_generator import document_bytes, generate_building
from app.studio_models import BuildingParameters


class StudioStorageTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        directory_patch = patch.object(studio, 'EXPORT_DIR', self.directory)
        directory_patch.start()
        self.addCleanup(directory_patch.stop)
        self.client = TestClient(app, raise_server_exceptions=False)
        self.content = document_bytes(generate_building(BuildingParameters(floors=1, units=1)))
        self.file_id = hashlib.sha256(self.content).hexdigest()
        self.destination = self.directory / f'{self.file_id}.gugis.json'
        self.url = f'/studio/files/{self.file_id}'

    def save(self):
        return self.client.post('/studio/save', content=self.content)

    def assert_download(self):
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.content, self.content)
        self.assertEqual(hashlib.sha256(response.content).hexdigest(), self.file_id)
        self.assertEqual(response.headers['content-type'], 'application/json')
        self.assertEqual(response.headers['content-disposition'],
                         f'attachment; filename="{self.destination.name}"')

    def prepare_unrelated_files(self):
        # Failure cleanup must not touch another export or an abandoned temp.
        other = document_bytes(generate_building(BuildingParameters(name='Other', floors=1, units=1)))
        other_id = hashlib.sha256(other).hexdigest()
        self.other = self.directory / f'{other_id}.gugis.json'
        self.other.write_bytes(other)
        self.abandoned = self.directory / f'.{self.file_id}.abandoned.tmp'
        self.abandoned.write_bytes(b'previous interrupted attempt')
        self.before = {path: path.read_bytes() for path in self.directory.iterdir()}

    def assert_failed_save_is_retryable(self, response):
        self.assertEqual(response.status_code, 500, response.text)
        self.assertFalse(self.destination.exists())
        self.assertEqual(self.client.get(self.url).status_code, 404)
        self.assertEqual({path: path.read_bytes() for path in self.directory.iterdir()}, self.before)
        self.assertEqual(self.save().status_code, 200)
        self.assertEqual({path: path.read_bytes() for path in self.before}, self.before)
        self.assert_download()

    def test_healthy_save_receipt_download_and_duplicate_are_unchanged(self):
        response = self.save()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {
            'id': self.file_id, 'filename': self.destination.name,
            'directory': str(self.directory), 'bytes': len(self.content), 'download_path': self.url,
        })
        before = self.destination.stat().st_mtime_ns
        self.assert_download()
        with patch.object(studio, 'NamedTemporaryFile', side_effect=AssertionError('Unexpected rewrite')):
            repeated = self.save()
        self.assertEqual(repeated.status_code, 200, repeated.text)
        self.assertEqual(repeated.json(), response.json())
        self.assertEqual(self.destination.stat().st_mtime_ns, before)
        self.assertEqual(list(self.directory.iterdir()), [self.destination])

    def test_corrupt_existing_files_are_rejected_and_preserved(self):
        other_valid_document = document_bytes(generate_building(BuildingParameters(name='Different')))
        for corrupt in (b'', self.content[:128], b'{broken json', other_valid_document):
            with self.subTest(corrupt_bytes=len(corrupt)):
                self.destination.write_bytes(corrupt)
                before = self.destination.stat().st_mtime_ns
                saved = self.save()
                downloaded = self.client.get(self.url)
                for response in (saved, downloaded):
                    self.assertEqual(response.status_code, 409, response.text)
                    self.assertIn('integrity check failed', response.json()['detail'])
                self.assertEqual(self.destination.read_bytes(), corrupt)
                self.assertEqual(self.destination.stat().st_mtime_ns, before)
                self.assertEqual(list(self.directory.iterdir()), [self.destination])

    def test_partial_write_failure_has_no_final_file_and_cleans_only_its_temp(self):
        self.prepare_unrelated_files()
        created = []
        observations = []

        def partial_file(*args, **kwargs):
            output = NamedTemporaryFile(*args, **kwargs)
            created.append(Path(output.name))

            def partial_write(content):
                output.file.write(content[:128])
                output.file.flush()
                observations.append((self.destination.exists(), Path(output.name).read_bytes()))
                raise OSError(errno.ENOSPC, 'Injected disk full after partial write')

            output.write = partial_write
            return output

        with patch.object(studio, 'NamedTemporaryFile', side_effect=partial_file):
            response = self.save()
        self.assertEqual(observations, [(False, self.content[:128])])
        self.assertEqual(len(created), 1)
        self.assertEqual(created[0].parent, self.directory)
        self.assertFalse(created[0].exists())
        self.assert_failed_save_is_retryable(response)

    def test_fsync_failure_does_not_publish_and_retry_succeeds(self):
        self.prepare_unrelated_files()
        with patch.object(studio.os, 'fsync', side_effect=OSError(errno.EIO, 'Injected fsync failure')) as sync, \
                patch.object(studio.os, 'replace', wraps=os.replace) as replace:
            response = self.save()
        sync.assert_called_once()
        replace.assert_not_called()
        self.assert_failed_save_is_retryable(response)

    def test_replace_failure_does_not_publish_and_retry_succeeds(self):
        self.prepare_unrelated_files()
        with patch.object(studio.os, 'fsync', wraps=os.fsync) as sync, \
                patch.object(studio.os, 'replace', side_effect=OSError(errno.EACCES, 'Injected replace failure')) as replace:
            response = self.save()
        sync.assert_called_once()
        replace.assert_called_once()
        self.assert_failed_save_is_retryable(response)

    def test_publication_is_after_flush_sync_and_close_in_same_directory(self):
        observations = []
        outputs = []
        real_replace = os.replace
        real_fsync = os.fsync

        def capture_file(*args, **kwargs):
            output = NamedTemporaryFile(*args, **kwargs)
            outputs.append(output)
            return output

        def inspect_sync(fd):
            output = outputs[-1]
            observations.append(('sync', output.closed, Path(output.name).read_bytes(), self.destination.exists()))
            return real_fsync(fd)

        def inspect_replace(source, destination):
            observations.append(('replace', outputs[-1].closed, Path(source).read_bytes(), self.destination.exists()))
            self.assertEqual(Path(source).parent, self.directory)
            self.assertEqual(destination, self.destination)
            return real_replace(source, destination)

        with patch.object(studio, 'NamedTemporaryFile', side_effect=capture_file), \
                patch.object(studio.os, 'fsync', side_effect=inspect_sync), \
                patch.object(studio.os, 'replace', side_effect=inspect_replace):
            response = self.save()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(observations, [('sync', False, self.content, False),
                                        ('replace', True, self.content, False)])
        self.assertEqual(list(self.directory.iterdir()), [self.destination])
        self.assert_download()

    def test_download_serves_exact_verified_bytes_without_reopening_the_file(self):
        self.destination.write_bytes(self.content)
        read_bytes = Path.read_bytes
        reads = []

        def change_after_read(path):
            content = read_bytes(path)
            if path == self.destination:
                reads.append(path)
                path.write_bytes(b'changed after the verified snapshot was read')
            return content

        with patch.object(Path, 'read_bytes', change_after_read):
            self.assert_download()
        self.assertEqual(reads, [self.destination])
        self.assertEqual(self.destination.read_bytes(), b'changed after the verified snapshot was read')
        self.assertEqual(self.client.get(self.url).status_code, 409)

    def test_missing_and_invalid_download_ids_still_return_404(self):
        for file_id in (self.file_id, 'not-an-id', self.file_id.upper()):
            self.assertEqual(self.client.get(f'/studio/files/{file_id}').status_code, 404)
        self.assertEqual(list(self.directory.iterdir()), [])

    def test_abrupt_exit_leaves_only_an_abandoned_temp_and_retry_succeeds(self):
        worker = '''
import os, sys
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
from app.main import app
from app.routers import studio

studio.EXPORT_DIR = Path(sys.argv[1])
create_file = studio.NamedTemporaryFile
def interrupted_file(*args, **kwargs):
    output = create_file(*args, **kwargs)
    def interrupted_write(content):
        output.file.write(content[:128])
        output.file.flush()
        os._exit(73)
    output.write = interrupted_write
    return output
with patch.object(studio, 'NamedTemporaryFile', side_effect=interrupted_file):
    TestClient(app).post('/studio/save', content=sys.stdin.buffer.read())
'''
        # This bounded process termination never points at real exports or city data.
        process = subprocess.run([sys.executable, '-c', worker, str(self.directory)],
                                 input=self.content, capture_output=True, timeout=20,
                                 cwd=Path(__file__).resolve().parents[1])
        self.assertEqual(process.returncode, 73, process.stderr.decode(errors='replace'))
        self.assertFalse(self.destination.exists())
        abandoned = list(self.directory.iterdir())
        self.assertEqual(len(abandoned), 1)
        self.assertEqual(abandoned[0].suffix, '.tmp')
        self.assertEqual(abandoned[0].read_bytes(), self.content[:128])
        self.assertEqual(self.client.get(self.url).status_code, 404)
        self.assertEqual(self.save().status_code, 200)
        self.assertEqual(abandoned[0].read_bytes(), self.content[:128])
        self.assertEqual(set(self.directory.iterdir()), {abandoned[0], self.destination})
        self.assert_download()


if __name__ == '__main__':
    unittest.main()
