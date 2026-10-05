"""Actual Leeds source, complete reproducible geometry and disclosed omissions."""
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


class LeedsSampleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source=json.loads((DATA/'leeds-source.json').read_bytes())
        cls.receipt=json.loads((DATA/'leeds-import.json').read_bytes())
        cls.bytes=(DATA/'leeds.gugis.json').read_bytes()
        cls.city=load_city(cls.bytes)

    def test_real_seed_and_source_geometry_and_height_provenance(self):
        self.assertEqual(hashlib.sha256(self.bytes).hexdigest(),'ed6d14d0af02be6d35b18d16a97674d56a27563cf80b9cb49bcf111bb4710dc1')
        self.assertEqual(len(self.bytes),11446925)
        self.assertEqual(len(self.city.instances),6049);self.assertEqual(len(self.city.roads),2924)
        self.assertEqual(json.loads(self.city.metadata['height_policy']),{'height-tag': 37, 'levels-derived': 1139, 'assumed': 4873})
        self.assertEqual(CITY_DEFAULTS['leeds']['query_bbox_wgs84'],self.source['bbox'])
        self.assertEqual(json.loads(self.city.metadata['data_bbox_wgs84']),[-1.5894071, 53.7805565, -1.5089375, 53.8164085])
        self.assertEqual(resolve_tile_size('auto','leeds'),125)
        self.assertFalse(self.city.environment and self.city.environment.terrain)
        self.assertIn('Leeds Town Hall',{i.name for i in self.city.instances})
        raw=(DATA/'leeds-osm.json').read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(),self.source['sha256'])
        self.assertEqual(self.source['retained_download_sha256'],'42150080e5f0aec30d6ec3b99acd062b8538345223c4495b57a0f0b7c43c8dd4')
        self.assertEqual(sum(self.source['publication_filter']['removed_tag_counts'].values()),591)
        for e in json.loads(raw)['elements']:
            for key in e.get('tags',{}):
                self.assertNotIn(key,{'phone','email','fax','mobile','website','url','note','description'})
                self.assertFalse(key.startswith(('contact:','note:','description:')))

    def test_full_rebuilt_city_and_every_rejection_match_retained_bytes(self):
        rebuilt,receipt=load_sample(DATA/'leeds-osm.json',DATA/'leeds-source.json','leeds')
        self.assertEqual(archive_bytes(rebuilt),self.bytes)
        self.assertEqual(receipt['omitted_buildings'],self.receipt['omitted_buildings'])
        self.assertEqual(receipt['omitted_roads'],[])
        self.assertEqual(self.receipt['source_building_ways'],6063)
        omitted={r['osm_way'] for r in receipt['omitted_buildings']}
        self.assertEqual(omitted,{1337751136, 1414663938, 452321733, 452477099, 1018389534, 178952494, 161595471, 860006318, 433027794, 573276661, 23157687, 1018389533, 446092830, 1018389535})
        self.assertFalse({f'osm{i}' for i in omitted}&{i.id for i in self.city.instances})
        self.assertTrue(all(r['reason'] for r in receipt['omitted_buildings']))
        self.assertEqual(self.city.metadata['city_id'],'leeds')
        self.assertEqual(self.city.metadata['coverage_kind'],'sample-area')
