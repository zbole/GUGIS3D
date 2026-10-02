import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app
from app.city_models import CityDocument
from app.studio_models import BuildingParameters
from app.services.building_generator import generate_building
from app.services.city_archive import archive_bytes, load_city
from app.routers import city


class CitySnapshotIntegrityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        folder = Path(self.tmp.name)
        document = generate_building(BuildingParameters(kind='villa', floors=2, units=1))
        seed = CityDocument(format='gugis-city', version='1.0', coordinate_system='ENU_METERS_WGS84',
                            name='Original', assets={'a': document},
                            instances=[dict(id='one', asset='a', name='One', longitude=-2.603, latitude=51.454)])
        source = folder / 'seed.json'
        source.write_bytes(archive_bytes(seed))
        for target, value in [('CITY_DIR', folder / 'city'), ('SEED', source)]:
            helper = patch.object(city, target, value)
            helper.start()
            self.addCleanup(helper.stop)
        self.client = TestClient(app)
        self.start = self.client.get('/city/current').json()
        self.formal = (city.CITY_DIR / 'current.gugis.json').read_bytes()

    def corrupt_snapshot(self, revision):
        path = city.CITY_DIR / 'versions' / f'{revision}.gugis.json'
        path.parent.mkdir(exist_ok=True)
        path.write_bytes(b'{corrupt history snapshot')
        return path

    def test_export_uses_verified_formal_bytes_even_when_same_named_history_is_corrupt(self):
        damaged = self.corrupt_snapshot(self.start['revision'])
        response = self.client.get('/city/export')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, self.formal)
        self.assertEqual(city.revision(response.content), self.start['revision'])
        self.assertEqual(response.headers['X-GUGIS-City-Revision'], self.start['revision'])
        self.assertIn('attachment', response.headers['content-disposition'])
        self.assertEqual(damaged.read_bytes(), b'{corrupt history snapshot')
        self.assertEqual((city.CITY_DIR / 'current.gugis.json').read_bytes(), self.formal)
        self.assertEqual(self.client.get('/city/versions/' + self.start['revision']).status_code, 422)

    def test_corrupt_previous_snapshot_prevents_formal_overwrite(self):
        damaged = self.corrupt_snapshot(self.start['revision'])
        response = self.client.post('/city/current', json={
            'base_revision': self.start['revision'], 'document': {**self.start['document'], 'name': 'Changed'},
        })
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(response.json()['detail']['code'], 'snapshot_integrity')
        self.assertIn('历史快照校验失败', response.json()['detail']['message'])
        self.assertEqual((city.CITY_DIR / 'current.gugis.json').read_bytes(), self.formal)
        self.assertEqual(damaged.read_bytes(), b'{corrupt history snapshot')
        self.assertEqual(list(damaged.parent.glob('*.gugis.json')), [damaged])

    def test_corrupt_target_snapshot_also_prevents_formal_overwrite(self):
        proposal = {**self.start['document'], 'name': 'Changed'}
        digest = city.revision(archive_bytes(load_city(proposal)))
        damaged = self.corrupt_snapshot(digest)
        response = self.client.post('/city/current', json={
            'base_revision': self.start['revision'], 'document': proposal,
        })
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual((city.CITY_DIR / 'current.gugis.json').read_bytes(), self.formal)
        self.assertEqual(damaged.read_bytes(), b'{corrupt history snapshot')
        previous = damaged.parent / f"{self.start['revision']}.gugis.json"
        self.assertEqual(previous.read_bytes(), self.formal)

    def test_failed_draft_commit_preserves_pending_and_formal_data_for_recovery(self):
        staged = self.client.post('/city/draft', json={
            'base_revision': self.start['revision'], 'base_draft_revision': None,
            'label': 'Changed', 'document': {**self.start['document'], 'name': 'Changed'},
        })
        self.assertEqual(staged.status_code, 200, staged.text)
        token = staged.json()['revision']
        pending = (city.CITY_DIR / 'pending-draft.json').read_bytes()
        damaged = self.corrupt_snapshot(self.start['revision'])
        response = self.client.post('/city/draft/commit', json={'revision': token})
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual((city.CITY_DIR / 'current.gugis.json').read_bytes(), self.formal)
        self.assertEqual((city.CITY_DIR / 'pending-draft.json').read_bytes(), pending)
        self.assertEqual(self.client.get('/city/draft').json()['draft']['revision'], token)
        self.assertEqual(self.client.get('/city/export').content, self.formal)
        self.assertEqual(damaged.read_bytes(), b'{corrupt history snapshot')

    def test_export_is_read_only_and_keeps_the_original_format(self):
        versions = city.CITY_DIR / 'versions'
        self.assertFalse(versions.exists())
        response = self.client.get('/city/export')
        self.assertEqual(response.content, self.formal)
        self.assertFalse(versions.exists(), 'downloading must not rewrite or create project history')
        self.assertEqual(load_city(response.content), load_city(self.formal))

    def test_failed_noop_commit_stays_pending_and_cannot_bypass_integrity_on_retry(self):
        staged = self.client.post('/city/draft', json={
            'base_revision': self.start['revision'], 'base_draft_revision': None,
            'label': 'Unchanged draft', 'document': self.start['document'],
        })
        self.assertEqual(staged.status_code, 200, staged.text)
        token = staged.json()['revision']
        pending = (city.CITY_DIR / 'pending-draft.json').read_bytes()
        damaged = self.corrupt_snapshot(self.start['revision'])
        for _ in range(2):
            result = self.client.post('/city/draft/commit', json={'revision': token})
            self.assertEqual(result.status_code, 409, result.text)
            self.assertEqual(self.client.get('/city/draft').json()['draft']['revision'], token)
            self.assertEqual((city.CITY_DIR / 'pending-draft.json').read_bytes(), pending)
            self.assertEqual((city.CITY_DIR / 'current.gugis.json').read_bytes(), self.formal)
        self.assertFalse((city.CITY_DIR / 'draft-commit.json').exists())
        # A deliberately repaired fixture can then commit and retry normally.
        damaged.write_bytes(self.formal)
        for _ in range(2):
            result = self.client.post('/city/draft/commit', json={'revision': token})
            self.assertEqual(result.status_code, 200, result.text)
            self.assertEqual(result.json()['revision'], self.start['revision'])
        self.assertIsNone(self.client.get('/city/draft').json()['draft'])

    def test_noop_snapshot_write_failure_does_not_publish_a_completion_receipt(self):
        staged = self.client.post('/city/draft', json={
            'base_revision': self.start['revision'], 'base_draft_revision': None,
            'label': 'Unchanged draft', 'document': self.start['document'],
        })
        token = staged.json()['revision']
        with patch.object(city, 'write_snapshot', side_effect=OSError('disk unavailable')):
            with self.assertRaises(OSError):
                self.client.post('/city/draft/commit', json={'revision': token})
        self.assertFalse((city.CITY_DIR / 'draft-commit.json').exists())
        self.assertEqual(self.client.get('/city/draft').json()['draft']['revision'], token)
        self.assertEqual((city.CITY_DIR / 'current.gugis.json').read_bytes(), self.formal)
        self.assertEqual(self.client.post('/city/draft/commit', json={'revision': token}).status_code, 200)


if __name__ == '__main__':
    unittest.main()
