import hashlib,json,sys,unittest,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'data-pipeline'))
import publish_exeter_source_fit as publish

class ExeterSourcePublication(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder=ROOT/'frontend/public/research/exeter-source-fit-v1';cls.raw=(cls.folder/'results.json').read_bytes();cls.r=json.loads(cls.raw);cls.s=json.loads((ROOT/'shared/exeter-source-fit-v1.json').read_bytes())
    def test_full_audits_bind_every_new_model_original_source_and_frozen_implementation(self):
        p,r,audits=publish.verify_receipts(self.folder);self.assertEqual(publish.aggregation(r),self.s['aggregate'])
        self.assertEqual(audits['native-audit.json']['queries'],1543206);self.assertEqual(audits['source-controls-audit.json']['queries'],49926)
        self.assertEqual(self.s['aggregate']['fitting']['strict_e2_improvements'],290);self.assertEqual(self.s['aggregate']['fitting']['identities'],4);self.assertEqual(self.s['aggregate']['fitting']['maximum_increases'],10)
        self.assertEqual(self.s['aggregate']['all_budgets_vs_p1'],{'wins':16,'ties':3,'losses':1,'missing':0})
        self.assertEqual(len(json.loads((ROOT/'frontend/public/research/source-global-fit-v1/results.json').read_bytes())['cases']),20)
        self.assertEqual([c['source_window'] for c in r['cases']],p['windows'])
    def test_public_index_and_zip_are_complete_and_preserve_every_actual_byte(self):
        sha=lambda b:hashlib.sha256(b).hexdigest();index=json.loads((self.folder/'index.json').read_bytes())['files'];package=self.s['package']
        actual={p.relative_to(self.folder).as_posix() for p in self.folder.rglob('*') if p.is_file() and p.name!='index.json'};self.assertEqual(set(index),actual)
        for name,e in index.items():
            raw=(self.folder/name).read_bytes();self.assertEqual(len(raw),e['bytes']);self.assertEqual(sha(raw),e['sha256'])
        raw=(self.folder/package['filename']).read_bytes();self.assertEqual(len(raw),package['bytes']);self.assertEqual(sha(raw),package['sha256'])
        self.assertEqual((self.folder/'publication.json').read_bytes(),(ROOT/'shared/exeter-source-fit-v1.json').read_bytes())
        with zipfile.ZipFile(self.folder/package['filename']) as archive:
            expected=actual-{package['filename'],'publication.json'};self.assertEqual(set(archive.namelist()),expected);self.assertEqual(len(archive.namelist()),len(expected))
            for name in expected:self.assertEqual(archive.read(name),(self.folder/name).read_bytes())
    def test_all_ui_minima_and_original_controls_equal_the_complete_actual_report(self):
        p=json.loads((self.folder/'protocol.json').read_bytes())
        for c,s in zip(self.r['cases'],self.s['cases']):
            for e in c['candidates']:self.assertEqual(s['models'][e['id']],publish.compact(e))
            for name,key in [('byte_pairs','byte_ceiling'),('target_pairs','height_target_m')]:
                for raw,old,view in zip(c[name],publish.unfitted_rows(c,p,name),s[name]):
                    self.assertEqual(raw[key],view[key])
                    for method in p['methods']:
                        e=raw[method];self.assertEqual(view[method],e['id'] if e else None)
                        o=old[method+'-unfitted'];self.assertEqual(view[method+'-unfitted'],o['id'] if o else None)
                        if o:self.assertEqual(s['models'][o['id']],o)
        brief=json.loads((ROOT/'shared/exeter-source-brief-v1.json').read_bytes());self.assertEqual(brief['source_view_sha256'],hashlib.sha256((ROOT/'shared/exeter-source-fit-v1.json').read_bytes()).hexdigest());self.assertEqual(brief['hybrid_wins'],self.s['aggregate']['hybrid_vs_p1']['wins'])
    def test_readable_figure_version_binds_the_original_unmodified_measurements(self):
        folder=ROOT/'frontend/public/research/exeter-source-fit-presentation-v2';index=json.loads((folder/'index.json').read_bytes());self.assertEqual(index['source_report_sha256'],hashlib.sha256(self.raw).hexdigest())
        self.assertEqual(set(index['files']),{p.name for p in folder.iterdir() if p.name!='index.json'})
        for name,e in index['files'].items():
            raw=(folder/name).read_bytes();self.assertEqual(len(raw),e['bytes']);self.assertEqual(hashlib.sha256(raw).hexdigest(),e['sha256'])

if __name__=='__main__':unittest.main()
