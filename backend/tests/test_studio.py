import copy
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import app
from app.services.building_generator import document_bytes, generate_building, statistics
from app.studio_models import BuildingDocument, BuildingParameters


class StudioTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        cls.document = generate_building(BuildingParameters())
        cls.payload = json.loads(document_bytes(cls.document))

    def test_full_building_semantic_relationships(self):
        doc = self.document
        self.assertEqual(sum(n.category == 'dwelling' for n in doc.nodes), 48)
        lookup = {n.id: n for n in doc.nodes}
        for n in doc.nodes:
            if n.category in {'window', 'door', 'balcony'}:
                household = lookup[n.parent]
                self.assertEqual(household.category, 'dwelling')
                self.assertTrue(household.attributes['住户编号'].startswith('DEMO-'))
                self.assertEqual(n.floor, household.floor)
                self.assertEqual(n.unit, household.unit)

    def test_self_contained_file_roundtrip(self):
        restored = BuildingDocument.model_validate_json(document_bytes(self.document))
        self.assertEqual(restored, self.document)
        self.assertEqual(document_bytes(restored), document_bytes(self.document))

    def test_geometry_is_3d_and_templates_save_bytes(self):
        roof = self.document.templates['roof']
        self.assertGreater(max(v[2] for v in roof.vertices), 0)
        self.assertGreaterEqual(len(roof.triangles), 8)
        stats = statistics(self.document)
        self.assertLess(stats['compact_bytes'], stats['inline_geometry_bytes'])
        self.assertLess(stats['templates'], stats['components'] / 20)

    def test_minimum_and_maximum_parameters(self):
        for floors, units, height in [(1,1,2.5),(30,4,4.5),(3,1,3.2)]:
            doc = generate_building(BuildingParameters(floors=floors,units=units,floor_height=height,kind='villa'))
            self.assertEqual(sum(n.category=='dwelling' for n in doc.nodes),floors*units*2)
            self.assertTrue(all(min(t.size)>0 for t in doc.templates.values() if t.size))

    def assert_invalid(self, mutate):
        payload=copy.deepcopy(self.payload)
        mutate(payload)
        with self.assertRaises(ValidationError):
            BuildingDocument.model_validate(payload)

    def test_reject_version_and_missing_contract(self):
        self.assert_invalid(lambda p:p.update(version='2.0'))
        self.assert_invalid(lambda p:p.pop('format'))
        self.assert_invalid(lambda p:p.update(coordinate_system='UNKNOWN'))

    def test_reject_duplicate_missing_parent_and_cycle(self):
        self.assert_invalid(lambda p:p['nodes'].append(copy.deepcopy(p['nodes'][0])))
        self.assert_invalid(lambda p:p['nodes'][1].update(parent='missing'))
        self.assert_invalid(lambda p:p['nodes'][1].update(parent=p['nodes'][1]['id']))

    def test_reject_invalid_geometry_and_floor_inheritance(self):
        self.assert_invalid(lambda p:p['nodes'][3].update(template='missing'))
        self.assert_invalid(lambda p:p['nodes'][3].update(floor=2))
        self.assert_invalid(lambda p:p['nodes'][3].update(position=[float('nan'),0,0]))
        self.assert_invalid(lambda p:p['templates']['roof']['triangles'].pop())
        self.assert_invalid(lambda p:p['templates']['roof']['triangles'][0].__setitem__(0,999))

    def test_generate_validate_and_schema_api(self):
        response=self.client.post('/studio/generate',json={'floors':3,'units':1,'kind':'villa'})
        self.assertEqual(response.status_code,200)
        validate=self.client.post('/studio/validate',json=response.json())
        self.assertEqual(validate.status_code,200)
        self.assertEqual(validate.json()['statistics']['dwellings'],6)
        self.assertEqual(self.client.get('/studio/schema').status_code,200)
        self.assertEqual(self.client.get('/studio/example').status_code,200)

    def test_invalid_inputs_are_errors_not_success(self):
        self.assertEqual(self.client.post('/studio/generate',json={'floors':0}).status_code,422)
        self.assertEqual(self.client.post('/studio/validate',content=b'{invalid').status_code,422)
        self.assertEqual(self.client.post('/studio/validate',content=b' '*(8*1024*1024+1)).status_code,413)

    def test_original_api_remains_available(self):
        self.assertEqual(self.client.get('/health').json()['status'],'ok')
        self.assertEqual(len(self.client.get('/objects').json()),18)
        self.assertGreater(len(self.client.get('/layers').json()),0)
        self.assertEqual(self.client.post('/export/gugis-json').status_code,200)

    def test_saved_file_download_and_validation_roundtrip(self):
        with TemporaryDirectory() as directory, patch('app.routers.studio.EXPORT_DIR', Path(directory)):
            response = self.client.post('/studio/save',json=self.payload)
            self.assertEqual(response.status_code,200)
            saved = response.json()
            self.assertTrue((Path(directory)/saved['filename']).is_file())
            content = self.client.get(saved['download_path'])
            self.assertEqual(content.status_code,200)
            self.assertIn('attachment',content.headers['content-disposition'])
            self.assertEqual(BuildingDocument.model_validate_json(content.content),self.document)
            again = self.client.post('/studio/save',json=self.payload).json()
            self.assertEqual(again['id'],saved['id'])
            self.assertEqual(len(list(Path(directory).iterdir())),1)
            self.assertEqual(self.client.get('/studio/files/not-an-id').status_code,404)


if __name__ == '__main__':
    unittest.main()
