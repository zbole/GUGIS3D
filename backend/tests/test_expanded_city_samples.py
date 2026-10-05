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
        for city_id in ('manchester', 'edinburgh', 'cardiff', 'york', 'bath'):
            with self.subTest(city_id=city_id):
                source = json.loads((root / f'{city_id}-source.json').read_bytes())
                report = json.loads((root / f'{city_id}-import.json').read_bytes())
                raw = (root / f'{city_id}-osm.json').read_bytes()
                content = (root / f'{city_id}.gugis.json').read_bytes()
                self.assertEqual(hashlib.sha256(raw).hexdigest(), report['source_sha256'])
                self.assertEqual(hashlib.sha256(content).hexdigest(), report['gugis_sha256'])
                self.assertEqual(source['city_id'], city_id)
                self.assertEqual(len(raw),source['bytes'])
                self.assertEqual(report['source_building_ways'], report['imported_buildings'] + len(report['omitted_buildings']))
                self.assertEqual(sum(report['height_policy'].values()), report['imported_buildings'])
                city = load_city(content)
                self.assertEqual(len(city.instances), report['imported_buildings'])
                self.assertEqual(len(city.roads), report['imported_roads'])
                self.assertEqual(city.metadata['city_id'], city_id)
                self.assertIsNone(city.environment)
                self.assertEqual(load_city(archive_bytes(city)), city)
        self.assertGreater(load_city((root / 'edinburgh.gugis.json').read_bytes()).instances.__len__(), 5000)

    def test_york_public_source_keeps_acquisition_and_filter_provenance_with_all_heights_accounted(self):
        root = Path(__file__).resolve().parents[1] / 'data/cities'
        source=json.loads((root/'york-source.json').read_bytes())
        report=json.loads((root/'york-import.json').read_bytes())
        self.assertEqual(source['http_method'],'GET')
        self.assertEqual(source['source_url'],'https://gall.openstreetmap.de/api/interpreter')
        self.assertEqual(len(source['retained_download_sha256']),64)
        self.assertEqual(sum(source['publication_filter']['removed_tag_counts'].values()),348)
        self.assertEqual(report['imported_buildings'],6092);self.assertEqual(report['imported_roads'],1853)
        self.assertEqual(report['height_policy'],{'height-tag':465,'levels-derived':2357,'assumed':3270})
        self.assertEqual(len(report['omitted_buildings']),6)
        osm=json.loads((root/'york-osm.json').read_bytes())
        for element in osm['elements']:
            tags=element.get('tags',{})
            self.assertFalse(set(tags)&{'phone','email','fax','mobile','website','url','note','description'})
            self.assertFalse(any(key.startswith(('contact:','note:','description:')) for key in tags))
        self.assertEqual(source['preparer_source_sha256'],hashlib.sha256((root.parents[2]/'data-pipeline/prepare_city_source.py').read_bytes().replace(b'\r\n',b'\n')).hexdigest())

    def test_workspace_storage_and_seeds_remain_distinct_for_all_published_cities(self):
        self.assertEqual(len(WORKSPACES), 11)
        root = Path('/synthetic/root')
        self.assertEqual(len({city_workspaces.directory(root / '.local/city', r['id']) for r in WORKSPACES}), len(WORKSPACES))
        self.assertEqual(len({city_workspaces.seed_path(root / 'data/bristol.gugis.json', r['id']) for r in WORKSPACES}), len(WORKSPACES))

    def test_large_city_still_rejects_over_budget_instance_lists(self):
        payload = {'format': 'gugis-city', 'version': '1.0', 'coordinate_system': 'ENU_METERS_WGS84',
                   'name': 'Bounded test', 'assets': {}, 'instances': [{}] * 15001}
        with self.assertRaises(ValidationError) as caught:
            load_city(payload)
        self.assertTrue(any(e['type'] == 'too_long' and e['loc'][-1] == 'instances' for e in caught.exception.errors()))
