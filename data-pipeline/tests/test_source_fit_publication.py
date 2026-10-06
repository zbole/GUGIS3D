import unittest,json,sys,zipfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from source_band_benchmark import ROOT,sha
from publish_source_fit import aggregate
from build_source_fit_ui import derive as compact
from build_result_focus_v5 import derive as focus
BASE=ROOT/'frontend/public/research/source-global-fit-v1'
class CompleteSourceFitPublication(unittest.TestCase):
    def test_all_indexed_files_and_complete_archive_have_exact_bytes_without_private_dependencies(self):
        index=json.loads((BASE/'file-index.json').read_bytes());summary=json.loads((ROOT/'shared/source-global-fit-display-v1.json').read_bytes());package=summary['package']['filename']
        self.assertEqual(len(index),5950)
        with zipfile.ZipFile(BASE/package) as archive:
            self.assertEqual(set(archive.namelist()),set(index)-{package});self.assertIsNone(archive.testzip())
            for name,receipt in index.items():
                raw=(BASE/name).read_bytes();self.assertEqual(len(raw),receipt['bytes']);self.assertEqual(sha(raw),receipt['sha256'])
                if name!=package:self.assertEqual(archive.read(name),raw)
    def test_all_models_and_negative_counts_derive_from_saved_complete_report_and_independent_audits(self):
        r=json.loads((BASE/'results.json').read_bytes());n=json.loads((BASE/'native-audit.json').read_bytes());a=json.loads((BASE/'integral-audit.json').read_bytes());summary=json.loads((ROOT/'shared/source-global-fit-display-v1.json').read_bytes());self.assertEqual(aggregate(r),summary['aggregates']);self.assertEqual(aggregate(r),json.loads((BASE/'aggregate.json').read_bytes()));self.assertEqual(sum(len(c['candidates']) for c in r['cases']),2940);self.assertEqual(n['queries'],15432060);self.assertEqual(n['seam_height_pairs'],12801600);self.assertEqual(len(a['models']),2940);self.assertEqual(a['report_sha256'],sha((BASE/'results.json').read_bytes()))
        self.assertEqual(summary['aggregates']['fitting']['maximum_increases'],144);self.assertEqual(summary['aggregates']['hybrid_vs_fitted_p1']['fixed_budget_losses'],3)
        for row in a['models']:self.assertLessEqual(row['galerkin_residual_norm'],row['declared_roundoff_bound']);self.assertLess(row['integral_difference_m2'],1e-8)
    def test_compact_transport_and_primary_claims_bind_complete_current_and_previous_evidence(self):
        self.assertEqual(compact(),json.loads((ROOT/'shared/source-global-fit-ui-v1.json').read_bytes()));self.assertEqual(focus(),json.loads((ROOT/'shared/result-focus-v5.json').read_bytes()));story=focus()['stories'][1];self.assertEqual(story['value'],17);self.assertEqual(sum(p['reduction_percent']<0 for p in story['points']),3)
if __name__=='__main__':unittest.main()
