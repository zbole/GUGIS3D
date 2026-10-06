import csv,hashlib,io,json,sys,tempfile,unittest,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'data-pipeline'))
from build_result_focus_v4 import body
from publish_source_query import verify
BASE=ROOT/'frontend/public/research/source-query-v1'
sha=lambda b:hashlib.sha256(b).hexdigest()
class Publication(unittest.TestCase):
    def test_every_process_method_record_and_source_is_retained(self):
        s=json.loads((ROOT/'shared/source-query-display-v1.json').read_bytes())
        self.assertEqual((ROOT/'shared/source-query-display-v1.json').read_bytes(),(BASE/'publication.json').read_bytes())
        for name,key in [('results.json','report_sha256'),('native-audit.json','native_audit_sha256'),('all-trials.csv','trials_sha256'),('run-receipt.json','receipt_sha256'),('source-publication.json','source_publication_sha256'),('source-query-results.svg','figure_sha256'),('failed-before-timing-receipt.json','failure_receipt_sha256')]:self.assertEqual(sha((BASE/name).read_bytes()),s[key])
        rows=list(csv.DictReader(io.StringIO((BASE/'all-trials.csv').read_text(encoding='utf8'))));self.assertEqual(len(rows),5760)
        self.assertEqual(len(s['cases']),20);self.assertEqual(len(set(c['city_id'] for c in s['cases'])),10)
        for c in s['cases']:
            for run in range(1,4):
                r=[v for v in rows if v['case_id']==c['id'] and int(v['repetition'])==run];self.assertEqual(len(r),96)
                for family in s['protocol']['families']:
                    for position in range(4):self.assertEqual(sum(v['family']==family and int(v['execution_order'])==position for v in r),6)
            for m in c['methods']:
                b=(BASE/'models'/c['id']/m['filename']).read_bytes();self.assertEqual(len(b),m['binary_bytes']);self.assertEqual(sha(b),m['binary_sha256'])
        self.assertEqual(s['aggregate']['p2_over_compact']['wins'],60)
        self.assertEqual(s['aggregate']['generic_over_compact']['wins'],60)
        self.assertEqual(s['aggregate']['grid_over_compact']['wins'],0)
    def test_complete_zip_and_frozen_source_snapshots(self):
        s=json.loads((ROOT/'shared/source-query-display-v1.json').read_bytes());b=(BASE/s['package']['filename']).read_bytes();self.assertEqual(len(b),s['package']['bytes']);self.assertEqual(sha(b),s['package']['sha256'])
        files={p.relative_to(BASE).as_posix():p.read_bytes() for p in BASE.rglob('*') if p.is_file() and p.name not in [s['package']['filename'],'publication.json']}
        with zipfile.ZipFile(io.BytesIO(b)) as z:
            self.assertEqual(set(z.namelist()),set(files))
            for name,data in files.items():self.assertEqual(z.read(name),data,name)
        for path,h in {**s['scripts'],**s['release_scripts']}.items():
            a=(ROOT/path).read_text(encoding='utf8').replace('\r\n','\n').encode('utf8');snap=(BASE/'implementation'/path).read_text(encoding='utf8').replace('\r\n','\n').encode('utf8');self.assertEqual(a,snap);self.assertEqual(sha(a),h)
    def test_full_release_replay_and_primary_focus_are_derived(self):
        # A fresh clone must reproduce publication checks without private .local runs.
        with tempfile.TemporaryDirectory(prefix='gugis-source-query-failure-') as d:
            failed=Path(d);(failed/'run-receipt.json').write_bytes((BASE/'failed-before-timing-receipt.json').read_bytes());s,csv_data=verify(BASE,failed)
        self.assertEqual(csv_data,(BASE/'all-trials.csv').read_bytes());self.assertEqual(s['aggregate'],json.loads((BASE/'results.json').read_bytes())['aggregate'])
        self.assertEqual(body(),(ROOT/'shared/result-focus-v4.json').read_bytes())
if __name__=='__main__':unittest.main()
