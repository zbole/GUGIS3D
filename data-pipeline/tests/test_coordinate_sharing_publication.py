import hashlib,json,shutil,sys,tempfile,unittest,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'data-pipeline'))
import audit_coordinate_sharing as audit
import build_coordinate_sharing_display as display
import build_result_focus_v7 as focus

class CoordinateSharingPublication(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder=ROOT/'frontend/public/research/paper-coordinate-sharing-v1'
        cls.r=json.loads((cls.folder/'results.json').read_bytes());cls.s=json.loads((ROOT/'shared/paper-coordinate-sharing-v1.json').read_bytes())
    def test_all_exact_restorations_and_finite_minima_are_independently_verified(self):
        measured=audit.audit(self.folder)
        for key,value in measured.items():self.assertEqual(value,self.s['audit'][key])
        self.assertEqual(measured['exact_full_byte_restorations'],748);self.assertEqual(measured['independent_decisions_checked'],1932)
        self.assertEqual(self.r['summary']['published-quartic']['byte_rows']['losses'],5)
        self.assertEqual(self.r['stats']['larger'],496)
        c=next(c for c in self.r['cases'] if c['id']=='anisotropic-quartic-30');row=next(r for r in c['error_rows'] if r['target_e2_m2']==.1)
        self.assertIsNone(row['selected']['p1']);self.assertLess(c['models'][row['selected']['p2']]['binary_bytes'],c['models'][row['selected']['fitted']]['binary_bytes'])
    def test_every_public_file_zip_member_and_original_model_is_bound_to_its_actual_bytes(self):
        sha=lambda b:hashlib.sha256(b).hexdigest();index=json.loads((self.folder/'index.json').read_bytes())['files'];package=self.s['package']
        self.assertEqual(set(index),{p.relative_to(self.folder).as_posix() for p in self.folder.rglob('*') if p.is_file() and p.name!='index.json'})
        for name,receipt in index.items():
            raw=(self.folder/name).read_bytes();self.assertEqual(len(raw),receipt['bytes']);self.assertEqual(sha(raw),receipt['sha256'])
        blob=(self.folder/package['filename']).read_bytes();self.assertEqual(len(blob),package['bytes']);self.assertEqual(sha(blob),package['sha256'])
        with zipfile.ZipFile(self.folder/package['filename']) as archive:
            originals={'original/'+r['original_path'] for r in self.r['native_files'].values()}
            local=set(index)-{package['filename'],'publication.json'}
            self.assertEqual(set(archive.namelist()),local|originals);self.assertEqual(len(archive.namelist()),len(set(archive.namelist())))
            for name in local:self.assertEqual(archive.read(name),(self.folder/name).read_bytes())
            for name in originals:self.assertEqual(archive.read(name),(ROOT/'frontend/public/research'/name.removeprefix('original/')).read_bytes())
        self.assertEqual((self.folder/'publication.json').read_bytes(),(ROOT/'shared/paper-coordinate-sharing-v1.json').read_bytes())
        self.assertEqual(display.body(),(ROOT/'shared/paper-coordinate-sharing-display-v1.json').read_bytes())
    def test_fabricated_missing_baseline_or_nonminimal_selection_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp);shutil.copyfile(self.folder/'protocol.json',folder/'protocol.json');shutil.copytree(self.folder/'native',folder/'native')
            for kind in ['missing','minimum']:
                r=json.loads((self.folder/'results.json').read_bytes());c=r['cases'][0]
                if kind=='missing':
                    row=next(row for row in c['error_rows'] if row['selected']['adaptive_pt'] is None);row['selected']['adaptive_pt']=c['candidates']['adaptive_pt'][0]
                else:
                    row=c['byte_rows'][-1];row['selected']['fitted']=c['candidates']['fitted'][0]
                (folder/'results.json').write_text(json.dumps(r),encoding='utf8')
                with self.assertRaisesRegex(ValueError,'Fabricated minimum or missing result'):audit.audit(folder)

if __name__=='__main__':unittest.main()
