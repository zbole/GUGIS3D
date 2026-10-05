"""Actual Sheffield source, complete reproducible geometry and disclosed omissions."""
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


class SheffieldSampleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source=json.loads((DATA/'sheffield-source.json').read_bytes())
        cls.receipt=json.loads((DATA/'sheffield-import.json').read_bytes())
        cls.bytes=(DATA/'sheffield.gugis.json').read_bytes()
        cls.city=load_city(cls.bytes)

    def test_real_seed_and_source_geometry_and_height_provenance(self):
        self.assertEqual(hashlib.sha256(self.bytes).hexdigest(),'855f2377ec4cc4506c4bb319cbf81ea6da25256e08b0d2a0f47eb8d3844b3845')
        self.assertEqual(len(self.bytes),9103469)
        self.assertEqual(len(self.city.instances),4324);self.assertEqual(len(self.city.roads),2407)
        self.assertEqual(json.loads(self.city.metadata['height_policy']),{'height-tag':61,'levels-derived':847,'assumed':3416})
        self.assertEqual(CITY_DEFAULTS['sheffield']['query_bbox_wgs84'],self.source['bbox'])
        self.assertEqual(json.loads(self.city.metadata['data_bbox_wgs84']),[-1.4978856,53.364912,-1.4411137,53.3929093])
        self.assertEqual(resolve_tile_size('auto','sheffield'),125)
        self.assertFalse(self.city.environment and self.city.environment.terrain)
        self.assertIn('Sheffield City Hall',{i.name for i in self.city.instances})
        raw=(DATA/'sheffield-osm.json').read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(),self.source['sha256'])
        self.assertEqual(self.source['retained_download_sha256'],'c32c158a07193170afc4b2896c21525f7529bec6c8fa85a991bb728668db756f')
        self.assertEqual(sum(self.source['publication_filter']['removed_tag_counts'].values()),401)
        for e in json.loads(raw)['elements']:
            for key in e.get('tags',{}):
                self.assertNotIn(key,{'phone','email','fax','mobile','website','url','note','description'})
                self.assertFalse(key.startswith(('contact:','note:','description:')))

    def test_full_rebuilt_city_and_every_rejection_match_retained_bytes(self):
        rebuilt,receipt=load_sample(DATA/'sheffield-osm.json',DATA/'sheffield-source.json','sheffield')
        self.assertEqual(archive_bytes(rebuilt),self.bytes)
        self.assertEqual(receipt['omitted_buildings'],self.receipt['omitted_buildings'])
        self.assertEqual(receipt['omitted_roads'],[])
        self.assertEqual(self.receipt['source_building_ways'],4328)
        omitted={r['osm_way'] for r in receipt['omitted_buildings']}
        self.assertEqual(omitted,{23032889,103906516,1206695602,1509803189})
        self.assertFalse({f'osm{i}' for i in omitted}&{i.id for i in self.city.instances})
        self.assertTrue(all(r['reason'] for r in receipt['omitted_buildings']))
        self.assertEqual(self.city.metadata['city_id'],'sheffield')
        self.assertEqual(self.city.metadata['coverage_kind'],'sample-area')
