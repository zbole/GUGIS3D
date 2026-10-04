import unittest
from app.services.city_expansion import merge_expansion
from app.services.city_sample_import import build_osm_sample
from app.services.city_archive import archive_bytes, load_city


def sample(ids, height='12'):
    elements = [{'type': 'way', 'id': i, 'tags': {'building': 'yes', 'height': height},
                 'geometry': [{'lon': x, 'lat': y} for x,y in [(-.13,51.50),(-.1299,51.50),(-.1299,51.5001),(-.13,51.5001),(-.13,51.50)]]} for i in ids]
    return build_osm_sample({'elements':elements}, {'city_id':'london','bbox':[-.14,51.49,-.12,51.51],
        'coverage_label':'Synthetic test only','source_url':'https://example.test'},'london')[0]


class CityExpansionTests(unittest.TestCase):
    def test_existing_geometry_and_placement_edits_survive_expansion_and_roundtrip(self):
        original=sample([1], '77'); incoming=sample([1,2], '12')
        before=archive_bytes(original)
        merged,report=merge_expansion(original,incoming,'london')
        self.assertEqual(archive_bytes(original),before)
        self.assertEqual(merged.assets['osm1'],original.assets['osm1'])
        self.assertEqual(merged.instances[0],original.instances[0])
        self.assertEqual(report['added_buildings'],1)
        self.assertEqual(report['skipped_existing_ids'],['osm1'])
        self.assertEqual(load_city(archive_bytes(merged)),merged)
        second,second_report=merge_expansion(merged,incoming,'london')
        self.assertEqual(second.instances,merged.instances)
        self.assertEqual(archive_bytes(second),archive_bytes(merged))
        self.assertEqual(second_report['added_buildings'],0)

    def test_unreferenced_asset_name_collision_never_overwrites_old_geometry(self):
        original=sample([1], '77'); incoming=sample([2], '12')
        original.assets['osm2']=original.assets['osm1'].model_copy(deep=True)
        merged,report=merge_expansion(original,incoming,'london')
        self.assertEqual(merged.assets['osm2'],original.assets['osm2'])
        self.assertEqual(merged.instances[-1].asset,'exp_osm2')
        self.assertEqual(merged.assets['exp_osm2'],incoming.assets['osm2'])
        self.assertEqual(len(report['asset_collisions']),1)

    def test_cross_city_sources_and_terrain_replacement_are_rejected(self):
        original=sample([1]); incoming=sample([2])
        with self.assertRaises(ValueError):merge_expansion(original,incoming,'birmingham')
        unidentified=original.model_copy(update={'metadata':{}})
        with self.assertRaises(ValueError):merge_expansion(unidentified,incoming,'london')
        from app.services.terrain_builder import demo_terrain
        from app.environment_models import Environment
        incoming.environment=Environment(terrain=demo_terrain())
        with self.assertRaises(ValueError):merge_expansion(original,incoming,'london')

    def test_colliding_shared_incoming_model_is_resolved_once_and_stays_shared(self):
        from app.city_models import CityDocument
        original=sample([1], '77'); incoming=sample([2,3], '12')
        incoming=CityDocument.model_validate({**incoming.model_dump(), 'assets':{'osm1':incoming.assets['osm2']},
            'instances':[p.model_copy(update={'asset':'osm1'}) for p in incoming.instances]})
        merged,report=merge_expansion(original,incoming,'london')
        self.assertEqual(len(merged.assets),2)
        self.assertEqual([p.asset for p in merged.instances],['osm1','exp_osm1','exp_osm1'])
        self.assertEqual(merged.assets['osm1'],original.assets['osm1'])
        self.assertEqual(len(report['asset_collisions']),1)
        self.assertEqual(load_city(archive_bytes(merged)),merged)

    def test_merge_cli_prepares_review_files_and_refuses_existing_outputs(self):
        import hashlib
        import json
        import os
        from pathlib import Path
        import subprocess
        import sys
        from tempfile import TemporaryDirectory
        root=Path(__file__).resolve().parents[2]
        with TemporaryDirectory() as directory:
            base=Path(directory)/'baseline.json'; source=Path(directory)/'incoming.json'
            out=Path(directory)/'review.json'; receipt=Path(directory)/'receipt.json'
            original=archive_bytes(sample([1],'77')); incoming=archive_bytes(sample([1,2],'12'))
            base.write_bytes(original);source.write_bytes(incoming)
            command=[sys.executable,str(root/'data-pipeline/merge_city_expansion.py'),'--city','london',
                     '--baseline',str(base),'--incoming',str(source),'--output',str(out),'--report',str(receipt)]
            result=subprocess.run(command,check=False,capture_output=True,text=True,encoding='utf-8',
                                  env={**os.environ,'PYTHONUTF8':'1'},timeout=30)
            self.assertEqual(result.returncode,0,result.stderr)
            content=out.read_bytes(); report=json.loads(receipt.read_bytes())
            self.assertEqual(report['output_sha256'],hashlib.sha256(content).hexdigest())
            self.assertEqual(report['baseline_file_sha256'],hashlib.sha256(original).hexdigest())
            self.assertEqual(len(load_city(content).instances),2)
            second=subprocess.run(command,check=False,capture_output=True,text=True,encoding='utf-8',
                                  env={**os.environ,'PYTHONUTF8':'1'},timeout=30)
            self.assertEqual(second.returncode,2)
            self.assertEqual(out.read_bytes(),content)
            self.assertEqual(base.read_bytes(),original);self.assertEqual(source.read_bytes(),incoming)

    def test_instanced_semantic_budget_remains_enforced_for_shared_assets(self):
        from app.city_models import CityDocument
        from pydantic import ValidationError
        original=sample([1]);doc=original.assets['osm1']
        nodes=[*doc.nodes,*[doc.nodes[-1].model_copy(update={'id':f'extra{i}'}) for i in range(40)]]
        asset=doc.model_validate({**doc.model_dump(),'nodes':nodes})
        payload={**original.model_dump(),'assets':{'shared':asset},'instances':[
            {'id':f'p{i}','asset':'shared','name':'Budget test','longitude':-.13,'latitude':51.5} for i in range(10000)]}
        with self.assertRaises(ValidationError) as caught:CityDocument.model_validate(payload)
        self.assertIn('300,000 instanced semantic nodes',str(caught.exception))
