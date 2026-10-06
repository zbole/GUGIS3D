import hashlib,json,unittest,zipfile
from pathlib import Path
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[2];PUB=ROOT/'frontend/public/research/ruled-terrain-tiles-v1'
def sha(b):return hashlib.sha256(b).hexdigest()
class TilePublicationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.r=json.loads((ROOT/'shared/ruled-terrain-tiles-v1.json').read_bytes())
    def test_source_values_tile_frame_and_all_complete_receipts(self):
        r=self.r;self.assertEqual((ROOT/'shared/ruled-terrain-tiles-v1.json').read_bytes(),(PUB/'publication.json').read_bytes())
        self.assertEqual(sha((PUB/'results.json').read_bytes()),r['report_sha256']);self.assertEqual(sha((PUB/'native-audit.json').read_bytes()),r['native_audit_sha256'])
        grid=(PUB/r['reference']['filename']).read_bytes();self.assertEqual(len(grid),r['reference']['bytes']);self.assertEqual(sha(grid),r['reference']['sha256']);z=np.frombuffer(grid,dtype='<f4').reshape(513,513)
        with Image.open(PUB/r['source_geotiff']['filename']) as im:
            np.testing.assert_array_equal(z,np.asarray(im)[::-1]);self.assertEqual(tuple(im.tag_v2[33922])[3:5],(r['origin_bng'][0]-256.5,r['origin_bng'][1]+256.5));self.assertEqual(tuple(im.tag_v2[33550]),(1.,1.,0.));keys=im.tag_v2[34735];records={keys[i]:tuple(keys[i+1:i+4]) for i in range(4,len(keys),4)};self.assertEqual(records[3072],(0,1,27700))
        top,left,w,h=r['source_window']
        with Image.open(ROOT/'backend/data/terrain/manchester-ea-dtm-1m.tif') as im:np.testing.assert_array_equal(z,np.asarray(im.crop((left,top,left+w,top+h)))[::-1])
        self.assertEqual(r['total_tile_bytes'],8673792);self.assertEqual(r['source_samples'],263169);self.assertEqual(len(r['tiles']),64)
        for tile in r['tiles']:
            b=(PUB/tile['filename']).read_bytes();self.assertEqual(len(b),tile['bytes']);self.assertEqual(sha(b),tile['sha256']);sub=z[tile['row']*64:tile['row']*64+65,tile['column']*64:tile['column']*64+65];self.assertEqual(tile['height_min_m'],float(sub.min()));self.assertEqual(tile['height_max_m'],float(sub.max()))
    def test_frozen_code_all_queries_and_seams_are_bound(self):
        r=self.r
        for path,digest in r['scripts'].items():
            self.assertEqual(sha((ROOT/path).read_bytes().replace(b'\r\n',b'\n')),digest);self.assertEqual(sha((PUB/'implementations'/Path(path).name).read_bytes()),digest)
        audit=json.loads((PUB/'native-audit.json').read_bytes());self.assertEqual(audit['total_internal_queries'],262144);self.assertEqual(audit['total_source_node_queries'],270400);self.assertEqual(audit['seam_midpoint_pairs'],7168);self.assertEqual(audit['seam_source_node_pairs'],7280);self.assertLess(audit['max_seam_height_difference_m'],1e-8);self.assertLess(audit['max_tangential_gradient_difference'],1e-8)
        self.assertEqual([t['id'] for t in audit['tiles']],[t['id'] for t in r['tiles']])
    def test_complete_dataset_archive_is_byte_exact(self):
        r=self.r;package=r['package'];b=(PUB/package['filename']).read_bytes();self.assertEqual(len(b),package['bytes']);self.assertEqual(sha(b),package['sha256'])
        with zipfile.ZipFile(PUB/package['filename']) as z:
            names=z.namelist();self.assertEqual(len(names),len(set(names)))
            for name in names:self.assertEqual(z.read(name),(PUB/Path(name).relative_to('ruled-terrain-tiles-v1')).read_bytes())
            for t in r['tiles']:self.assertIn('ruled-terrain-tiles-v1/'+t['filename'],names)
if __name__=='__main__':unittest.main()
