"""Real retained Exeter source, additive publication and reproducible LoD1 geometry."""
import hashlib,json,unittest
from pathlib import Path
from app.services.city_sample_import import load_sample
from app.services.city_archive import load_city,archive_bytes
from app.services.render_profiles import resolve_tile_size
from app.services.workspace_catalog import WORKSPACES,CITY_DEFAULTS
ROOT=Path(__file__).resolve().parents[2];DATA=ROOT/'backend/data/cities'
class ExeterSampleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.seed=(DATA/'exeter.gugis.json').read_bytes();cls.city=load_city(cls.seed);cls.source=json.loads((DATA/'exeter-source.json').read_bytes());cls.report=json.loads((DATA/'exeter-import.json').read_bytes());cls.publication=json.loads((ROOT/'shared/exeter-city-publication-v1.json').read_bytes())
    def test_complete_real_seed_height_assumptions_and_untruncated_source_coverage(self):
        self.assertEqual(len(self.seed),24210432);self.assertEqual(hashlib.sha256(self.seed).hexdigest(),'d236ddec7ba795e6b92bef41f97b0de60d5b9ee9ea8dd1b080a95841e7aa18a8')
        self.assertEqual(len(self.city.instances),13396);self.assertEqual(len(self.city.roads),1889);self.assertEqual(json.loads(self.city.metadata['height_policy']),{'height-tag':3,'levels-derived':4434,'assumed':8959})
        self.assertEqual(CITY_DEFAULTS['exeter']['query_bbox_wgs84'],[-3.552,50.707,-3.51,50.736]);self.assertEqual(self.source['bbox'],CITY_DEFAULTS['exeter']['query_bbox_wgs84'])
        self.assertEqual(json.loads(self.city.metadata['data_bbox_wgs84']),[-3.5603861,50.705747,-3.5055989,50.7420561]);self.assertIn('非全城覆盖',self.city.metadata['coverage_label']);self.assertFalse(self.city.environment and self.city.environment.terrain);self.assertEqual(resolve_tile_size('auto','exeter'),125)
    def test_exact_source_reconstruction_and_all_rejections_retained(self):
        city,report=load_sample(DATA/'exeter-osm.json',DATA/'exeter-source.json','exeter');self.assertEqual(archive_bytes(city),self.seed)
        self.assertEqual(report['source_building_ways'],13400);self.assertEqual(report['omitted_buildings'],self.report['omitted_buildings']);self.assertEqual({e['osm_way'] for e in report['omitted_buildings']},{28230540,84837821,224418232,1286556146});self.assertEqual(report['omitted_roads'],[])
        omitted={f"osm{e['osm_way']}" for e in report['omitted_buildings']};self.assertFalse(omitted & {i.id for i in self.city.instances})
    def test_filtered_public_source_binds_actual_original_receipt_and_keeps_geometry(self):
        raw=(DATA/'exeter-osm.json').read_bytes();self.assertEqual(hashlib.sha256(raw).hexdigest(),self.source['sha256']);self.assertEqual(self.source['retained_download_sha256'],'5705712305548bf47878617937d1260de2deaf75437b60698245a63321569698');self.assertEqual(sum(self.source['publication_filter']['removed_tag_counts'].values()),209)
        for e in json.loads(raw)['elements']:
            for key in e.get('tags',{}):
                self.assertNotIn(key,{'phone','email','fax','mobile','website','url','note','description'});self.assertFalse(key.startswith(('contact:','note:','description:')))
        for name,e in self.publication['files'].items():
            blob=(DATA/name).read_bytes();self.assertEqual(len(blob),e['bytes']);self.assertEqual(hashlib.sha256(blob).hexdigest(),e['sha256'])
    def test_prior_fifteen_workspaces_profiles_and_all_public_native_seeds_unchanged(self):
        self.assertEqual(WORKSPACES[:-1],self.publication['previous_workspaces']);self.assertEqual(WORKSPACES[-1]['related_registry_id'],'uk-eng-exeter')
        profiles=json.loads((ROOT/'shared/render-package-profiles.json').read_bytes());self.assertEqual({k:v for k,v in profiles['tile_size_m'].items() if k!='exeter'},self.publication['previous_profiles']['tile_size_m'])
        public=json.loads((ROOT/'shared/public-city-datasets.json').read_bytes());self.assertEqual(public['sources'][:-1],self.publication['previous_public_sources']);self.assertEqual(public['sources'][-1],self.publication['new_source']);self.assertEqual(sum(e['building_count'] for e in public['sources']),113115)
        for cid,e in self.publication['previous_seeds'].items():
            path=ROOT/('backend/data/bristol.gugis.json' if cid=='bristol' else f'backend/data/cities/{cid}.gugis.json');b=path.read_bytes();self.assertEqual(len(b),e['bytes']);self.assertEqual(hashlib.sha256(b).hexdigest(),e['sha256'])
if __name__=='__main__':unittest.main()
