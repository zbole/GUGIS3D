import hashlib,json,sys,unittest,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'data-pipeline'))
import hybrid_source_benchmark as producer
class HybridSourcePublicationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder=ROOT/'frontend/public/research/hybrid-source-v1';cls.report=json.loads((cls.folder/'results.json').read_bytes());cls.summary=json.loads((ROOT/'shared/hybrid-source-display-v1.json').read_bytes());cls.protocol=json.loads((cls.folder/'protocol.json').read_bytes())
    def test_all_grids_methods_budgets_targets_and_every_negative_outcome_remain(self):
        r=self.report;self.assertEqual(len(r['cases']),20);self.assertEqual(sum(len(c['candidates']) for c in r['cases']),2940);self.assertEqual(sum(len(c['byte_pairs']) for c in r['cases']),200);self.assertEqual(sum(len(c['target_pairs']) for c in r['cases']),120)
        pairs=[p for c in r['cases'] for p in c['byte_pairs']];self.assertEqual(sum(p['hybrid']['e2_m2']<p['p1']['e2_m2'] for p in pairs),179);self.assertEqual(sum(p['hybrid']['e2_m2']<p['ruled']['e2_m2'] for p in pairs),159)
        for c in r['cases']:
            bp,tp=producer.choices(c['candidates'],self.protocol);self.assertEqual(bp,c['byte_pairs']);self.assertEqual(tp,c['target_pairs']);self.assertTrue(any(e['method']=='hybrid' and e['ruled_cells'] and e['p1_triangles'] for e in c['candidates']))
            p=next(p for p in bp if p['byte_ceiling']==8192);self.assertLess(p['hybrid']['e2_m2'],p['p1']['e2_m2'])
            for row in bp:
                for family in ['ruled','p1','hybrid']:self.assertLessEqual(row[family]['binary_bytes'],row['byte_ceiling'])
            for row in tp:
                for family in ['ruled','p1','hybrid']:
                    if row[family]:self.assertLessEqual(row[family]['continuous_bound_m'],row['height_target_m'])
        self.assertTrue(any(p['p1'] is None for c in r['cases'] for p in c['target_pairs']))
    def test_every_native_and_independent_metric_audit_matches_complete_candidate_coverage(self):
        native=json.loads((self.folder/'native-audit.json').read_bytes());integrals=json.loads((self.folder/'integral-audit.json').read_bytes());expected={(c['id'],e['filename']) for c in self.report['cases'] for e in c['candidates']};self.assertEqual({(r['case_id'],r['filename']) for r in native['models']},expected);self.assertEqual({(r['case_id'],r['filename']) for r in integrals['rows']},expected);self.assertEqual(native['total_queries'],15432060);self.assertEqual(native['seam_height_pairs'],12801600);self.assertEqual(integrals['quadrature_nodes'],5)
        for r in integrals['rows']:self.assertEqual(r['integrated_area_m2'],4096);self.assertLess(r['producer_e2_difference_m2'],1e-8*max(1,r['e2_m2']));self.assertLess(r['producer_maximum_difference_m'],1e-8*max(1,r['continuous_maximum_m']))
    def test_all_native_inputs_code_pins_and_zip_members_bind_actual_original_bytes(self):
        s=self.summary
        for file,key in [('results.json','report_sha256'),('native-audit.json','native_audit_sha256'),('integral-audit.json','integral_audit_sha256'),('selections.csv','selections_csv_sha256'),('hybrid-source-results.svg','figure_sha256')]:self.assertEqual(hashlib.sha256((self.folder/file).read_bytes()).hexdigest(),s[key])
        for p,h in s['scripts'].items():self.assertEqual(hashlib.sha256((ROOT/p).read_bytes().replace(b'\r\n',b'\n')).hexdigest(),h)
        for c in self.report['cases']:
            original=ROOT/'frontend/public/research/source-native-bands-v1'/c['id'];self.assertEqual((self.folder/c['id']/'reference.json').read_bytes(),(original/'reference.json').read_bytes());self.assertEqual((self.folder/c['id']/'source-window.tif').read_bytes(),(original/'source-window.tif').read_bytes())
            for e in c['candidates']:
                for file,h,n in [('filename','sha256','bytes'),('binary_filename','binary_sha256','binary_bytes')]:
                    b=(self.folder/c['id']/e[file]).read_bytes();self.assertEqual(len(b),e[n]);self.assertEqual(hashlib.sha256(b).hexdigest(),e[h])
        b=(self.folder/s['package']['filename']).read_bytes();self.assertEqual(len(b),s['package']['bytes']);self.assertEqual(hashlib.sha256(b).hexdigest(),s['package']['sha256'])
        with zipfile.ZipFile(self.folder/s['package']['filename']) as z:
            expected={p.relative_to(self.folder).as_posix() for p in self.folder.rglob('*') if p.is_file() and p.name not in [s['package']['filename'],'publication.json']};self.assertEqual(set(z.namelist()),{'hybrid-source-v1/'+p for p in expected})
            for p in expected:self.assertEqual(z.read('hybrid-source-v1/'+p),(self.folder/p).read_bytes())
if __name__=='__main__':unittest.main()
