import json,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import build_result_focus as b
class ResultFocus(unittest.TestCase):
    def test_visible_summary_matches_every_fixed_source(self):
        self.assertEqual(b.body(),b.OUTPUT.read_bytes());r=json.loads(b.body());self.assertEqual(len(r['stories']),3);self.assertEqual(len(r['secondary']),2);self.assertEqual(len(r['stories'][1]['points']),20);self.assertEqual(len(r['stories'][2]['points']),5)
    def test_better_high_order_control_and_nonwinning_cases_are_kept(self):
        r=b.derive();paper=r['stories'][0];self.assertLess(paper['metrics'][2]['value'],paper['metrics'][1]['value']);self.assertIn('31/63',paper['controls']);self.assertIn('179/200',r['stories'][1]['coverage'])
if __name__=='__main__':unittest.main()
