import hashlib,json,sys,unittest,zipfile
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'data-pipeline'))
import query_statistics as math
class QueryStatisticsPublicationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.folder=ROOT/'frontend/public/research/query-statistics-v1';cls.summary=json.loads((ROOT/'shared/query-statistics-display-v1.json').read_bytes())
    def test_source_data_are_unchanged_and_all_five_conditional_outcomes_remain(self):
        r=self.summary;original=ROOT/'frontend/public/research/native-query-v1';self.assertEqual((self.folder/'source-trials.csv').read_bytes(),(original/'trials.csv').read_bytes());self.assertEqual((self.folder/'source-report.json').read_bytes(),(original/'results.json').read_bytes());self.assertEqual(len(r['cases']),5)
        for c in r['cases']:self.assertEqual(c['wins']+c['losses']+c['ties'],17);self.assertAlmostEqual(c['sign_two_sided_p'],math.sign_p(c['wins'],c['losses']));self.assertAlmostEqual(c['median_ratio'],c['triangles_median_ns']/c['ruled_median_ns']);self.assertTrue(c['bootstrap']['low']>1);self.assertTrue(c['significant_holm_005'])
        self.assertEqual([c['holm_adjusted_p'] for c in r['cases']],math.holm([c['sign_two_sided_p'] for c in r['cases']]));self.assertIn('Secondary',r['scope']);self.assertTrue(r['analysis_environment']['secondary_analysis'])
    def test_raw_bootstrap_receipts_and_independent_release_rechecks_match(self):
        r=self.summary
        for file,key in [('results.json','report_sha256'),('release-audit.json','release_audit_sha256'),('paired-trials.csv','paired_csv_sha256'),('query-statistics-results.svg','figure_sha256')]:self.assertEqual(hashlib.sha256((self.folder/file).read_bytes()).hexdigest(),r[key])
        for c in r['cases']:
            b=(self.folder/c['bootstrap_filename']).read_bytes();self.assertEqual(hashlib.sha256(b).hexdigest(),c['bootstrap']['distribution_sha256']);v=np.frombuffer(b,dtype='<f8');self.assertEqual(len(v),50000);self.assertEqual(float(np.quantile(v,.025)),c['bootstrap']['low']);self.assertEqual(float(np.quantile(v,.975)),c['bootstrap']['high'])
        audit=json.loads((self.folder/'release-audit.json').read_bytes());self.assertTrue(audit['source_timings_unchanged']);self.assertEqual(audit['source_records'],220);self.assertEqual(audit['prepared_pairs'],85)
    def test_complete_zip_includes_the_original_native_evidence_and_every_statistical_byte(self):
        r=self.summary;package=r['package'];b=(self.folder/package['filename']).read_bytes();self.assertEqual(hashlib.sha256(b).hexdigest(),package['sha256']);self.assertEqual(len(b),package['bytes'])
        for p,h in r['scripts'].items():self.assertEqual(hashlib.sha256((ROOT/p).read_bytes().replace(b'\r\n',b'\n')).hexdigest(),h)
        with zipfile.ZipFile(self.folder/package['filename']) as z:
            expected={p.relative_to(self.folder).as_posix() for p in self.folder.rglob('*') if p.is_file() and p.name not in [package['filename'],'publication.json']};self.assertEqual(set(z.namelist()),{'query-statistics-v1/'+p for p in expected})
            for p in expected:self.assertEqual(z.read('query-statistics-v1/'+p),(self.folder/p).read_bytes())
if __name__=='__main__':unittest.main()
