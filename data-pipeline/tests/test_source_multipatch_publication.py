"""All published component, frame and geometric-equivalence receipts."""
import importlib.util,json,struct,unittest,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];spec=importlib.util.spec_from_file_location('source_mp',ROOT/'data-pipeline/source_multipatch.py');mp=importlib.util.module_from_spec(spec);spec.loader.exec_module(mp)
PUB=ROOT/'frontend/public/research/source-multipatch-v1'
class PublicationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.report=json.loads((ROOT/'shared/source-multipatch-v1.json').read_bytes())
    def test_parent_implementation_and_complete_output_receipts(self):
        r=self.report;self.assertEqual((ROOT/'shared/source-multipatch-v1.json').read_bytes(),(PUB/'publication.json').read_bytes());self.assertEqual(mp.sha((PUB/'results.json').read_bytes()),r['report_sha256']);self.assertEqual(mp.sha((PUB/'source-publication.json').read_bytes()),r['source_publication_sha256']);self.assertEqual(mp.sha((PUB/'sites.csv').read_bytes()),r['csv_sha256']);self.assertEqual(mp.sha((PUB/'same-source-format-results.svg').read_bytes()),r['figure_sha256'])
        for name,digest in r['scripts'].items():
            self.assertEqual(mp.sha((ROOT/name).read_bytes().replace(b'\r\n',b'\n')),digest);self.assertEqual(mp.sha((PUB/'implementations'/Path(name).name).read_bytes()),digest)
        self.assertEqual(len(r['cases']),20);self.assertEqual(sum(c['triangles'] for c in r['cases']),163840)
    def test_all_actual_source_faces_bounds_indexes_and_five_file_costs(self):
        reader=mp.pyshp_reader()
        for c in self.report['cases']:
            folder=PUB/c['id'];ref=json.loads((folder/'reference.json').read_bytes());model=json.loads((folder/'source_p1.json').read_bytes());self.assertEqual(mp.readback(folder,model,reader,c['id']),c['readback']);self.assertFalse(c['measure_array_present']);self.assertEqual(c['native_p1_bytes'],135528);self.assertEqual(c['bytes'],201038);self.assertAlmostEqual(c['saving_percent'],32.58587928650305)
            total=0
            for name,v in c['files'].items():
                b=(folder/name).read_bytes();total+=len(b);self.assertEqual(mp.sha(b),v['sha256']);self.assertEqual(len(b),v['bytes'])
            self.assertEqual(total,c['bytes'])
            p=model['points'];origin=model['origin_bng'];bounds=(origin[0]-32,origin[1]-32,origin[0]+32,origin[1]+32,min(v[2] for v in p),max(v[2] for v in p))
            for name in ['terrain.shp','terrain.shx']:self.assertEqual(struct.unpack_from('<6d',(folder/name).read_bytes(),36),bounds)
            shp=(folder/'terrain.shp').read_bytes();self.assertEqual(struct.unpack_from('<4d',shp,112),bounds[:4]);self.assertEqual(struct.unpack_from('<2d',shp,108+44+512+16*8320),bounds[4:])
            self.assertEqual(mp.sha((folder/'reference.json').read_bytes()),c['reference_sha256']);self.assertEqual(mp.sha((folder/'source_p1.json').read_bytes()),c['source_p1_sha256']);self.assertEqual(mp.sha((folder/'source_p1.bin').read_bytes()),c['source_p1_binary_sha256'])
            with zipfile.ZipFile(folder/c['package']['filename']) as z:
                self.assertEqual(set(z.namelist()),set(c['files']))
                for name in c['files']:self.assertEqual(z.read(name),(folder/name).read_bytes())
    def test_full_evidence_archive_and_all_source_inputs_are_exact(self):
        package=self.report['package'];body=(PUB/package['filename']).read_bytes();self.assertEqual(len(body),package['bytes']);self.assertEqual(mp.sha(body),package['sha256'])
        with zipfile.ZipFile(PUB/package['filename']) as z:
            names=z.namelist();self.assertEqual(len(names),len(set(names)))
            for name in names:self.assertEqual(z.read(name),(PUB/Path(name).relative_to('source-multipatch-v1')).read_bytes())
            for c in self.report['cases']:
                for name in [*c['files'],'reference.json','source_p1.bin','source_p1.json','ruled.bin','ruled.json','source-multipatch.zip']:self.assertIn('source-multipatch-v1/'+c['id']+'/'+name,names)
if __name__=='__main__':unittest.main()
