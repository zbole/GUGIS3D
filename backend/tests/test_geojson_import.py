import copy
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app
from app.city_models import CityDocument
from app.studio_models import BuildingDocument
from app.services.city_archive import archive_bytes, load_city
from app.services.city_generator import triangulate_ring


def feature(points=None):
    points = points or [(0, 0), (4, 0), (4, 3), (0, 3)]
    ring = [[-2.6 + x * .00005, 51.45 + y * .00005] for x, y in points]
    ring.append(ring[0].copy())
    return {'type': 'Feature', 'properties': {'name': 'Import fixture', 'height': 12},
            'geometry': {'type': 'Polygon', 'coordinates': [ring]}}


class GeoJSONImportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app, raise_server_exceptions=False)

    def import_features(self, features):
        return self.client.post('/city/geojson', content=json.dumps({
            'type': 'FeatureCollection', 'features': features}),
            headers={'Content-Type': 'application/json'})

    def test_crossing_polygon_is_rejected_before_it_can_be_archived(self):
        # The horizontal third edge crosses the closing edge. This previously
        # produced a positive-volume mesh with a reversed final roof triangle.
        crossed = feature([(0, 0), (4, 0), (5, 3), (0, 3), (2, 5)])
        response = self.import_features([feature(), crossed])
        self.assertEqual(response.status_code, 422, response.text)
        self.assertIn('要素 2', response.json()['detail'])
        self.assertNotIn('documents', response.json())

    def test_touching_overlapping_and_backtracking_rings_are_rejected(self):
        rings = [
            [(0, 0), (4, 0), (4, 4), (2, 0), (0, 4)],  # vertex on another edge
            [(0, 0), (4, 0), (4, 4), (2, 2), (0, 4), (2, 2)],  # repeated nonadjacent vertex
            [(0, 0), (6, 0), (6, 4), (1, 4), (1, 0), (4, 0), (4, 2), (0, 2)],
            [(0, 0), (4, 0), (2, 0), (4, 4), (0, 4)],  # adjacent overlapping edges
            [(0, 0), (1, 0), (2, 0)],  # all collinear
        ]
        for ring in rings:
            with self.subTest(ring=ring):
                with self.assertRaises(ValueError):
                    triangulate_ring(ring)
                response = self.import_features([feature(ring)])
                self.assertEqual(response.status_code, 422, response.text)

    def test_malformed_feature_structure_returns_422_for_the_whole_batch(self):
        invalid = []
        for field in ('geometry', 'properties'):
            for value in ([], ['invalid'], '', 'invalid', 0, True):
                item = feature()
                item[field] = value
                invalid.append(item)
        for value in (None, {}, 'Polygon', [[1, 2, 3, 1]]):
            item = feature()
            item['geometry']['coordinates'] = value
            invalid.append(item)
        item = feature()
        item['type'] = 'Polygon'
        invalid.append(item)
        for item in invalid:
            with self.subTest(item=item):
                response = self.import_features([feature(), item])
                self.assertEqual(response.status_code, 422, response.text)
                self.assertIn('要素 2', response.json()['detail'])
                self.assertNotIn('documents', response.json())

    def test_each_coordinate_must_be_numeric_finite_and_geographically_valid(self):
        for invalid in ([True, 51.45], ['-2.6', 51.45], [float('nan'), 51.45],
                        [-2.6, float('inf')], [-2.6], None):
            item = feature()
            item['geometry']['coordinates'][0][1] = invalid
            response = self.import_features([item])
            self.assertEqual(response.status_code, 422, response.text)
        # A valid mean location must not hide individual out-of-bounds points.
        for ring in (
            [[179.999, 0], [180.0001, 0], [180.0001, .001], [179.999, .001]],
            [[0, 84.999], [.001, 84.999], [.001, 85.0001], [0, 85.0001]],
        ):
            item = feature()
            item['geometry']['coordinates'] = [[*ring, ring[0]]]
            response = self.import_features([item])
            self.assertEqual(response.status_code, 422, response.text)

    def test_valid_concave_clockwise_and_redundant_vertices_preserve_geometry_and_sources(self):
        concave = [(0, 0), (4, 0), (4, 1), (2, 1), (2, 3), (0, 3)]
        redundant = [(0, 0), (2, 0), (4, 0), (4, 0), (4, 3), (0, 3)]
        items = [feature(concave), feature(list(reversed(concave))), feature(redundant)]
        items[2]['properties'] = None
        response = self.import_features(items)
        self.assertEqual(response.status_code, 200, response.text)
        documents = [BuildingDocument.model_validate(d) for d in response.json()['documents']]
        for index, document in enumerate(documents):
            city = CityDocument(format='gugis-city', version='1.0', coordinate_system='ENU_METERS_WGS84',
                                name='Import roundtrip', assets={'a': document}, instances=[{
                                    'id': 'a', 'asset': 'a', 'name': document.parameters.name,
                                    'longitude': document.parameters.longitude, 'latitude': document.parameters.latitude}])
            self.assertEqual(load_city(archive_bytes(city)), city)
            attributes = document.nodes[0].attributes
            self.assertEqual(attributes['数据来源'], '用户导入 GeoJSON / WGS84')
            self.assertIn('未核验' if index < 2 else '假设', attributes['高度依据'])
        # The standalone input remains unchanged, including its exact closure.
        self.assertEqual(items[0], feature(concave))

    def test_exact_closure_and_saved_project_are_preserved_on_invalid_batches(self):
        invalid = feature()
        invalid['geometry']['coordinates'][0][-1][0] += 1e-10
        with TemporaryDirectory() as folder, patch('app.routers.city.CITY_DIR', Path(folder)):
            root = Path(folder)
            (root / 'versions').mkdir()
            (root / 'current.gugis.json').write_bytes(b'current fixture is never read by import')
            (root / 'pending-draft.json').write_bytes(b'pending fixture')
            (root / 'versions' / 'existing.gugis.json').write_bytes(b'history fixture')
            before = {str(p.relative_to(root)): p.read_bytes() for p in root.rglob('*') if p.is_file()}
            original = copy.deepcopy(invalid)
            response = self.import_features([feature(), invalid])
            self.assertEqual(response.status_code, 422, response.text)
            self.assertEqual(invalid, original)
            after = {str(p.relative_to(root)): p.read_bytes() for p in root.rglob('*') if p.is_file()}
            self.assertEqual(after, before)


if __name__ == '__main__':
    unittest.main()
