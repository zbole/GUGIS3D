import hashlib
import json
from pathlib import Path
import unittest
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[2]


class PublishedHybridDataTests(unittest.TestCase):
    def test_local_baseline_downloads_and_code_revisions_match_their_receipts(self):
        report=json.loads((ROOT/'shared/local-triangle-benchmark.json').read_bytes())
        public=ROOT/'frontend/public/research/hybrid-terrain'
        for key,file in [('builder_source_sha256','backend/app/services/terrain_triangles.py'),
                         ('native_query_source_sha256','frontend/src/studio/terrainMath.ts'),
                         ('analytic_source_sha256','data-pipeline/build_hybrid_research.py')]:
            content=(ROOT/file).read_bytes().replace(b'\r\n',b'\n')
            self.assertEqual(report[key],hashlib.sha256(content).hexdigest())
        self.assertEqual(report['parent_sha256'],hashlib.sha256((ROOT/'shared/hybrid-terrain-research.json').read_bytes()).hexdigest())
        for case in report['cases']:
            package=public/f'{case["id"]}-local-triangles.zip'
            content=package.read_bytes()
            self.assertEqual(len(content),case['download_bytes'])
            self.assertEqual(hashlib.sha256(content).hexdigest(),case['download_sha256'])
            with ZipFile(package) as archive:
                fixture=archive.read('query-fixture.json')
                full=json.loads(archive.read('results.json'))
                self.assertIn('history',full['variants'][0]['local_triangles'])
                for pair in case['variants']:
                    for mode in ('hybrid','local_triangles'):
                        model=pair[mode];content=archive.read(model['filename'])
                        self.assertEqual(content,(public/'models'/case['id']/model['filename']).read_bytes())
                        self.assertEqual(hashlib.sha256(content).hexdigest(),model['sha256'])
                        self.assertEqual(hashlib.sha256(fixture).hexdigest(),model['offgrid']['fixture_sha256'])

    def test_builder_and_website_kernel_match_the_published_revisions(self):
        report = json.loads((ROOT/'shared/hybrid-terrain-research.json').read_text())
        for key, file in [
            ('builder_source_sha256', 'backend/app/services/terrain_hybrid.py'),
            ('native_query_source_sha256', 'frontend/src/studio/terrainMath.ts'),
        ]:
            content = (ROOT/file).read_bytes().replace(b'\r\n', b'\n')
            self.assertEqual(report[key], hashlib.sha256(content).hexdigest())

    def test_downloads_contain_exact_displayed_models_and_full_research_evidence(self):
        report = json.loads((ROOT/'shared/hybrid-terrain-research.json').read_text())
        public = ROOT/'frontend/public/research/hybrid-terrain'
        for case in report['cases']:
            content = (public/f'{case["id"]}.zip').read_bytes()
            self.assertEqual(len(content), case['download_bytes'])
            self.assertEqual(hashlib.sha256(content).hexdigest(), case['download_sha256'])
            with ZipFile(public/f'{case["id"]}.zip') as archive:
                fixture = json.loads(archive.read('query-fixture.json'))
                self.assertEqual(len(fixture['xy']), 4096)
                self.assertEqual(len(fixture['reference']), 4096)
                self.assertEqual(fixture['seed'], 20261007)
                self.assertIn('reference.npz', archive.namelist())
                full = json.loads(archive.read('results.json'))
                self.assertIn('variants', full)
                for pair in case['variants']:
                    for mode in ('hybrid', 'triangles'):
                        model = pair[mode]
                        packed = archive.read(model['filename'])
                        self.assertEqual(packed, (public/'models'/case['id']/model['filename']).read_bytes())
                        self.assertEqual(hashlib.sha256(packed).hexdigest(), model['sha256'])
                        self.assertEqual(hashlib.sha256(archive.read('query-fixture.json')).hexdigest(), model['offgrid']['fixture_sha256'])


if __name__ == '__main__':
    unittest.main()
