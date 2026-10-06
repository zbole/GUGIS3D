import hashlib,json,sys,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'data-pipeline'))
import build_advantage_summary as builder
class AdvantageSummaryTests(unittest.TestCase):
    def test_visible_manifest_is_rederived_from_verified_reports_and_actual_packages(self):
        self.assertEqual(builder.DEST.read_bytes(),builder.body());summary=json.loads(builder.DEST.read_bytes());self.assertEqual(len(summary['claims']),4)
        for e in summary['inputs']:self.assertEqual(hashlib.sha256((ROOT/e['path']).read_bytes()).hexdigest(),e['sha256'])
        for c in summary['claims']:
            b=(ROOT/'frontend/public'/c['package_url'].lstrip('/')).read_bytes();self.assertEqual(len(b),c['package_bytes']);self.assertEqual(hashlib.sha256(b).hexdigest(),c['package_sha256'])
    def test_error_file_and_cpu_claims_use_different_correct_units_and_denominators(self):
        claims=builder.derive()['claims']
        for c in claims:
            expected=c['baseline_metric']/c['gugis_metric'] if c['kind']=='cpu-ratio' else 100*(1-c['gugis_metric']/c['baseline_metric']);self.assertAlmostEqual(c['value'],expected,places=12)
        self.assertEqual([f"{c['value']:.{2 if c['kind'] in ['error-percent','cpu-ratio'] else 1}f}" for c in claims],['99.88','80.5','32.6','1.37']);self.assertIn('P1',claims[0]['baseline']);self.assertIn('未运行 ArcGIS',claims[2]['scope']);self.assertIn('中位数之比',claims[3]['scope']);self.assertIn('GeoTIFF 更小',claims[1]['scope'])
if __name__=='__main__':unittest.main()
