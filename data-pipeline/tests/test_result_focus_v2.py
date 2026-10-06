import json,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import build_result_focus_v2 as b
class StrongerResultFocus(unittest.TestCase):
    def test_exact_sources_and_all_twenty_sites_are_retained(self):
        raw=b.body();self.assertEqual(raw,b.OUTPUT.read_bytes());self.assertLess(len(raw),20000)
        r=json.loads(raw);self.assertEqual(len(r['stories']),3);self.assertEqual(len(r['secondary']),2)
        points=r['stories'][1]['points'];self.assertEqual(len(points),20)
        self.assertTrue(all(p['reduction_percent']>0 for p in points));self.assertAlmostEqual(min(p['reduction_percent'] for p in points),.00356898721241,places=7)
        self.assertIn('156/200',r['stories'][1]['coverage'])
    def test_stronger_PT_and_P2_controls_failure_case_and_unchanged_cost_are_visible(self):
        r=b.derive();p=r['stories'][0];self.assertEqual(len(p['metrics']),5)
        self.assertAlmostEqual(p['value'],46.59752201168,places=4)
        self.assertLess(p['metrics'][4]['value'],p['metrics'][3]['value'])
        self.assertIn('62/63',p['coverage']);self.assertIn('45,000 B 不变',p['coverage']);self.assertIn('10/63',p['controls']);self.assertIn('30°/N=64',p['controls'])
        self.assertIn('并非完整',p['baseline'])
if __name__=='__main__':unittest.main()
