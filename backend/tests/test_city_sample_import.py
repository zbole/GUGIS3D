import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from app.services.city_sample_import import build_osm_sample, height_from_tags, load_sample
from app.services.city_archive import archive_bytes, load_city
from app.services.terrain_builder import import_dem, demo_terrain


class CitySampleImportTests(unittest.TestCase):
    def source(self):
        return {'city_id': 'london', 'bbox': [-.14, 51.49, -.12, 51.51],
                'coverage_label': 'Test', 'source_url': 'https://overpass-api.de/api/interpreter'}

    def building(self, identifier=1):
        return {'type': 'way', 'id': identifier, 'tags': {'building': 'yes', 'height': '12 m'},
                'geometry': [{'lon': x, 'lat': y} for x, y in
                    [(-.131, 51.5), (-.13, 51.5), (-.13, 51.501), (-.131, 51.501), (-.131, 51.5)]]}

    def test_real_source_ids_height_and_omissions_survive_archive(self):
        bad = self.building(2); bad['geometry'] = bad['geometry'][:3]
        road = {'type': 'way', 'id': 3, 'tags': {'highway': 'residential', 'name': 'Test Road'},
                'geometry': [{'lon': -.15, 'lat': 51.5}, {'lon': -.13, 'lat': 51.5}]}
        city, report = build_osm_sample({'elements': [bad, road, self.building()]}, self.source(), 'london')
        restored = load_city(archive_bytes(city))
        self.assertEqual([i.id for i in restored.instances], ['osm1'])
        self.assertEqual(report['imported_buildings'], 1)
        self.assertEqual(report['omitted_buildings'][0]['osm_way'], 2)
        self.assertEqual(restored.assets['osm1'].templates['volume'].vertices[-1][2], 12)
        self.assertEqual(report['actual_data_bbox_wgs84'][0], -.15)
        self.assertIn('跨界 way', restored.metadata['采样说明'])
        self.assertEqual(restored.metadata['license'], 'ODbL 1.0')

    def test_height_fallback_keeps_measured_tag_separate_from_assumptions(self):
        self.assertEqual(height_from_tags({'height': '30 ft'})[2], 'height-tag')
        self.assertAlmostEqual(height_from_tags({'height': '30 ft'})[0], 9.144)
        self.assertEqual(height_from_tags({'height': 'bad', 'building:levels': '4'})[0], 12.8)
        self.assertEqual(height_from_tags({'height': '999', 'building:levels': 'nan'})[2], 'assumed')

    def test_source_checksum_failure_prevents_rebuild(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / 'source.json'; path.write_bytes(b'{"elements":[]}')
            manifest = Path(directory) / 'manifest.json'
            manifest.write_text(json.dumps({**self.source(), 'sha256': hashlib.sha256(b'other').hexdigest()}))
            with self.assertRaisesRegex(ValueError, 'SHA-256'):
                load_sample(path, manifest, 'london')
        with self.assertRaisesRegex(ValueError, 'No supported buildings'):
            build_osm_sample({'elements': []}, self.source(), 'london')

    def test_dem_import_clips_to_selected_city_instead_of_bristol(self):
        content = b'ncols 4\nnrows 4\nxllcorner -0.132\nyllcorner 51.5\ncellsize 0.001\nNODATA_value -9999\n10 11 12 13\n11 12 13 14\n12 13 14 15\n13 14 15 16\n'
        with self.assertRaisesRegex(ValueError, '不相交'):
            import_dem(content, 'london.asc', 'EPSG:4326', stride=1)
        terrain = import_dem(content, 'london.asc', 'EPSG:4326', stride=1,
                             clip_bounds=(-.132, 51.5, -.128, 51.504), center=(-.13, 51.502), coverage_label='London sample')
        self.assertEqual(len(terrain.points), 16)
        self.assertEqual(terrain.longitude, -.13)
        self.assertIn('London sample', terrain.source['覆盖范围'])
        demo = demo_terrain(center=(-1.9075, 52.482), name='Birmingham · 非实测')
        self.assertEqual(demo.latitude, 52.482)
        self.assertTrue(demo.demonstration)


if __name__ == '__main__':
    unittest.main()
