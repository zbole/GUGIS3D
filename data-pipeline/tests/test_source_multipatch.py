import importlib.util,json,tempfile,unittest,struct
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[2];spec=importlib.util.spec_from_file_location('source_mp',ROOT/'data-pipeline/source_multipatch.py');mp=importlib.util.module_from_spec(spec);spec.loader.exec_module(mp)
class MultiPatchTests(unittest.TestCase):
    def test_optional_m_free_export_preserves_all_original_faces_and_upward_normals(self):
        source=ROOT/'frontend/public/research/source-native-bands-v1/manchester-centre';ref=json.loads((source/'reference.json').read_bytes());model=json.loads((source/'source_p1.json').read_bytes())
        with tempfile.TemporaryDirectory(dir=ROOT/'.local/qa') as temp:
            folder=Path(temp)/'shape';cost=mp.write_files(ref,'manchester-centre',folder,mp.PRJ.read_bytes());self.assertEqual(cost['files']['terrain.shp']['bytes'],200360);self.assertEqual(cost['files']['terrain.shx']['bytes'],108);self.assertEqual(cost['files']['terrain.dbf']['bytes'],147);self.assertEqual(cost['vertex_entries'],8320);self.assertFalse(cost['measure_array_present']);audit=mp.readback(folder,model,mp.pyshp_reader());self.assertTrue(audit['all_faces_upward']);self.assertTrue(audit['same_8192_source_faces']);self.assertEqual(audit['area_m2'],4096)
    def test_corrupt_z_or_index_is_rejected_by_complete_readback(self):
        source=ROOT/'frontend/public/research/source-native-bands-v1/manchester-centre';ref=json.loads((source/'reference.json').read_bytes());model=json.loads((source/'source_p1.json').read_bytes())
        with tempfile.TemporaryDirectory(dir=ROOT/'.local/qa') as temp:
            folder=Path(temp)/'shape';mp.write_files(ref,'manchester-centre',folder,mp.PRJ.read_bytes());path=folder/'terrain.shp';raw=path.read_bytes();changed=bytearray(raw);struct.pack_into('<d',changed,108+44+512+16*8320+16,999.);path.write_bytes(changed)
            with self.assertRaisesRegex(ValueError,'every source P1 face'):mp.readback(folder,model,mp.pyshp_reader())
            path.write_bytes(raw);idx=folder/'terrain.shx';b=bytearray(idx.read_bytes());struct.pack_into('>i',b,104,1);idx.write_bytes(b)
            with self.assertRaises(Exception):mp.readback(folder,model,mp.pyshp_reader())
    def test_export_rejects_noncomplete_source_and_never_overwrites(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'.local/qa') as temp:
            folder=Path(temp)/'shape';bad={'height':np.zeros((65,65)).tolist(),'origin_bng':[1.,2.],'x':list(range(65)),'y':list(range(65))}
            with self.assertRaisesRegex(ValueError,'Complete source'):mp.write_files(bad,'test',folder,b'')
            with self.assertRaises(FileExistsError):mp.write_files(bad,'test',Path(temp),b'')
if __name__=='__main__':unittest.main()
