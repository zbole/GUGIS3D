"""Actual Liverpool source, complete reproducible geometry and disclosed omissions."""
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


class LiverpoolSampleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source=json.loads((DATA/'liverpool-source.json').read_bytes())
        cls.receipt=json.loads((DATA/'liverpool-import.json').read_bytes())
        cls.bytes=(DATA/'liverpool.gugis.json').read_bytes()
        cls.city=load_city(cls.bytes)

    def test_real_seed_and_source_geometry_and_height_provenance(self):
        self.assertEqual(hashlib.sha256(self.bytes).hexdigest(),'1c627bae18128bd9eff98094f4910d832a04377f8d499321fb535ee1559c79c0')
        self.assertEqual(len(self.bytes),6588341)
        self.assertEqual(len(self.city.instances),3401);self.assertEqual(len(self.city.roads),1419)
        self.assertEqual(json.loads(self.city.metadata['height_policy']),{'height-tag':46,'levels-derived':196,'assumed':3159})
        self.assertEqual(CITY_DEFAULTS['liverpool']['query_bbox_wgs84'],self.source['bbox'])
        self.assertEqual(json.loads(self.city.metadata['data_bbox_wgs84']),[-3.0251771,53.3869328,-2.961707,53.4216978])
        self.assertEqual(resolve_tile_size('auto','liverpool'),125)
        self.assertFalse(self.city.environment and self.city.environment.terrain)
        self.assertIn('Royal Liver Building',{i.name for i in self.city.instances})
        raw=(DATA/'liverpool-osm.json').read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(),self.source['sha256'])
        self.assertEqual(self.source['retained_download_sha256'],'6b10839e213a0fd470578fb28ec7a2ff40d0c30a3d93532c4d3693ad143d658a')
        self.assertEqual(sum(self.source['publication_filter']['removed_tag_counts'].values()),287)
        for e in json.loads(raw)['elements']:
            for key in e.get('tags',{}):
                self.assertNotIn(key,{'phone','email','fax','mobile','website','url','note','description'})
                self.assertFalse(key.startswith(('contact:','note:','description:')))

    def test_full_rebuilt_city_and_every_rejection_match_retained_bytes(self):
        rebuilt,receipt=load_sample(DATA/'liverpool-osm.json',DATA/'liverpool-source.json','liverpool')
        self.assertEqual(archive_bytes(rebuilt),self.bytes)
        self.assertEqual(receipt['omitted_buildings'],self.receipt['omitted_buildings'])
        self.assertEqual(receipt['omitted_roads'],[])
        self.assertEqual(self.receipt['source_building_ways'],3427)
        omitted={r['osm_way'] for r in receipt['omitted_buildings']}
        self.assertEqual(omitted,{23962926,67328185,68577319,86123389,86123391,86123394,204479292,204479301,204483469,204483477,218491074,222171053,271959254,288362577,288362583,288362590,288362626,288362641,651521415,659560481,661221033,661482820,661727736,666532970,666543888,1106026670})
        self.assertFalse({f'osm{i}' for i in omitted}&{i.id for i in self.city.instances})
        self.assertTrue(all(r['reason'] for r in receipt['omitted_buildings']))
        self.assertEqual(self.city.metadata['city_id'],'liverpool')
        self.assertEqual(self.city.metadata['coverage_kind'],'sample-area')
