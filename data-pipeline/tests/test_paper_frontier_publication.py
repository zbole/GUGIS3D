import hashlib,json,sys,unittest,zipfile,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'data-pipeline'))
import paper_frontier_audit as audit
import build_result_focus_v6 as focus
class FiniteFrontierPublication(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder=ROOT/'frontend/public/research/paper-finite-frontier-v1';cls.r=json.loads((cls.folder/'results.json').read_bytes());cls.s=json.loads((ROOT/'shared/paper-finite-frontier-v1.json').read_bytes())
    def test_independent_minima_dominance_missing_and_unfavourable_observations(self):
        self.assertEqual(audit.verify(self.folder),self.s['audit']);self.assertEqual(self.s['audit']['exhaustive_selections'],1932);self.assertEqual(self.s['audit']['complete_source_files'],1496)
        self.assertEqual(self.r['summary']['anisotropic-quartic']['error_rows']['wins'],69)
        self.assertEqual(self.r['summary']['published-quartic']['byte_rows']['losses'],5)
        self.assertEqual(self.r['summary']['published-quartic']['error_rows']['only_adaptive'],5)
        c=next(c for c in self.r['cases'] if c['id']=='anisotropic-quartic-30');row=next(row for row in c['error_rows'] if row['target_e2_m2']==.1)
        self.assertIsNone(row['selected']['p1']);self.assertLess(c['models'][row['selected']['p2']]['binary_bytes'],c['models'][row['selected']['fitted']]['binary_bytes'])
    def test_complete_download_and_public_index_bind_actual_native_files_and_prior_audits(self):
        sha=lambda b:hashlib.sha256(b).hexdigest();p=self.s['package'];b=(self.folder/p['filename']).read_bytes();self.assertEqual(len(b),p['bytes']);self.assertEqual(sha(b),p['sha256']);self.assertEqual(sha((self.folder/'results.json').read_bytes()),self.s['report_sha256'])
        self.assertEqual((self.folder/'publication.json').read_bytes(),(ROOT/'shared/paper-finite-frontier-v1.json').read_bytes())
        index=json.loads((self.folder/'index.json').read_bytes())['files'];self.assertEqual(set(index),{f.relative_to(self.folder).as_posix() for f in self.folder.rglob('*') if f.is_file() and f.name!='index.json'})
        for name,e in index.items():
            blob=(self.folder/name).read_bytes();self.assertEqual(len(blob),e['bytes']);self.assertEqual(sha(blob),e['sha256'])
        with zipfile.ZipFile(self.folder/p['filename']) as z:
            expected={f.relative_to(self.folder).as_posix() for f in self.folder.rglob('*') if f.is_file() and f.name not in [p['filename'],'publication.json','index.json']}|{'native/'+name for name in self.r['source_files']}
            self.assertEqual(set(z.namelist()),expected);self.assertEqual(len(z.namelist()),len(set(z.namelist())))
            for name in expected:
                actual=ROOT/'frontend/public/research'/name.removeprefix('native/') if name.startswith('native/') else self.folder/name
                self.assertEqual(z.read(name),actual.read_bytes())
        for name,e in self.s['prior_audits'].items():
            blob=(self.folder/name).read_bytes();self.assertEqual(sha(blob),e['sha256']);self.assertEqual(blob,(ROOT/'frontend/public/research'/name.removeprefix('prior-audits/')).read_bytes())
    def test_independent_audit_rejects_missing_baseline_fabrication_and_wrong_budget_minimum(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)
            for name in ['protocol.json','all-decisions.csv']:(p/name).write_bytes((self.folder/name).read_bytes())
            r=json.loads((self.folder/'results.json').read_bytes());c=r['cases'][0];row=c['byte_rows'][0];row['selected']['adaptive_pt']=c['candidates']['adaptive_pt'][-1]
            (p/'results.json').write_text(json.dumps(r),encoding='utf8')
            with self.assertRaisesRegex(ValueError,'finite minimum'):audit.verify(p)
    def test_new_focused_result_is_derived_from_exact_complete_cost_and_keeps_stronger_control(self):
        self.assertEqual(focus.body(),(ROOT/'shared/result-focus-v6.json').read_bytes());r=json.loads(focus.body());self.assertLess(len(focus.body()),26000);s=r['stories'][0]
        self.assertAlmostEqual(s['value'],100*(1-45000/196512));self.assertEqual(s['detail_href'],'#paper-frontier-results');self.assertIn('23,688',s['controls']);self.assertEqual(len(s['metrics']),5)
if __name__=='__main__':unittest.main()
