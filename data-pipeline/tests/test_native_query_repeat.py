import csv,io,json,shutil,sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import publish_native_repeat as p
SOURCE=p.DEST if p.DEST.exists() else p.ROOT/'.local/research/native-query-repeat-2026-10-06-fixed'
class RepeatValidation(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.folder=Path(self.temp.name)/'repeat';shutil.copytree(SOURCE,self.folder)
    def tearDown(self):self.temp.cleanup()
    def refresh(self):
        receipt=json.loads((self.folder/'run-receipt.json').read_bytes())
        for entry in receipt['runs']:
            out=self.folder/entry['folder'];r=json.loads((out/'results.json').read_bytes());b=(out/'trials.csv').read_bytes();r['trials_csv']['sha256']=p.sha(b);r['trials_csv']['bytes']=len(b);raw=p.packed(r);(out/'results.json').write_bytes(raw);entry['report_sha256']=p.sha(raw);entry['trials_sha256']=p.sha(b)
        receipt_raw=p.packed(receipt);(self.folder/'run-receipt.json').write_bytes(receipt_raw);audit=json.loads((self.folder/'native-audit.json').read_bytes());audit['receipt_sha256']=p.sha(receipt_raw);(self.folder/'native-audit.json').write_bytes(p.packed(audit))
    def test_all_runs_and_full_trial_data_recompute(self):
        r,trials,a=p.verify(self.folder);self.assertEqual(a['verified_records'],660);self.assertEqual(r['prepared_pairs'],255);self.assertEqual([len(c['repetitions']) for c in r['cases']],[3]*5);self.assertEqual(len(list(csv.DictReader(io.StringIO(trials.decode())))),660)
    def test_consistently_rehashed_bad_query_arithmetic_is_rejected(self):
        directory=self.folder/'run-1';r=json.loads((directory/'results.json').read_bytes());r['cases'][0]['rows'][0]['queries']+=4096;(directory/'results.json').write_bytes(p.packed(r));rows=list(csv.DictReader(io.StringIO((directory/'trials.csv').read_text())));rows[0]['queries']=str(r['cases'][0]['rows'][0]['queries']);text=io.StringIO();w=csv.DictWriter(text,fieldnames=list(rows[0]),lineterminator='\n');w.writeheader();w.writerows(rows);(directory/'trials.csv').write_text(text.getvalue(),newline='');self.refresh()
        with self.assertRaisesRegex(ValueError,'Invalid timing arithmetic'):p.verify(self.folder)
    def test_incomplete_independent_query_coverage_cannot_publish(self):
        audit=json.loads((self.folder/'native-audit.json').read_bytes());audit['models'][0]['hits']=4099;(self.folder/'native-audit.json').write_bytes(p.packed(audit))
        with self.assertRaisesRegex(ValueError,'Independent native correctness failed'):p.verify(self.folder)
    def test_changed_timed_body_is_rejected_even_with_a_new_adapter_receipt(self):
        runner=self.folder/'replay-runner.mjs';runner.write_bytes(runner.read_bytes()+b'// changed timed source\n');receipt=json.loads((self.folder/'run-receipt.json').read_bytes());receipt['adapted_runner_sha256']=p.sha(runner.read_bytes());(self.folder/'run-receipt.json').write_bytes(p.packed(receipt))
        with self.assertRaisesRegex(ValueError,'Timed body changed'):p.verify(self.folder)
    def test_favourable_run_selection_cannot_drop_other_repetitions(self):
        receipt=json.loads((self.folder/'run-receipt.json').read_bytes());receipt['runs']=receipt['runs'][:1];(self.folder/'run-receipt.json').write_bytes(p.packed(receipt))
        with self.assertRaisesRegex(ValueError,'Incomplete or changed baseline/repetitions'):p.verify(self.folder)
if __name__=='__main__':unittest.main()
