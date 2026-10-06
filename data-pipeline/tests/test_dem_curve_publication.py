import csv
import hashlib
import io
import json
from pathlib import Path
import unittest
import zipfile
ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'frontend/public/research/dem-curved-grid-v1'
def sha(b):return hashlib.sha256(b).hexdigest()

class DemCurvePublicationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.summary=json.loads((ROOT/'shared/dem-curved-grid-control-v1.json').read_bytes())
        cls.raw=(BASE/'results.json').read_bytes();cls.full=json.loads(cls.raw)
    def test_complete_fixed_pool_and_adverse_results_are_retained(self):
        self.assertEqual(len(self.full['cases']),20);self.assertEqual(len({c['city_id'] for c in self.full['cases']}),10)
        pairs=[]
        for c in self.full['cases']:
            self.assertEqual(len(c['candidates']),98)
            self.assertEqual([p['target_m'] for p in c['pairs']],[.1,.25,.5])
            for p in c['pairs']:
                pool=[e for e in c['candidates'] if e['bytes']<=p['baseline']['bytes']]
                best=min(pool,key=lambda e:(e['e2_m2'],e['bytes'],e['id'])) if pool else None
                self.assertEqual(p['best_e2_at_file_ceiling'],best['id'] if best else None)
                self.assertFalse(any(e['continuous_bound_m']<=p['baseline']['continuous_bound_m']+1e-10 for e in pool))
                if best:self.assertGreater(best['e2_m2'],p['baseline']['e2_m2'])
                pairs.append(p)
        self.assertEqual(sum(p['best_e2_at_file_ceiling'] is not None for p in pairs),56)
        self.assertEqual(sum(p['best_e2_with_maximum_gate'] is not None for p in pairs),0)
    def test_summary_csv_and_source_receipts_match_complete_report(self):
        r=self.summary;self.assertEqual(sha(self.raw),r['report_sha256'])
        self.assertEqual((ROOT/'shared/dem-curved-grid-control-v1.json').read_bytes(),(BASE/'publication.json').read_bytes())
        for group,h in r['parents'].items():self.assertEqual(sha((ROOT/f'shared/{group}-terrain-benchmark.json').read_bytes()),h)
        for small,full in zip(r['cases'],self.full['cases']):
            self.assertEqual(small['id'],full['id'])
            for p,q in zip(small['pairs'],full['pairs']):
                self.assertEqual({k:v for k,v in p.items() if k!='selected'},q)
                self.assertEqual(p['selected'],next((e for e in full['candidates'] if e['id']==q['best_e2_at_file_ceiling']),None))
        csv_raw=(BASE/'pairs.csv').read_bytes();self.assertEqual(sha(csv_raw),r['pairs_csv_sha256'])
        rows=list(csv.DictReader(io.StringIO(csv_raw.decode())));self.assertEqual(len(rows),60)
        self.assertEqual(sum(row['ruled_bytes']=='' for row in rows),4)
        self.assertTrue(all(float(row['e2_reduction_percent'])<0 for row in rows if row['ruled_bytes']))
    def test_native_checks_include_all_selected_models_and_stationary_witnesses(self):
        raw=(BASE/'native-audit.json').read_bytes();self.assertEqual(sha(raw),self.summary['native_audit_sha256']);audit=json.loads(raw)
        expected=set()
        for c in self.full['cases']:
            ref=(BASE/c['id']/'reference.json').read_bytes();self.assertEqual(sha(ref),c['reference_sha256'])
            for p in c['pairs']:
                expected.add((c['id'],p['baseline']['filename']))
                if p['best_e2_at_file_ceiling']:expected.add((c['id'],p['best_e2_at_file_ceiling']+'.json'))
        self.assertEqual({(r['case_id'],r['filename']) for r in audit['rows']},expected)
        for row in audit['rows']:
            b=(BASE/row['case_id']/row['filename']).read_bytes();self.assertEqual(len(b),row['bytes']);self.assertEqual(sha(b),row['sha256'])
            self.assertEqual((row['hits'],row['requested']),(512,512))
            if row['kind']=='P2xP1':self.assertTrue(row['maximum_witness_checked'])
        for p,k in [('frontend/scripts/audit-dem-curved-grid.mjs','auditor_sha256'),('frontend/src/compare/curvedRuledMath.ts','kernel_sha256')]:
            self.assertEqual(sha((ROOT/p).read_bytes().replace(b'\r\n',b'\n')),audit[k])
    def test_archive_pins_and_figure_are_byte_identical(self):
        r=self.summary;b=(BASE/r['package']['filename']).read_bytes();self.assertEqual(len(b),r['package']['bytes']);self.assertEqual(sha(b),r['package']['sha256'])
        for p,k in [('data-pipeline/dem_curved_grid_benchmark.py','source_sha256'),('data-pipeline/publish_dem_curved_grid.py','publisher_sha256')]:
            self.assertEqual(sha((ROOT/p).read_bytes().replace(b'\r\n',b'\n')),r[k])
        with zipfile.ZipFile(io.BytesIO(b)) as z:
            for name in z.namelist():
                path=BASE/Path(name).relative_to('dem-curved-grid-v1')
                self.assertEqual(z.read(name),path.read_bytes())
            for p in ['dem_curved_grid_benchmark.py','publish_dem_curved_grid.py','raster_l2_audit.py','plot_dem_curve_control.py']:
                self.assertEqual(z.read('dem-curved-grid-v1/implementations/'+p),(ROOT/'data-pipeline'/p).read_bytes().replace(b'\r\n',b'\n'))
        for p,h in r['figures'].items():self.assertEqual(sha((BASE/p).read_bytes()),h)

if __name__=='__main__':unittest.main()
