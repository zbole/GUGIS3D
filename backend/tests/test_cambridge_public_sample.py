"""Actual Cambridge source, complete reproducible geometry and disclosed omissions."""
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


class CambridgeSampleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source=json.loads((DATA/'cambridge-source.json').read_bytes())
        cls.receipt=json.loads((DATA/'cambridge-import.json').read_bytes())
        cls.bytes=(DATA/'cambridge.gugis.json').read_bytes()
        cls.city=load_city(cls.bytes)

    def test_real_seed_and_source_geometry_and_height_provenance(self):
        self.assertEqual(hashlib.sha256(self.bytes).hexdigest(),'f6fba9b06291d5c4b309272d723d9628ee3ee40c16e5f7c7ee6761220e8cd5a8')
        self.assertEqual(len(self.bytes),18417340)
        self.assertEqual(len(self.city.instances),9838);self.assertEqual(len(self.city.roads),1501)
        self.assertEqual(json.loads(self.city.metadata['height_policy']),{'height-tag':4,'levels-derived':2541,'assumed':7293})
        self.assertEqual(CITY_DEFAULTS['cambridge']['query_bbox_wgs84'],self.source['bbox'])
        self.assertEqual(json.loads(self.city.metadata['data_bbox_wgs84']),[0.0956414,52.1839678,0.1543402,52.2209898])
        self.assertEqual(resolve_tile_size('auto','cambridge'),125)
        self.assertFalse(self.city.environment and self.city.environment.terrain)
        self.assertIn('The Senate House',{i.name for i in self.city.instances})
        raw=(DATA/'cambridge-osm.json').read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(),self.source['sha256'])
        self.assertEqual(self.source['retained_download_sha256'],'0985aeccf602f924ac6d2feb30eb8b51ab7ffbf0c9cb370d798f936103e030d4')
        self.assertEqual(sum(self.source['publication_filter']['removed_tag_counts'].values()),530)
        for e in json.loads(raw)['elements']:
            for key in e.get('tags',{}):
                self.assertNotIn(key,{'phone','email','fax','mobile','website','url','note','description'})
                self.assertFalse(key.startswith(('contact:','note:','description:')))

    def test_full_rebuilt_city_and_every_rejection_match_retained_bytes(self):
        rebuilt,receipt=load_sample(DATA/'cambridge-osm.json',DATA/'cambridge-source.json','cambridge')
        self.assertEqual(archive_bytes(rebuilt),self.bytes)
        self.assertEqual(receipt['omitted_buildings'],self.receipt['omitted_buildings'])
        self.assertEqual(receipt['omitted_roads'],[])
        self.assertEqual(self.receipt['source_building_ways'],9846)
        omitted={r['osm_way'] for r in receipt['omitted_buildings']}
        self.assertEqual(omitted,{157588876,170216407,170216440,179755584,191206698,191206700,193313680,670071388})
        self.assertFalse({f'osm{i}' for i in omitted}&{i.id for i in self.city.instances})
        self.assertTrue(all(r['reason'] for r in receipt['omitted_buildings']))
        self.assertEqual(self.city.metadata['city_id'],'cambridge')
        self.assertEqual(self.city.metadata['coverage_kind'],'sample-area')
