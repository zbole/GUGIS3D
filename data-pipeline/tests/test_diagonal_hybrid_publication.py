import hashlib,json,sys,unittest,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'data-pipeline'))
import build_diagonal_ui_summary as ui
class DiagonalPublication(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder=ROOT/'frontend/public/research/diagonal-hybrid-v1';cls.report=json.loads((cls.folder/'results.json').read_bytes());cls.summary=json.loads((ROOT/'shared/diagonal-hybrid-display-v1.json').read_bytes());cls.protocol=json.loads((cls.folder/'protocol.json').read_bytes())
    def test_every_stronger_control_and_unfavourable_outcome_uses_complete_actual_cost(self):
        r=self.report;p=self.protocol;self.assertEqual(len(r['cases']),20);self.assertEqual(sum(len(c['candidates']) for c in r['cases']),1960);self.assertEqual(sum(len(c['byte_pairs']) for c in r['cases']),200);self.assertEqual(sum(len(c['target_pairs']) for c in r['cases']),120)
        prior=json.loads((self.folder/'prior-hybrid-report.json').read_bytes())
        for c,old in zip(r['cases'],prior['cases']):
            self.assertEqual(c['id'],old['id'])
            for group,constraint in [('byte_pairs','byte_ceiling'),('target_pairs','height_target_m')]:
                self.assertEqual([v[constraint] for v in c[group]],p['byte_ceilings' if group=='byte_pairs' else 'height_targets_m'])
                for row,previous in zip(c[group],old[group]):
                    self.assertEqual(row['prior'],{m:previous[m] for m in ['p1','ruled','hybrid']})
                    for method in p['methods']:
                        pool=[e for e in c['candidates'] if e['method']==method and (e['binary_bytes']<=row[constraint] if group=='byte_pairs' else e['continuous_bound_m']<=row[constraint])]
                        chosen=min(pool,key=lambda e:(e['e2_m2'],e['binary_bytes'],e['nx'],e['ny']) if group=='byte_pairs' else (e['binary_bytes'],e['e2_m2'],e['nx'],e['ny'])) if pool else None
                        self.assertEqual(row[method],chosen)
            for e in c['candidates']:
                self.assertEqual(len(e['families']),e['nx']*e['ny']);self.assertEqual(e['stored_points'],(e['nx']+1)*(e['ny']+1));self.assertEqual(e['ruled_cells']+e['minus_cells']+e['plus_cells'],e['nx']*e['ny']);self.assertEqual(e['p1_triangles'],2*(e['minus_cells']+e['plus_cells']))
                if e['method']=='p1-local':self.assertEqual(e['ruled_cells'],0)
                if e['nx']==e['ny']==64:self.assertEqual(e['plus_cells'],0)
        self.assertTrue(any(e['plus_cells']>0 for c in r['cases'] for e in c['candidates'] if e['method']=='p1-local'))
        self.assertTrue(any(row['p1-local'] is None for c in r['cases'] for row in c['target_pairs']))
    def test_all_original_sources_native_integrals_code_and_complete_zip_members_are_bound(self):
        s=self.summary;sha=lambda b:hashlib.sha256(b).hexdigest()
        for file,key in [('results.json','report_sha256'),('native-audit.json','native_audit_sha256'),('integral-audit.json','integral_audit_sha256'),('diagonal-hybrid-results.svg','figure_sha256'),('selections.csv','selections_csv_sha256')]:self.assertEqual(sha((self.folder/file).read_bytes()),s[key])
        for p,h in s['scripts'].items():self.assertEqual(sha((ROOT/p).read_bytes().replace(b'\r\n',b'\n')),h)
        for c in self.report['cases']:
            original=ROOT/'frontend/public/research/source-native-bands-v1'/c['id']
            for name in ['reference.json','source-window.tif']:self.assertEqual((self.folder/c['id']/name).read_bytes(),(original/name).read_bytes())
            for e in c['candidates']:
                for name,h,length in [('filename','sha256','bytes'),('binary_filename','binary_sha256','binary_bytes')]:
                    b=(self.folder/c['id']/e[name]).read_bytes();self.assertEqual(len(b),e[length]);self.assertEqual(sha(b),e[h])
        native=json.loads((self.folder/'native-audit.json').read_bytes());integral=json.loads((self.folder/'integral-audit.json').read_bytes());expected={(c['id'],e['filename']) for c in self.report['cases'] for e in c['candidates']};self.assertEqual({(e['case_id'],e['filename']) for e in native['models']},expected);self.assertEqual({(e['case_id'],e['filename']) for e in integral['models']},expected);self.assertEqual(native['queries'],10288040);self.assertEqual(native['seam_height_pairs'],8534400)
        for e in integral['models']:self.assertEqual(e['integrated_area_m2'],4096);self.assertLess(e['producer_e2_difference_m2'],1e-8*max(1,e['e2_m2']));self.assertLess(e['producer_maximum_difference_m'],1e-8*max(1,e['continuous_maximum_m']))
        b=(self.folder/s['package']['filename']).read_bytes();self.assertEqual(len(b),s['package']['bytes']);self.assertEqual(sha(b),s['package']['sha256'])
        with zipfile.ZipFile(self.folder/s['package']['filename']) as z:
            expected={p.relative_to(self.folder).as_posix() for p in self.folder.rglob('*') if p.is_file() and p.name not in [s['package']['filename'],'publication.json']};self.assertEqual(set(z.namelist()),expected)
            for p in expected:self.assertEqual(z.read(p),(self.folder/p).read_bytes())
    def test_deduplicated_ui_retains_all_selected_receipts_and_explicit_missing_controls(self):
        raw=ui.derive();self.assertEqual(raw,(ROOT/'shared/diagonal-hybrid-ui-v1.json').read_bytes());self.assertLess(len(raw),500000);view=json.loads(raw)
        for c,s in zip(view['cases'],self.summary['cases']):
            for group in ['byte_pairs','target_pairs']:
                for row,source in zip(c[group],s[group]):
                    for method,old in [('p1-local',False),('hybrid-local',False),('p1',True),('ruled',True),('hybrid',True)]:
                        model_id=row['prior'][method] if old else row[method];e=source['prior'][method] if old else source[method]
                        if e is None:self.assertIsNone(model_id)
                        else:
                            self.assertEqual(c['models'][model_id]['previous'],old)
                            for k,v in c['models'][model_id].items():
                                if k in ['previous','minus_cells','plus_cells']:continue
                                self.assertEqual(v,e[k])
if __name__=='__main__':unittest.main()
