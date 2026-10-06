"""Release integrity: source pixels, full files and independently reproducible inputs."""
import hashlib,json,unittest,zipfile
from pathlib import Path
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
PUBLIC=ROOT/'frontend/public/research/source-native-bands-v1'
def sha(data):return hashlib.sha256(data).hexdigest()
class PublicationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.report=json.loads((ROOT/'shared/source-native-bands-v1.json').read_text(encoding='utf8'))
    def test_receipts_and_frozen_implementation_pins(self):
        r=self.report
        self.assertEqual((ROOT/'shared/source-native-bands-v1.json').read_bytes(),(PUBLIC/'publication.json').read_bytes())
        for name,key in [('results.json','report_sha256'),('native-audit.json','native_audit_sha256'),('sites.csv','csv_sha256')]:self.assertEqual(sha((PUBLIC/name).read_bytes()),r[key])
        for path,digest in r['scripts'].items():
            self.assertEqual(sha((ROOT/path).read_bytes().replace(b'\r\n',b'\n')),digest)
            self.assertEqual(sha((PUBLIC/'implementations'/Path(path).name).read_bytes()),digest)
        for name,digest in r['figures'].items():self.assertEqual(sha((PUBLIC/name).read_bytes()),digest)
    def test_all_source_pixels_frames_and_complete_costs(self):
        self.assertEqual(len(self.report['cases']),20)
        for c in self.report['cases']:
            folder=PUBLIC/c['id'];ref=json.loads((folder/'reference.json').read_text(encoding='utf8'))
            for m in c['models']:
                for name,size,digest in [(m['filename'],m['bytes'],m['sha256']),(m['binary_filename'],m['binary_bytes'],m['binary_sha256'])]:
                    b=(folder/name).read_bytes();self.assertEqual(len(b),size);self.assertEqual(sha(b),digest)
            families={m['family']:m for m in c['models']};self.assertEqual(families['ruled']['binary_bytes'],135528);self.assertEqual(families['source_p1']['binary_bytes'],135528);self.assertEqual(families['source_p2']['binary_bytes'],694376)
            for f in ['ruled','source_p2']:self.assertLess(families[f]['e2_m2'],1e-8)
            self.assertGreater(families['source_p1']['e2_m2'],0)
            grid=c['regular_grid'];self.assertEqual(len((folder/grid['filename']).read_bytes()),16980);self.assertEqual(sha((folder/grid['filename']).read_bytes()),grid['sha256'])
            tif=c['source_geotiff'];body=(folder/tif['filename']).read_bytes();self.assertEqual(len(body),tif['bytes']);self.assertEqual(sha(body),tif['sha256'])
            with Image.open(folder/tif['filename']) as im:
                self.assertEqual(im.mode,'F');self.assertEqual(im.size,(65,65));np.testing.assert_array_equal(np.asarray(im)[::-1],np.asarray(ref['height'],dtype=np.float32))
                self.assertEqual(tuple(im.tag_v2[33550]),(1,1,0));tie=im.tag_v2[33922];self.assertEqual(tie[3],c['origin_bng'][0]-32.5);self.assertEqual(tie[4],c['origin_bng'][1]+32.5)
                keys=im.tag_v2[34735];records={keys[i]:tuple(keys[i+1:i+4]) for i in range(4,len(keys),4)};self.assertEqual(records[3072],(0,1,27700));self.assertEqual(records[1025],(0,1,1))
    def test_archive_contains_all_public_evidence_byte_exact(self):
        package=self.report['package'];body=(PUBLIC/package['filename']).read_bytes();self.assertEqual(len(body),package['bytes']);self.assertEqual(sha(body),package['sha256'])
        with zipfile.ZipFile(PUBLIC/package['filename']) as archive:
            names=archive.namelist();self.assertEqual(len(names),len(set(names)))
            for name in names:
                rel=Path(name).relative_to('source-native-bands-v1');self.assertEqual(archive.read(name),(PUBLIC/rel).read_bytes())
            for c in self.report['cases']:
                for name in ['reference.json','source-window.tif','regular-grid.bin','ruled.json','ruled.bin','source_p1.json','source_p1.bin','source_p2.json','source_p2.bin']:self.assertIn(f"source-native-bands-v1/{c['id']}/{name}",names)
if __name__=='__main__':unittest.main()
