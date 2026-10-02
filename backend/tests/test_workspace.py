import json
import unittest
from zipfile import ZipFile
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from fastapi.testclient import TestClient
from app.main import app
from app.city_models import CityDocument
from app.studio_models import BuildingParameters, BuildingDocument
from app.services.building_generator import generate_building, document_bytes
from app.services.city_archive import archive_bytes, load_city
from app.routers import city

class WorkspaceTests(unittest.TestCase):
    def test_experiment_download_checks_full_revision_and_bundle_before_serving(self):
        snapshot, bundle = 'a'*64, 'b'*64
        directory = city.CITY_DIR.parent/'benchmark'
        directory.mkdir()
        package = directory/f'terrain-suite-{snapshot[:16]}-{bundle}.zip'
        def write_manifest(manifest):
            with ZipFile(package, 'w') as archive:
                archive.writestr('comparison-report.json', json.dumps(manifest))
        manifest = {'schema': 'gugis-terrain-comparison-suite-v1', 'cityRevision': snapshot, 'bundleId': bundle}
        write_manifest(manifest)
        params = {'snapshot': snapshot, 'bundle': bundle}
        response = self.client.get('/city/terrain/benchmark-suite.zip', params=params)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers['X-GUGIS-Experiment-ID'], bundle)
        self.assertEqual(response.headers['X-GUGIS-City-Revision'], snapshot)
        # Equal filename prefix must never pass the full revision check.
        write_manifest({**manifest, 'cityRevision': snapshot[:16]+'f'*48})
        self.assertEqual(self.client.get('/city/terrain/benchmark-suite.zip', params=params).status_code, 409)
        write_manifest({**manifest, 'bundleId': 'c'*64})
        self.assertEqual(self.client.get('/city/terrain/benchmark-suite.zip', params=params).status_code, 409)
        write_manifest({**manifest, 'bundleId': 'x'*64})
        self.assertEqual(self.client.get('/city/terrain/benchmark-suite.zip', params=params).status_code, 409)
        package.write_bytes(b'corrupt zip')
        self.assertEqual(self.client.get('/city/terrain/benchmark-suite.zip', params=params).status_code, 409)
        self.assertEqual(self.client.get('/city/terrain/benchmark-suite.zip', params={**params, 'bundle': 'c'*64}).status_code, 404)

    def test_comparison_download_never_substitutes_current_city_for_a_missing_snapshot(self):
        self.assertEqual(self.client.get('/city/terrain/benchmark.zip', params={'snapshot': 'f' * 64}).status_code, 404)
        self.assertEqual(self.client.get('/city/terrain/benchmark.zip', params={'snapshot': '../current'}).status_code, 422)
        self.assertEqual(self.client.get('/city/terrain/benchmark-suite.zip', params={'snapshot': 'f' * 64}).status_code, 404)
        self.assertEqual(self.client.get('/city/terrain/benchmark-suite.zip', params={'snapshot': '../current'}).status_code, 422)

    def stage(self, name='Trial', editor=None):
        body = dict(document={**self.start['document'], 'name': name}, base_revision=self.start['revision'], label=name)
        if editor: body['editor'] = editor
        result = self.client.post('/city/draft', json=body)
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()['revision']

    def test_commit_is_single_request_keeps_versions_and_retries_after_lost_response(self):
        token = self.stage()
        result = self.client.post('/city/draft/commit', json={'revision': token})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertIsNone(self.client.get('/city/draft').json()['draft'])
        self.assertEqual(self.client.get('/city/current').json()['document']['name'], 'Trial')
        self.assertEqual(self.client.get('/city/versions/'+self.start['revision']).status_code, 200)
        repeated = self.client.post('/city/draft/commit', json={'revision': token})
        self.assertEqual(repeated.json()['revision'], result.json()['revision'])

    def test_commit_rejects_both_stale_draft_and_stale_city(self):
        token = self.stage()
        self.assertEqual(self.client.post('/city/draft/commit', json={'revision': '0'*64}).status_code, 409)
        self.client.post('/city/current', json={'base_revision': self.start['revision'], 'document': {**self.start['document'], 'name': 'Other window'}})
        self.assertEqual(self.client.post('/city/draft/commit', json={'revision': token}).status_code, 409)
        self.assertEqual(self.client.get('/city/draft').json()['draft']['revision'], token)

    def test_commit_cleanup_failure_is_safe_and_new_draft_not_deleted_by_retry(self):
        token = self.stage()
        with patch.object(Path, 'unlink', side_effect=PermissionError('locked file')):
            result = self.client.post('/city/draft/commit', json={'revision': token})
        self.assertEqual(result.status_code, 200)
        self.assertIsNone(self.client.get('/city/draft').json()['draft'])
        self.start = self.client.get('/city/current').json()
        next_token = self.stage('Next draft')
        self.assertEqual(self.client.post('/city/draft/commit', json={'revision': token}).status_code, 200)
        self.assertEqual(self.client.get('/city/draft').json()['draft']['revision'], next_token)

    def test_interruption_before_city_replace_retains_retryable_draft(self):
        token = self.stage()
        with patch.object(city, 'write_snapshot', side_effect=OSError('disk unavailable')):
            with self.assertRaises(OSError):
                self.client.post('/city/draft/commit', json={'revision': token})
        self.assertEqual(self.client.get('/city/current').json()['revision'], self.start['revision'])
        self.assertEqual(self.client.get('/city/draft').json()['draft']['revision'], token)
        self.assertEqual(self.client.post('/city/draft/commit', json={'revision': token}).status_code, 200)

    def test_corrupt_draft_is_preserved_and_does_not_prevent_reading_formal_city(self):
        path = city.CITY_DIR/'pending-draft.json'
        path.write_bytes(b'{broken')
        self.assertEqual(self.client.get('/city/draft').status_code, 422)
        self.assertEqual(self.client.get('/city/current').json()['revision'], self.start['revision'])
        self.assertEqual(path.read_bytes(), b'{broken')

    def test_draft_keeps_editor_context_across_reload(self):
        editor = dict(mode='update', instance_id='one', parameters=self.original.assets['a'].parameters.model_dump(mode='json'))
        self.stage(editor=editor)
        self.assertEqual(self.client.get('/city/draft').json()['draft']['editor'], editor)

    def setUp(self):
        self.tmp=TemporaryDirectory()
        self.directory=Path(self.tmp.name)
        self.client=TestClient(app)
        doc=generate_building(BuildingParameters(kind='villa',floors=2,units=1))
        self.original=CityDocument(format='gugis-city',version='1.0',coordinate_system='ENU_METERS_WGS84',name='Original',assets={'a':doc},instances=[dict(id='one',asset='a',name='One',longitude=-2.603,latitude=51.454)])
        self.seed=self.directory/'seed.json'
        self.seed.write_bytes(archive_bytes(self.original))
        self.patches=[patch.object(city,'CITY_DIR',self.directory/'city'),patch.object(city,'SEED',self.seed)]
        for p in self.patches:p.start()
        self.start=self.client.get('/city/current').json()
    def tearDown(self):
        for p in reversed(self.patches):p.stop()
        self.tmp.cleanup()
    def test_draft_survives_reload_without_changing_city_and_has_separate_conflict_guard(self):
        proposal={**self.start['document'],'name':'Draft'}
        body={'document':proposal,'base_revision':self.start['revision'],'base_draft_revision':None,'label':'Trial'}
        r=self.client.post('/city/draft',json=body)
        self.assertEqual(r.status_code,200,r.text)
        token=r.json()['revision']
        self.assertEqual(self.client.get('/city/current').json()['revision'],self.start['revision'])
        pending=self.client.get('/city/draft').json()['draft']
        self.assertEqual(pending['document']['name'],'Draft')
        self.assertEqual(pending['revision'],token)
        self.assertEqual(self.client.post('/city/draft',json=body).status_code,409)
        self.assertEqual(self.client.post('/city/draft/discard',json={'revision':'0'*64}).status_code,409)
        self.assertEqual(self.client.post('/city/draft/discard',json={'revision':token}).status_code,200)
        self.assertIsNone(self.client.get('/city/draft').json()['draft'])
        self.assertEqual(self.client.get('/city/current').json()['revision'],self.start['revision'])
    def test_confirm_restore_and_retained_previous_version(self):
        proposal={**self.start['document'],'name':'Changed'}
        changed=self.client.post('/city/current',json={'base_revision':self.start['revision'],'document':proposal}).json()
        versions=self.client.get('/city/versions?limit=1').json()
        self.assertTrue(versions['has_more'])
        saved=self.client.get('/city/versions/'+self.start['revision'])
        self.assertEqual(saved.status_code,200)
        self.assertEqual(saved.json()['document']['name'],'Original')
        self.assertEqual(self.client.get('/city/current').json()['revision'],changed['revision'])
        restored=self.client.post('/city/current',json={'base_revision':changed['revision'],'document':saved.json()['document']})
        self.assertEqual(restored.status_code,200)
        self.assertEqual(self.client.get('/city/versions/'+changed['revision']).json()['document']['name'],'Changed')
        self.assertEqual(self.client.get('/city/versions/baseline').json()['document']['name'],'Original')
        self.assertEqual(self.client.get('/city/versions/not-a-hash').status_code,404)
    def test_stale_city_cannot_replace_draft(self):
        changed=self.client.post('/city/current',json={'base_revision':self.start['revision'],'document':{**self.start['document'],'name':'New'}})
        self.assertEqual(changed.status_code,200)
        r=self.client.post('/city/draft',json={'base_revision':self.start['revision'],'base_draft_revision':None,'label':'Old','document':self.start['document']})
        self.assertEqual(r.status_code,409)
        self.assertIsNone(self.client.get('/city/draft').json()['draft'])
    def test_block_is_readonly_uses_eight_shared_assets_and_has_distinct_positions(self):
        r=self.client.post('/city/block',json={'count':48,'longitude':-2.603,'latitude':51.454})
        self.assertEqual(r.status_code,200,r.text)
        block=r.json()
        self.assertEqual(len(block['instances']),48)
        self.assertEqual(len(block['assets']),8)
        self.assertEqual(len({(i['longitude'],i['latitude']) for i in block['instances']}),48)
        CityDocument.model_validate({**self.original.model_dump(),'assets':block['assets'],'instances':block['instances']})
        self.assertEqual(self.client.get('/city/current').json()['revision'],self.start['revision'])
    def test_four_new_styles_are_closed_colored_editable_and_distinct(self):
        counts=[]
        for kind in ('tudor','warehouse','chapel','civic'):
            doc=generate_building(BuildingParameters(kind=kind,floors=3,units=1))
            self.assertEqual(BuildingDocument.model_validate_json(document_bytes(doc)),doc)
            self.assertIn('非实测',doc.nodes[0].attributes['数据来源'])
            colors={n.category:doc.templates[n.template].color for n in doc.nodes if n.template}
            self.assertEqual(len(set(colors.values())),len(colors))
            self.assertGreater(len(doc.nodes),200)
            counts.append(len(doc.nodes))
        self.assertEqual(len(set(counts)),4)
    def test_new_style_boundary_settings_are_renderable_and_oversize_inputs_rejected(self):
        for kind,floors,units in [('tudor',12,4),('warehouse',8,2),('warehouse',4,4),('chapel',12,4),('civic',12,3)]:
            generate_building(BuildingParameters(kind=kind,floors=floors,units=units,scale=2))
        for values in [dict(kind='warehouse',floors=9,units=1),dict(kind='warehouse',floors=8,units=4),dict(kind='civic',floors=4,units=4)]:
            self.assertEqual(self.client.post('/studio/generate',json=values).status_code,422)
