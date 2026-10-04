import hashlib,json,sys,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'data-pipeline'))
from build_terrain_tradeoff import frontier,build


class TerrainTradeoffTests(unittest.TestCase):
    def test_numeric_ties_are_not_false_precision_gains(self):
        records=[{'id':'a','bytes':100,'rmse_m':.01},{'id':'b','bytes':200,'rmse_m':.01-1e-12},
                 {'id':'c','bytes':100,'rmse_m':.01+1e-12},{'id':'d','bytes':300,'rmse_m':.001}]
        self.assertEqual(frontier(records,'rmse_m'),['a','c','d'])

    def test_saved_report_is_reproducible_and_every_frontier_has_no_dominator(self):
        report=json.loads((ROOT/'shared/terrain-error-cost.json').read_bytes())
        self.assertEqual(report,build())
        self.assertEqual(sum(len(c['records']) for c in report['cases']),88)
        eps=report['error_tie_tolerance_m']
        for case in report['cases']:
            for metric in ['bound_m','rmse_m']:
                for record in case['records']:
                    dominators=[r for r in case['records'] if r['bytes']<=record['bytes'] and r[metric]<=record[metric]+eps and
                        (r['bytes']<record['bytes'] or r[metric]<record[metric]-eps)]
                    self.assertEqual(record['id'] in case['frontiers'][metric],not dominators)
        # A stricter maximum-error requirement selects a different model from RMSE.
        swiss=next(c for c in report['cases'] if c['id']=='swiss-dem-crop')
        best=lambda metric,budget:min([r for r in swiss['records'] if r[metric]<=budget],key=lambda r:r['bytes'])
        self.assertEqual(best('bound_m',.1)['id'],'local_triangles:0.1')
        self.assertEqual(best('rmse_m',.02)['id'],'compact_hybrid:0.1')
        self.assertGreater(best('rmse_m',.02)['bound_m'],.02)

    def test_exportable_scientific_figures_pin_the_actual_report(self):
        folder=ROOT/'frontend/public/research/hybrid-terrain/tradeoff'
        receipt=json.loads((folder/'figures.json').read_bytes())
        self.assertEqual(receipt['parent_sha256'],hashlib.sha256((ROOT/'shared/terrain-error-cost.json').read_bytes()).hexdigest())
        self.assertEqual(receipt['plotter_source_sha256'],hashlib.sha256((ROOT/'data-pipeline/plot_terrain_tradeoff.py').read_bytes().replace(b'\r\n',b'\n')).hexdigest())
        self.assertEqual(len(receipt['images']),28)
        for item in receipt['images']:
            raw=(folder/item['filename']).read_bytes()
            self.assertEqual(len(raw),item['bytes']);self.assertEqual(hashlib.sha256(raw).hexdigest(),item['sha256'])
            if item['filename'].endswith('.png'):
                self.assertEqual(int.from_bytes(raw[16:20],'big'),1500)
                self.assertEqual(int.from_bytes(raw[20:24],'big'),825)


if __name__=='__main__':unittest.main()
