"""Actual retained Oxford data, not synthetic counts or current-project writes."""
import hashlib
import json
from pathlib import Path
import unittest

from app.services.city_sample_import import load_sample
from app.services.city_archive import load_city
from app.services.render_profiles import resolve_tile_size
from app.services.workspace_catalog import CITY_DEFAULTS

ROOT=Path(__file__).resolve().parents[2]
DATA=ROOT/'backend/data/cities'


class OxfordSampleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source=json.loads((DATA/'oxford-source.json').read_bytes())
        cls.receipt=json.loads((DATA/'oxford-import.json').read_bytes())
        cls.bytes=(DATA/'oxford.gugis.json').read_bytes()
        cls.city=load_city(cls.bytes)

    def test_retained_real_seed_and_height_provenance(self):
        self.assertEqual(hashlib.sha256(self.bytes).hexdigest(),self.receipt['gugis_sha256'])
        self.assertEqual(len(self.bytes),self.receipt['gugis_bytes'])
        self.assertEqual(len(self.city.instances),6594); self.assertEqual(len(self.city.roads),1123)
        self.assertEqual(json.loads(self.city.metadata['height_policy']),{'height-tag':11,'levels-derived':682,'assumed':5901})
        self.assertEqual(CITY_DEFAULTS['oxford']['query_bbox_wgs84'],self.source['bbox'])
        self.assertEqual(resolve_tile_size('auto','oxford'),125)
        self.assertFalse(self.city.environment and self.city.environment.terrain)
        self.assertIn('The Covered Market',{i.name for i in self.city.instances})

    def test_rebuild_retains_ids_and_all_rejection_reasons(self):
        rebuilt, receipt=load_sample(DATA/'oxford-osm.json',DATA/'oxford-source.json','oxford')
        self.assertEqual([i.id for i in rebuilt.instances],[i.id for i in self.city.instances])
        self.assertEqual(receipt['omitted_buildings'],self.receipt['omitted_buildings'])
        self.assertEqual(len(receipt['omitted_buildings']),10)
        self.assertEqual(self.receipt['source_building_ways'],6604)
        omitted={f"osm{r['osm_way']}" for r in receipt['omitted_buildings']}
        self.assertFalse(omitted&{i.id for i in self.city.instances})
        self.assertTrue(all(r['reason'] for r in receipt['omitted_buildings']))
        self.assertEqual(self.city.metadata['city_id'],'oxford')
        self.assertEqual(self.city.metadata['coverage_kind'],'sample-area')
