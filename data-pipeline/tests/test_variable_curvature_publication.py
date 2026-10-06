import hashlib,json,sys,unittest,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'data-pipeline'))
import publish_variable_curvature as release
class VariableCurvaturePublicationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder=ROOT/'frontend/public/research/variable-curvature-v1';cls.summary=json.loads((ROOT/'shared/variable-curvature-display-v1.json').read_bytes());cls.report=json.loads((cls.folder/'results.json').read_bytes())
    def test_all_fixed_cases_and_failed_direction_outcomes_remain(self):
        report=self.report;protocol=json.loads((self.folder/'protocol.json').read_bytes());self.assertEqual([(c['field'],c['angle_degrees']) for c in report['cases']],[(f,a) for f in protocol['fields'] for a in protocol['angles_degrees']]);self.assertEqual(sum(len(c['pairs']) for c in report['cases']),126);self.assertEqual(sum(len(c['candidates']) for c in report['cases']),2520)
        counts={}
        for field in protocol['fields']:
            pairs=[p for c in report['cases'] if c['field']['id']==field['id'] for p in c['pairs']];counts[field['id']]=sum(p['mean_hessian']['e2_m2']<p['p1']['e2_m2'] for p in pairs)
            for p in pairs:
                for name in ['world','mean_hessian','p2']:
                    self.assertLessEqual(p[name]['patches'],p['budget']);self.assertLessEqual(p[name]['binary_bytes'],p['p1']['binary_bytes'])
        self.assertEqual(counts,{'published-quartic':31,'anisotropic-quartic':63})
        self.assertTrue(any(p['p2']['e2_m2']<p['mean_hessian']['e2_m2'] for c in report['cases'] for p in c['pairs']))
    def test_native_and_independent_integral_audits_cover_every_feasible_model(self):
        models={(c['id'],e['filename']):e for c in self.report['cases'] for e in [*c['p1_baselines'],*c['p2_hierarchy'],*(e for e in c['candidates'] if e['evaluated'])]};native=json.loads((self.folder/'native-audit.json').read_bytes());integrals=json.loads((self.folder/'integral-audit.json').read_bytes())
        self.assertEqual(len(models),2071);self.assertEqual(native['total_internal_queries'],2120704);self.assertEqual({(e['case_id'],e['filename']) for e in native['models']},set(models));self.assertEqual({(e['case_id'],e['filename']) for e in integrals['rows']},set(models));self.assertEqual(integrals['quadrature_nodes'],7)
        for e in integrals['rows']:
            source=models[e['case_id'],e['filename']];self.assertLess(abs(e['area_m2']-10000),1e-7);self.assertLess(e['producer_difference_m2'],1e-9*max(1,e['e2_m2']));self.assertEqual(e['native_primitives'],source.get('native_triangles',source['patches']))
        for e in native['models']:self.assertLess(e['max_independent_height_difference_m'],1e-8);self.assertLess(e['max_independent_gradient_difference'],1e-8)
    def test_all_receipts_source_pins_and_archive_members_bind_actual_bytes(self):
        summary=self.summary
        for file,key in [('results.json','report_sha256'),('native-audit.json','native_audit_sha256'),('integral-audit.json','integral_audit_sha256'),('pairs.csv','pairs_csv_sha256'),('variable-curvature-results.svg','figure_sha256')]:self.assertEqual(hashlib.sha256((self.folder/file).read_bytes()).hexdigest(),summary[key])
        for path,digest in summary['scripts'].items():
            b=(ROOT/path).read_bytes().replace(b'\r\n',b'\n');self.assertEqual(hashlib.sha256(b).hexdigest(),digest);self.assertEqual((self.folder/'implementations'/Path(path).name).read_bytes(),b)
        for case in self.report['cases']:
            for e in [*case['p1_baselines'],*case['p2_hierarchy'],*(e for e in case['candidates'] if e['evaluated'])]:
                for name,digest,size in [('filename','sha256','bytes'),('binary_filename','binary_sha256','binary_bytes')]:
                    b=(self.folder/case['id']/e[name]).read_bytes();self.assertEqual(len(b),e[size]);self.assertEqual(hashlib.sha256(b).hexdigest(),e[digest])
        package=summary['package'];b=(self.folder/package['filename']).read_bytes();self.assertEqual(len(b),package['bytes']);self.assertEqual(hashlib.sha256(b).hexdigest(),package['sha256'])
        with zipfile.ZipFile(self.folder/package['filename']) as archive:
            expected={p.relative_to(self.folder).as_posix() for p in self.folder.rglob('*') if p.is_file() and p.name not in [package['filename'],'publication.json']};self.assertEqual(set(archive.namelist()),{'variable-curvature-v1/'+p for p in expected})
            for path in expected:self.assertEqual(archive.read('variable-curvature-v1/'+path),(self.folder/path).read_bytes())
    def test_independent_bernstein_integral_detects_saved_height_perturbation(self):
        case=next(c for c in self.report['cases'] if c['id']=='anisotropic-quartic-30');e=case['pairs'][0]['mean_hessian'];model=json.loads((self.folder/case['id']/e['filename']).read_bytes());frame=release.producer.field_frame(30);original=release.integral(model,case['field'],frame)[0]
        for p in model['points']:p[2]+=3
        changed=release.integral(model,case['field'],frame)[0];self.assertGreater(abs(changed-original),1);self.assertAlmostEqual(original,e['e2_m2'],places=8)
if __name__=='__main__':unittest.main()
