import hashlib,json,sys,unittest,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'data-pipeline'))
import build_adaptive_projection_ui as ui
class AdaptivePublication(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder=ROOT/'frontend/public/research/paper-adaptive-projection-v1';cls.report=json.loads((cls.folder/'results.json').read_bytes());cls.summary=json.loads((ROOT/'shared/paper-adaptive-projection-display-v1.json').read_bytes())
    def test_full_original_cases_budgets_controls_and_failed_comparisons_are_retained(self):
        r=self.report;old=json.loads((self.folder/'source-report.json').read_bytes());fitted=json.loads((self.folder/'fitted-report.json').read_bytes());self.assertEqual(len(r['cases']),14);self.assertEqual(sum(len(c['pairs']) for c in r['cases']),126)
        signs=[]
        for c,a,b in zip(r['cases'],old['cases'],fitted['cases']):
            self.assertEqual(c['id'],a['id']);self.assertEqual(c['field'],a['field']);self.assertEqual([p['budget'] for p in c['pairs']],[8,16,32,64,128,256,512,1024,2048]);trace=json.loads((self.folder/c['id']/'refinement-trace.json').read_bytes());self.assertEqual(len(trace),2046);self.assertEqual(trace[-1]['triangle_count_before'],2047)
            for p,prior,fit in zip(c['pairs'],a['pairs'],b['pairs']):
                for key,v in [('p1',prior['p1']),('fixed_pt',fit['pt']),('before',prior['mean_hessian']),('fitted',fit['c0-stable']),('p2',prior['p2'])]:self.assertEqual(p[key],v)
                e=p['adaptive_pt'];model=json.loads((self.folder/c['id']/e['filename']).read_bytes());self.assertEqual(len(model['patches']),p['budget']);self.assertTrue(all(t['kind']=='triangle-strip' and len(t['indices'])==3 for t in model['patches']));self.assertEqual(e['binary_bytes'],48+24*e['controls']+24*p['budget']);self.assertEqual(p['before']['binary_bytes'],p['fitted']['binary_bytes']);signs.append(p['fitted']['e2_m2']<e['e2_m2'])
        self.assertIn(True,signs);self.assertIn(False,signs)
    def test_all_saved_models_source_code_integrals_traces_and_complete_zip_are_bound(self):
        s=self.summary;sha=lambda b:hashlib.sha256(b).hexdigest()
        for name,key in [('results.json','report_sha256'),('native-audit.json','native_audit_sha256'),('independent-audit.json','independent_audit_sha256'),('adaptive-projection-results.svg','figure_sha256'),('all-methods.csv','csv_sha256')]:self.assertEqual(sha((self.folder/name).read_bytes()),s[key])
        for p,h in s['scripts'].items():self.assertEqual(sha((ROOT/p).read_bytes().replace(b'\r\n',b'\n')),h)
        native=json.loads((self.folder/'native-audit.json').read_bytes());independent=json.loads((self.folder/'independent-audit.json').read_bytes());expected={(c['id'],p['adaptive_pt']['filename']) for c in self.report['cases'] for p in c['pairs']}
        self.assertEqual({(p['case_id'],p['filename']) for p in native['models']},expected);self.assertEqual({(p['case_id'],p['filename']) for p in independent['models']},expected);self.assertEqual(native['queries'],129528);self.assertEqual(len(independent['traces']),14)
        for c in self.report['cases']:
            self.assertEqual(sha((self.folder/c['id']/'refinement-trace.json').read_bytes()),c['trace_sha256'])
            for p in c['pairs']:
                e=p['adaptive_pt']
                for filename,h,size in [('filename','sha256','bytes'),('binary_filename','binary_sha256','binary_bytes')]:
                    b=(self.folder/c['id']/e[filename]).read_bytes();self.assertEqual(sha(b),e[h]);self.assertEqual(len(b),e[size])
        p=self.folder/s['package']['filename'];b=p.read_bytes();self.assertEqual(sha(b),s['package']['sha256']);self.assertEqual(len(b),s['package']['bytes'])
        with zipfile.ZipFile(p) as z:
            expected={f.relative_to(self.folder).as_posix() for f in self.folder.rglob('*') if f.is_file() and f.name not in [p.name,'publication.json']};self.assertEqual(set(z.namelist()),expected)
            for f in expected:self.assertEqual(z.read(f),(self.folder/f).read_bytes())
    def test_compact_six_method_receipts_are_exactly_derived(self):
        b=ui.body();self.assertEqual(b,(ROOT/'shared/paper-adaptive-projection-ui-v1.json').read_bytes());self.assertLess(len(b),300000);r=json.loads(b);self.assertEqual(len(r['cases']),14)
        for c in r['cases']:
            for p in c['pairs']:
                self.assertTrue(all(key in p for key in ['p1','pt','adaptive','before','fitted','p2']))
                self.assertEqual(c['models'][p['adaptive']]['package'],'paper-adaptive-projection-v1')
if __name__=='__main__':unittest.main()
