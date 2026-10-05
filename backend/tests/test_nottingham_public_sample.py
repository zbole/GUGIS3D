"""Actual Nottingham source, complete reproducible geometry and disclosed omissions."""
import hashlib
import json
from pathlib import Path
import unittest

from app.services.city_sample_import import load_sample
from app.services.city_archive import load_city, archive_bytes
from app.services.render_profiles import resolve_tile_size
from app.services.workspace_catalog import CITY_DEFAULTS

ROOT=Path(__file__).resolve().parents[2]
DATA=ROOT/'backend/data/cities'


class NottinghamSampleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source=json.loads((DATA/'nottingham-source.json').read_bytes())
        cls.receipt=json.loads((DATA/'nottingham-import.json').read_bytes())
        cls.bytes=(DATA/'nottingham.gugis.json').read_bytes()
        cls.city=load_city(cls.bytes)

    def test_real_seed_and_source_geometry_and_height_provenance(self):
        self.assertEqual(hashlib.sha256(self.bytes).hexdigest(),'858b1578db64b0845a004b15be0c8cc24119f960b5b5c158a897bd76efb1ef01')
        self.assertEqual(len(self.bytes),30922073)
        self.assertEqual(len(self.city.instances),17134);self.assertEqual(len(self.city.roads),2941)
        self.assertEqual(json.loads(self.city.metadata['height_policy']),{'height-tag': 36, 'levels-derived': 881, 'assumed': 16217})
        self.assertEqual(CITY_DEFAULTS['nottingham']['query_bbox_wgs84'],self.source['bbox'])
        self.assertEqual(json.loads(self.city.metadata['data_bbox_wgs84']),[-1.1770676, 52.9345439, -1.1173373, 52.9698999])
        self.assertEqual(resolve_tile_size('auto','nottingham'),125)
        self.assertFalse(self.city.environment and self.city.environment.terrain)
        self.assertIn('Council House',{i.name for i in self.city.instances})
        raw=(DATA/'nottingham-osm.json').read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(),self.source['sha256'])
        self.assertEqual(self.source['retained_download_sha256'],'c92fae509d7e5cb54c4797ffee0d80df6ce948561032caff6563926e85980993')
        self.assertEqual(sum(self.source['publication_filter']['removed_tag_counts'].values()),1514)
        for e in json.loads(raw)['elements']:
            for key in e.get('tags',{}):
                self.assertNotIn(key,{'phone','email','fax','mobile','website','url','note','description'})
                self.assertFalse(key.startswith(('contact:','note:','description:')))

    def test_full_rebuilt_city_and_every_rejection_match_retained_bytes(self):
        rebuilt,receipt=load_sample(DATA/'nottingham-osm.json',DATA/'nottingham-source.json','nottingham')
        self.assertEqual(archive_bytes(rebuilt),self.bytes)
        self.assertEqual(receipt['omitted_buildings'],self.receipt['omitted_buildings'])
        self.assertEqual(receipt['omitted_roads'],[])
        self.assertEqual(self.receipt['source_building_ways'],17141)
        omitted={r['osm_way'] for r in receipt['omitted_buildings']}
        self.assertEqual(omitted,{85406503,165120766,273376471,292975280,363152364,409365982,653579100})
        self.assertFalse({f'osm{i}' for i in omitted}&{i.id for i in self.city.instances})
        self.assertTrue(all(r['reason'] for r in receipt['omitted_buildings']))
        self.assertEqual(self.city.metadata['city_id'],'nottingham')
        self.assertEqual(self.city.metadata['coverage_kind'],'sample-area')

    def test_large_real_sample_and_finite_asset_and_instance_caps(self):
        from pydantic import ValidationError
        from app.city_models import CityDocument,Placement,MAX_CITY_ASSETS,MAX_CITY_INSTANCES
        self.assertGreater(len(self.city.instances),15000)
        asset_id=next(iter(self.city.assets));asset=self.city.assets[asset_id]
        placements=[Placement(id=f'bounded{i}',asset=asset_id,name='Bounded',longitude=0,latitude=0) for i in range(20001)]
        args=dict(format='gugis-city',version='1.0',coordinate_system='ENU_METERS_WGS84',name='Finite capacity',assets={asset_id:asset},instances=placements[:20000])
        self.assertEqual(len(CityDocument(**args).instances),20000)
        with self.assertRaises(ValidationError) as caught:CityDocument(**dict(args,instances=placements))
        self.assertTrue(any(e['loc']==('instances',) and e['ctx'].get('max_length')==20000 for e in caught.exception.errors()))
        with self.assertRaises(ValidationError) as caught:CityDocument(**dict(args,instances=[],assets={f'a{i}':asset for i in range(20001)}))
        self.assertTrue(any(e['loc']==('assets',) and e['ctx'].get('max_length')==20000 for e in caught.exception.errors()))
        self.assertEqual(MAX_CITY_ASSETS,20000);self.assertEqual(MAX_CITY_INSTANCES,20000)
