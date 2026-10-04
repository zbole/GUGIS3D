"""Actual retained samples: source integrity, large archive limits and isolation."""
import hashlib
import json
from pathlib import Path
import unittest
from app.services.city_archive import load_city, archive_bytes
from app.services.workspace_catalog import WORKSPACES
from app.services import city_workspaces
from pydantic import ValidationError


class ExpandedCitySamplesTests(unittest.TestCase):
    def test_retained_new_samples_are_hash_checked_complete_reports_with_no_fabricated_terrain(self):
        root = Path(__file__).resolve().parents[1] / 'data/cities'
        for city_id in ('manchester', 'edinburgh', 'cardiff'):
            with self.subTest(city_id=city_id):
                source = json.loads((root / f'{city_id}-source.json').read_bytes())
                report = json.loads((root / f'{city_id}-import.json').read_bytes())
                raw = (root / f'{city_id}-osm.json').read_bytes()
                content = (root / f'{city_id}.gugis.json').read_bytes()
                self.assertEqual(hashlib.sha256(raw).hexdigest(), report['source_sha256'])
                self.assertEqual(hashlib.sha256(content).hexdigest(), report['gugis_sha256'])
                self.assertEqual(source['city_id'], city_id)
                self.assertEqual(report['source_building_ways'], report['imported_buildings'] + len(report['omitted_buildings']))
                self.assertEqual(sum(report['height_policy'].values()), report['imported_buildings'])
                city = load_city(content)
                self.assertEqual(len(city.instances), report['imported_buildings'])
                self.assertEqual(len(city.roads), report['imported_roads'])
                self.assertEqual(city.metadata['city_id'], city_id)
                self.assertIsNone(city.environment)
                self.assertEqual(load_city(archive_bytes(city)), city)
        self.assertGreater(load_city((root / 'edinburgh.gugis.json').read_bytes()).instances.__len__(), 5000)

    def test_workspace_storage_and_seeds_remain_distinct_for_all_six_cities(self):
        self.assertEqual(len(WORKSPACES), 6)
        root = Path('/synthetic/root')
        self.assertEqual(len({city_workspaces.directory(root / '.local/city', r['id']) for r in WORKSPACES}), 6)
        self.assertEqual(len({city_workspaces.seed_path(root / 'data/bristol.gugis.json', r['id']) for r in WORKSPACES}), 6)

    def test_large_city_still_rejects_over_budget_instance_lists(self):
        payload = {'format': 'gugis-city', 'version': '1.0', 'coordinate_system': 'ENU_METERS_WGS84',
                   'name': 'Bounded test', 'assets': {}, 'instances': [{}] * 15001}
        with self.assertRaises(ValidationError) as caught:
            load_city(payload)
        self.assertTrue(any(e['type'] == 'too_long' and e['loc'][-1] == 'instances' for e in caught.exception.errors()))
