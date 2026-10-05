import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'data-pipeline'))
from publish_native_query_performance import verify, DEST, SUMMARY, stats
from piecewise_ruled_control import models, source, COUNTS
from terrain_order_control import binary_bytes, polynomial_metrics, digest
from publish_terrain_order_control import curve_integral
import numpy as np

class NativeQueryPublicationTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.folder=Path(self.tmp.name);self.pieces=self.folder/'pieces';self.pieces.mkdir()
        shutil.copyfile(DEST/'piecewise-controls.json',self.pieces/'results.json')
        for n in COUNTS:shutil.copytree(DEST/f'piecewise-{n}',self.pieces/f'piecewise-{n}')
    def tearDown(self):self.tmp.cleanup()
    def test_all_fixed_models_and_raw_trials_reproduce_publication(self):
        r,p,raw,pr=verify(DEST,self.pieces);summary=json.loads(SUMMARY.read_bytes())
        self.assertEqual(summary['report_sha256'],digest(raw));self.assertEqual(summary['piecewise_report_sha256'],digest(pr))
        self.assertEqual(len(r['cases']),5);self.assertEqual(sum(len(c['rows']) for c in r['cases']),220)
        for c,v in zip(r['cases'],summary['cases']):
            self.assertEqual({k:a for k,a in c.items() if k!='rows'},{k:a for k,a in v.items() if k!='binary_saving_percent'})
            self.assertAlmostEqual(v['binary_saving_percent'],100*(1-c['methods'][0]['binary_bytes']/c['methods'][1]['binary_bytes']))
        for name,h in summary['figures'].items():self.assertEqual(digest((DEST/name).read_bytes()),h)
        self.assertEqual(digest((DEST/summary['package']['filename']).read_bytes()),summary['package']['sha256'])
    def test_strip_boundaries_are_c0_and_full_p3_uses_shared_nodes(self):
        for n in COUNTS:
            a,b=models(n);self.assertEqual(len(a['points']),4*n+2);self.assertEqual(len(b['points']),12*n+4)
            self.assertEqual(len(binary_bytes(a)),16+24*(4*n+2)+36*n)
            self.assertEqual(len(binary_bytes(b)),16+24*(12*n+4)+104*n)
            for j in range(n-1):
                left=a['patches'][j];right=a['patches'][j+1]
                self.assertEqual(left['left'][2],right['left'][0]);self.assertEqual(left['right'][2],right['right'][0])
            for j in range(1,n):
                x=-50+j*100/n
                for y in (-50.,0.,50.):self.assertAlmostEqual(float(source(n,np.array([x,y]))),30+.001*x+.002*y,places=12)
            fn=lambda xy:source(n,xy)
            self.assertLess(curve_integral(a,fn)['e2_m2'],1e-8);self.assertLess(polynomial_metrics(b,fn,nodes=11)['e2_m2'],1e-8)
    def test_changed_distribution_missing_trial_and_selected_scale_are_rejected(self):
        run=self.folder/'run';run.mkdir()
        for name in ('results.json','trials.csv','query-fixture.json'):shutil.copyfile(DEST/name,run/name)
        original=json.loads((run/'results.json').read_bytes())
        for kind in ('median','missing','selected'):
            r=json.loads(json.dumps(original))
            if kind=='median':r['cases'][0]['methods'][0]['prepared_ns_per_query']['median']*=.1
            elif kind=='missing':r['cases'][0]['rows'].pop()
            else:r['cases'].pop()
            (run/'results.json').write_text(json.dumps(r),encoding='utf8')
            with self.assertRaises(ValueError):verify(run,self.pieces)
    def test_quantiles_are_observed_order_statistics(self):
        self.assertEqual(stats(list(range(17))),{'median':8,'p10':1,'p90':14,'minimum':0,'maximum':16})

if __name__=='__main__':unittest.main()
