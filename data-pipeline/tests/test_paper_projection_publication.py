import hashlib,json,sys,unittest,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'data-pipeline'))
import build_projection_ui_summary as ui
class FittingPublication(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base=ROOT/'frontend/public/research/paper-projection-stable-v1';cls.s=json.loads((ROOT/'shared/paper-projection-display-v1.json').read_bytes());cls.r=json.loads((cls.base/'results.json').read_bytes())
    def test_fixed_126_pairs_have_unchanged_ruled_topology_cost_stronger_operator_losses_and_p2_controls(self):
        r=self.r;self.assertEqual(len(r['cases']),14);self.assertEqual(sum(len(c['pairs']) for c in r['cases']),126)
        for field,wins in [('anisotropic-quartic',62),('published-quartic',10)]:
            rows=[p for c in r['cases'] if c['field']['id']==field for p in c['pairs']];self.assertEqual(len(rows),63);self.assertEqual(sum(p['c0-stable']['e2_m2']<p['pt']['e2_m2'] for p in rows),wins)
        for c in r['cases']:
            for p in c['pairs']:
                b=p['c0-stable'];old=p['prior']['mean_hessian'];self.assertEqual(b['binary_bytes'],old['binary_bytes']);self.assertLess(b['e2_m2'],old['e2_m2']);self.assertEqual(p['pt']['binary_sha256'],p['prototype']['pt']['binary_sha256']);self.assertTrue(b['solver']['accepted'])
                m=json.loads((self.base/c['id']/b['filename']).read_bytes());original=json.loads((ROOT/'frontend/public/research/variable-curvature-v1'/c['id']/old['filename']).read_bytes());self.assertEqual(m['patches'],original['patches']);self.assertEqual([v[:2] for v in m['points']],[v[:2] for v in original['points']]);self.assertLess(max(abs(v) for point in m['points'] for v in point),10000)
    def test_complete_new_native_independent_and_prototype_failure_audits_agree_without_erasing_failed_models(self):
        n=json.loads((self.base/'native-audit.json').read_bytes());a=json.loads((self.base/'integral-audit.json').read_bytes());self.assertEqual(n['native_models'],249);self.assertEqual(n['queries'],255972);self.assertEqual(n['seam_pairs'],135167);expected={(c['id'],p[k]['filename']) for c in self.r['cases'] for p in c['pairs'] for k in ['pt','c0-stable']};self.assertEqual({(e['case_id'],e['filename']) for e in a['models']},expected);self.assertEqual({(e['case_id'],e['filename']) for e in n['models']},expected)
        addon=json.loads((ROOT/'frontend/public/research/paper-projection-prototype-audit-v1/results.json').read_bytes());self.assertEqual(addon['rejected_models'],11);self.assertEqual(addon['source_error_worsened_pairs'],2);self.assertEqual(addon['rejected_pairs'],11)
        for e in addon['models']:
            if not e['native_valid']:
                m=json.loads((self.base/'prototype'/e['case_id']/e['filename']).read_bytes());self.assertGreater(max(abs(v) for p in m['points'] for v in p),10000)
    def test_exact_sources_reports_code_and_all_zip_members_are_preserved(self):
        sha=lambda b:hashlib.sha256(b).hexdigest();s=self.s
        for file,key in [('results.json','report_sha256'),('native-audit.json','native_audit_sha256'),('integral-audit.json','integral_audit_sha256'),('pairs.csv','pairs_csv_sha256'),('paper-projection-results.svg','figure_sha256')]:self.assertEqual(sha((self.base/file).read_bytes()),s[key])
        for p,h in s['scripts'].items():self.assertEqual(sha((ROOT/p).read_bytes().replace(b'\r\n',b'\n')),h)
        b=(self.base/s['package']['filename']).read_bytes();self.assertEqual(sha(b),s['package']['sha256']);self.assertEqual(len(b),s['package']['bytes'])
        with zipfile.ZipFile(self.base/s['package']['filename']) as z:
            members={p.relative_to(self.base).as_posix() for p in self.base.rglob('*') if p.is_file() and p.name not in [s['package']['filename'],'publication.json']};self.assertEqual(set(z.namelist()),members)
            for p in members:self.assertEqual(z.read(p),(self.base/p).read_bytes())
        self.assertEqual(ui.derive(),(ROOT/'shared/paper-projection-ui-v1.json').read_bytes())
if __name__=='__main__':unittest.main()
