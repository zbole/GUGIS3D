import copy
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from fastapi.testclient import TestClient
from pydantic import ValidationError
from app.main import app
from app.studio_models import BuildingDocument, BuildingParameters
from app.city_models import CityDocument
from app.services.building_generator import generate_building, document_bytes
from app.services.city_generator import city_bytes, footprint_document
from app.services.city_archive import load_city


class CityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client=TestClient(app)
        cls.city=load_city((Path(__file__).parents[1]/'data'/'bristol.gugis.json').read_bytes())
        first=cls.city.instances[0]
        cls.sample=cls.city.model_copy(update={'assets':{first.asset:cls.city.assets[first.asset]},'instances':[first],'roads':cls.city.roads[:1]})

    def test_city_retains_real_context_and_reusable_detailed_models(self):
        self.assertEqual(len(self.city.instances),10907)
        self.assertEqual(len(self.city.assets),10897)
        self.assertEqual(sum(self.city.assets[i.asset].parameters.kind=='urban' for i in self.city.instances),600)
        self.assertEqual(sum(self.city.assets[i.asset].parameters.kind=='footprint' for i in self.city.instances),10292)
        self.assertEqual(sum(i.asset=='victorian' for i in self.city.instances),6)
        self.assertIn('OpenStreetMap',self.city.metadata['轮廓数据'])
        self.assertEqual(CityDocument.model_validate_json(city_bytes(self.city)),self.city)

    def test_styles_are_distinct_closed_assemblies_with_honest_semantics(self):
        counts=[]
        for kind in ['georgian','victorian','wills','cabot','cathedral']:
            d=generate_building(BuildingParameters(kind=kind,floors=6,units=1))
            self.assertGreater(len(d.nodes),250)
            self.assertTrue(any(t.kind=='mesh' for t in d.templates.values()))
            self.assertTrue(any(n.category=='room' for n in d.nodes))
            self.assertFalse(any(n.category=='dwelling' for n in d.nodes))
            self.assertEqual(BuildingDocument.model_validate_json(document_bytes(d)),d)
            counts.append(len(d.nodes))
        self.assertEqual(len(set(counts)),5)
        for kind in ['georgian','victorian']:
            generate_building(BuildingParameters(kind=kind,floors=12,units=4,scale=.5,floor_height=2.5))
        self.assertEqual(self.client.post('/studio/generate',json={'kind':'georgian','floors':30}).status_code,422)
        self.assertEqual(self.client.post('/studio/generate',json={'kind':'footprint'}).status_code,422)

    def test_scale_changes_geometry_but_preserves_topology(self):
        for kind in ['tower','victorian','wills']:
            a=generate_building(BuildingParameters(kind=kind,floors=3,units=1))
            b=generate_building(BuildingParameters(kind=kind,floors=3,units=1,scale=2))
            self.assertEqual(len(a.nodes),len(b.nodes))
            for x,y in zip(a.nodes,b.nodes):
                if x.position:
                    for p,q in zip(x.position,y.position):self.assertAlmostEqual(p*2,q,places=4)

    def test_concave_footprint_is_a_closed_mesh(self):
        ring=[[-2.60,51.45],[-2.5998,51.45],[-2.5998,51.4501],[-2.5999,51.4501],[-2.5999,51.4502],[-2.60,51.4502],[-2.60,51.45]]
        d=footprint_document(ring,'Concave building',12)
        self.assertEqual(len(d.templates['volume'].vertices),12)
        self.assertEqual(max(v[2] for v in d.templates['volume'].vertices),12)
        self.assertEqual(BuildingDocument.model_validate_json(document_bytes(d)),d)

    def test_reject_missing_assets_duplicate_ids_and_wrong_version(self):
        payload=json.loads(city_bytes(self.sample))
        for mutate in [lambda p:p.update(version='2.0'),lambda p:p['instances'][0].update(asset='missing'),lambda p:p['instances'].append(p['instances'][0])]:
            p=copy.deepcopy(payload);mutate(p)
            with self.assertRaises(ValidationError):CityDocument.model_validate(p)

    def test_durable_revisioned_save_reload_export_and_conflict(self):
        with TemporaryDirectory() as folder,patch('app.routers.city.CITY_DIR',Path(folder)):
            (Path(folder)/'current.gugis.json').write_bytes(city_bytes(self.sample))
            initial=self.client.get('/city/current').json()
            self.assertEqual(self.client.get('/city/revision').json()['revision'],initial['revision'])
            edited=copy.deepcopy(initial['document']);edited['name']='Persistence test';edited['instances'][0]['heading']=35
            result=self.client.post('/city/current',json={'base_revision':initial['revision'],'document':edited})
            self.assertEqual(result.status_code,200)
            self.assertNotEqual(result.json()['revision'],initial['revision'])
            current=self.client.get('/city/current').json()
            self.assertEqual(self.client.get('/city/revision').json()['revision'],current['revision'])
            self.assertEqual(current['document']['name'],'Persistence test')
            self.assertEqual(current['document']['instances'][0]['heading'],35)
            download=self.client.get('/city/export')
            self.assertEqual(load_city(download.content),load_city(edited))
            self.assertIn('attachment',download.headers['content-disposition'])
            stale=self.client.post('/city/current',json={'base_revision':initial['revision'],'document':initial['document']})
            self.assertEqual(stale.status_code,409)
            self.assertEqual(self.client.get('/city/current').json()['revision'],current['revision'])
            self.assertGreaterEqual(len(list((Path(folder)/'versions').glob('*.json'))),2)
            self.assertFalse(list(Path(folder).glob('*.tmp')))

    def test_invalid_upload_preserves_saved_project(self):
        with TemporaryDirectory() as folder,patch('app.routers.city.CITY_DIR',Path(folder)):
            (Path(folder)/'current.gugis.json').write_bytes(city_bytes(self.sample))
            initial=self.client.get('/city/current').json()
            self.assertEqual(self.client.post('/city/validate',content=b'{bad').status_code,422)
            self.assertEqual(self.client.post('/city/current',json={'base_revision':initial['revision'],'document':{'format':'other'}}).status_code,422)
            invalid=copy.deepcopy(initial['document'])
            first_asset=next(iter(invalid['assets'].values()))
            next(iter(first_asset['templates'].values()))['geometry']='missing'
            self.assertEqual(self.client.post('/city/current',json={'base_revision':initial['revision'],'document':invalid}).status_code,422)
            self.assertEqual(self.client.get('/city/current').json()['revision'],initial['revision'])
            # A corrupt saved file must never be silently reset to the sample.
            (Path(folder)/'current.gugis.json').write_bytes(b'broken')
            self.assertEqual(self.client.get('/city/current').status_code,500)
            self.assertEqual((Path(folder)/'current.gugis.json').read_bytes(),b'broken')

    def test_geojson_import_is_validated_as_a_complete_batch(self):
        ring=[[-2.6,51.45],[-2.5998,51.45],[-2.5998,51.4501],[-2.6,51.4501],[-2.6,51.45]]
        payload={'type':'FeatureCollection','features':[{'type':'Feature','properties':{'name':'Import test','height':16},'geometry':{'type':'Polygon','coordinates':[ring]}}]}
        r=self.client.post('/city/geojson',json=payload)
        self.assertEqual(r.status_code,200)
        doc=BuildingDocument.model_validate(r.json()['documents'][0])
        self.assertEqual(doc.parameters.name,'Import test')
        self.assertEqual(max(v[2] for v in doc.templates['volume'].vertices),16)
        payload['features'][0]['geometry']['coordinates'].append(ring)
        self.assertEqual(self.client.post('/city/geojson',json=payload).status_code,422)


if __name__=='__main__':unittest.main()
