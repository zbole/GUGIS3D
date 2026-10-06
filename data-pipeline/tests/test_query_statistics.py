import sys,unittest
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'data-pipeline'))
import query_statistics as q
class QueryStatisticsTests(unittest.TestCase):
    def test_exact_sign_test_handles_ties_all_wins_symmetry_and_small_known_probabilities(self):
        self.assertEqual(q.sign_p(0,0),1);self.assertEqual(q.sign_p(2,2),1);self.assertEqual(q.sign_p(17,0),2/2**17);self.assertEqual(q.sign_p(3,0),.25);self.assertEqual(q.sign_p(14,3),q.sign_p(3,14))
    def test_holm_stepdown_is_monotone_and_preserves_original_fixture_order(self):
        p=[.04,.001,.2,.03,.01];actual=q.holm(p);self.assertEqual(actual,[.09,.005,.2,.09,.04]);self.assertEqual(q.holm([.001]*5),[.005]*5)
    def test_paired_order_stratified_bootstrap_is_reproducible_and_preserves_a_constant_ratio(self):
        r=np.arange(1,18.);first=np.arange(17)%2==0;a,d=q.bootstrap(r,2*r,first,1000,42);b,e=q.bootstrap(r,2*r,first,1000,42);self.assertEqual(a,b);np.testing.assert_array_equal(d,e);self.assertEqual(a['low'],2);self.assertEqual(a['high'],2);self.assertTrue(np.all(d==2))
if __name__=='__main__':unittest.main()
