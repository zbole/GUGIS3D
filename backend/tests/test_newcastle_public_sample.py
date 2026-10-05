"""Actual Newcastle source, complete reproducible geometry and disclosed omissions."""
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


class NewcastleSampleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source=json.loads((DATA/'newcastle-source.json').read_bytes())
        cls.receipt=json.loads((DATA/'newcastle-import.json').read_bytes())
        cls.bytes=(DATA/'newcastle.gugis.json').read_bytes()
        cls.city=load_city(cls.bytes)

    def test_real_seed_and_source_geometry_and_height_provenance(self):
        self.assertEqual(hashlib.sha256(self.bytes).hexdigest(),'f05d9401a907296333bb1e7c1852d0f0148aaae9d3105f1f950e5aa8830117cf')
        self.assertEqual(len(self.bytes),7073977)
        self.assertEqual(len(self.city.instances),3560);self.assertEqual(len(self.city.roads),1950)
        self.assertEqual(json.loads(self.city.metadata['height_policy']),{'height-tag': 9, 'levels-derived': 384, 'assumed': 3167})
        self.assertEqual(CITY_DEFAULTS['newcastle']['query_bbox_wgs84'],self.source['bbox'])
        self.assertEqual(json.loads(self.city.metadata['data_bbox_wgs84']),[-1.6478735, 54.9564571, -1.5721692, 54.9913634])
        self.assertEqual(resolve_tile_size('auto','newcastle'),125)
        self.assertFalse(self.city.environment and self.city.environment.terrain)
        self.assertIn('St Nicholas Cathedral',{i.name for i in self.city.instances})
        raw=(DATA/'newcastle-osm.json').read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(),self.source['sha256'])
        self.assertEqual(self.source['retained_download_sha256'],'c11adb25e98b797d91f5b9be12c3ba45f0ddbacf34d7d9b25bd616785946521c')
        self.assertEqual(sum(self.source['publication_filter']['removed_tag_counts'].values()),439)
        for e in json.loads(raw)['elements']:
            for key in e.get('tags',{}):
                self.assertNotIn(key,{'phone','email','fax','mobile','website','url','note','description'})
                self.assertFalse(key.startswith(('contact:','note:','description:')))

    def test_full_rebuilt_city_and_every_rejection_match_retained_bytes(self):
        rebuilt,receipt=load_sample(DATA/'newcastle-osm.json',DATA/'newcastle-source.json','newcastle')
        self.assertEqual(archive_bytes(rebuilt),self.bytes)
        self.assertEqual(receipt['omitted_buildings'],self.receipt['omitted_buildings'])
        self.assertEqual(receipt['omitted_roads'],[])
        self.assertEqual(self.receipt['source_building_ways'],3561)
        omitted={r['osm_way'] for r in receipt['omitted_buildings']}
        self.assertEqual(omitted,{211661633})
        self.assertFalse({f'osm{i}' for i in omitted}&{i.id for i in self.city.instances})
        self.assertTrue(all(r['reason'] for r in receipt['omitted_buildings']))
        self.assertEqual(self.city.metadata['city_id'],'newcastle')
        self.assertEqual(self.city.metadata['coverage_kind'],'sample-area')
