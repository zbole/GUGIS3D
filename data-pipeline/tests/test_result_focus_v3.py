import json,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import build_result_focus_v3 as b
class AdaptiveFocus(unittest.TestCase):
    def test_latest_focus_is_bound_to_complete_adaptive_measurements(self):
        raw=b.body();self.assertEqual(raw,b.OUTPUT.read_bytes());self.assertLess(len(raw),20000);r=json.loads(raw);p=r['stories'][0]
        self.assertEqual(len(p['metrics']),6);self.assertAlmostEqual(p['value'],46.02724708067545,places=9);self.assertEqual(p['detail_href'],'#paper-adaptive-results');self.assertIn('62/63',p['coverage']);self.assertIn('10/63',p['controls']);self.assertIn('公式 (2.18)',p['baseline']);self.assertLess(p['metrics'][-1]['value'],p['metrics'][-2]['value']);self.assertEqual(len(r['stories'][1]['points']),20)
if __name__=='__main__':unittest.main()
