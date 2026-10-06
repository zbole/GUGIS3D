import csv
import hashlib
import io
import json
from pathlib import Path
import unittest
import zipfile
ROOT=Path(__file__).resolve().parents[2];BASE=ROOT/'frontend/public/research/principal-ruled-v1'
def sha(b):return hashlib.sha256(b).hexdigest()
class PrincipalPublicationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.r=json.loads((ROOT/'shared/principal-ruled-display-v1.json').read_bytes());cls.raw=(BASE/'results.json').read_bytes();cls.full=json.loads(cls.raw)
    def test_all_fixed_angles_budgets_candidates_and_p2_controls_are_retained(self):
        r=self.r;self.assertEqual([c['angle_degrees'] for c in r['cases']],[0,15,30,45,60,75,90]);self.assertEqual(len(r['cases']),7)
        for c,full in zip(r['cases'],self.full['cases']):
            self.assertEqual(c,{k:v for k,v in full.items() if k!='candidates'});self.assertEqual(len(full['candidates']),36)
            self.assertEqual([p['budget'] for p in c['pairs']],[8,16,32,64,128,256,512,1024,2048])
            p2=c['p2_control'];self.assertEqual((p2['controls'],p2['patches'],p2['binary_bytes']),(9,2,336));self.assertLess(p2['e2_m2'],1e-8)
            for p in c['pairs']:
                b=p['principal'];self.assertLess(b['e2_m2'],p['p1']['e2_m2']);self.assertLessEqual(b['patches'],p['budget']);self.assertLessEqual(b['binary_bytes'],p['p1']['binary_bytes'])
                self.assertGreater(b['e2_m2'],p2['e2_m2'])
            if c['angle_degrees'] in (0,90):
                for p in c['pairs']:self.assertAlmostEqual(p['world']['e2_m2'],p['principal']['e2_m2'],places=8)
    def test_shared_receipt_parent_and_complete_csv_bind_every_result(self):
        r=self.r;self.assertEqual(sha(self.raw),r['report_sha256']);self.assertEqual((BASE/'publication.json').read_bytes(),(ROOT/'shared/principal-ruled-display-v1.json').read_bytes())
        parent_raw=(BASE/'parent-results.json').read_bytes();self.assertEqual(sha(parent_raw),r['parent_report_sha256']);parent=json.loads(parent_raw)
        for c,p in zip(r['cases'],parent['cases']):self.assertEqual({k:v for k,v in c.items() if k!='p2_control'},{k:v for k,v in p.items() if k!='candidates'})
        body=(BASE/'pairs.csv').read_bytes();self.assertEqual(sha(body),r['pairs_csv_sha256']);rows=list(csv.DictReader(io.StringIO(body.decode())));self.assertEqual(len(rows),63)
        self.assertTrue(all(float(row['principal_e2_reduction_percent'])>0 for row in rows));self.assertTrue(any(float(row['principal_binary_saving_percent'])==0 for row in rows))
        self.assertTrue(all(int(row['p2_control_binary_bytes'])==336 and float(row['p2_control_e2_m2'])<1e-8 for row in rows))
    def test_native_audit_is_complete_and_includes_all_clipping_and_gradient_checks(self):
        body=(BASE/'native-audit.json').read_bytes();r=self.r;self.assertEqual(sha(body),r['native_audit_sha256']);audit=json.loads(body);expected=set()
        for c in r['cases']:
            expected.add((c['id'],c['p2_control']['filename']))
            for p in c['pairs']:
                for e in (p['p1'],p['world'],p['principal']):expected.add((c['id'],e['filename']))
        self.assertEqual(len(expected),174);self.assertEqual({(v['case_id'],v['filename']) for v in audit['rows']},expected)
        for row in audit['rows']:
            self.assertEqual((row['requested'],row['hits'],row['clip_corners_checked']),(4096,4096,4));self.assertTrue(row['outside_clip_rejected'])
            self.assertLess(row['independent_height_difference_m'],1e-8);self.assertLess(row['independent_gradient_difference'],1e-9)
            for prefix in ('','binary_'):
                b=(BASE/row['case_id']/row[prefix+'filename']).read_bytes();self.assertEqual(len(b),row[prefix+'bytes']);self.assertEqual(sha(b),row[prefix+'sha256'])
        self.assertEqual(sum(v['requested'] for v in audit['rows']),712704)
    def test_all_sources_figures_and_zip_members_remain_byte_identical(self):
        r=self.r
        for p,h in r['scripts'].items():self.assertEqual(sha((ROOT/p).read_bytes().replace(b'\r\n',b'\n')),h)
        for p,h in r['figures'].items():self.assertEqual(sha((BASE/p).read_bytes()),h)
        b=(BASE/r['package']['filename']).read_bytes();self.assertEqual(len(b),r['package']['bytes']);self.assertEqual(sha(b),r['package']['sha256'])
        with zipfile.ZipFile(io.BytesIO(b)) as z:
            for name in z.namelist():self.assertEqual(z.read(name),(BASE/Path(name).relative_to('principal-ruled-v1')).read_bytes())
            for p,h in r['scripts'].items():self.assertEqual(sha(z.read('principal-ruled-v1/implementations/'+Path(p).name)),h)

if __name__=='__main__':unittest.main()
