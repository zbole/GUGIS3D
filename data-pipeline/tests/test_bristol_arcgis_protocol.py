"""Integrity and fake-adapter regression tests; never ArcGIS performance evidence."""
import contextlib
import io
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from zipfile import ZipFile
import shapefile

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'data-pipeline'))
from run_bristol_arcgis import verified_manifest,run,coordinate_digest


class Adapter:
    def __init__(self,root):
        self.geometries={};self.copy_calls=0;self.broken_copy=False;self.open_cursors=0
        for model in json.loads((root/'manifest.json').read_bytes())['models']:
            path=root/model['id']/'terrain.shp'
            reader=shapefile.Reader(str(path));shape=reader.shape(0)
            points=[types.SimpleNamespace(X=xy[0],Y=xy[1],Z=z) for xy,z in zip(shape.points,shape.z)]
            boundaries=[*shape.parts,len(points)]
            self.geometries[str(path)]=(reader.record(0)['SAMPLE_ID'],[points[a:b] for a,b in zip(boundaries,boundaries[1:])])
            reader.close()
        self.da=types.SimpleNamespace(SearchCursor=self.cursor)
        self.management=types.SimpleNamespace(CreateFileGDB=self.create,CopyFeatures=self.copy,ClearWorkspaceCache=lambda *args:None)
    def GetInstallInfo(self):return {'ProductName':'ArcGISPro','Version':'TEST-ONLY'}
    def ProductInfo(self):return 'Advanced'
    def EnvManager(self,**kwargs):return contextlib.nullcontext()
    def Describe(self,path):return types.SimpleNamespace(shapeType='MultiPatch',hasZ=True,spatialReference=types.SimpleNamespace(factoryCode=27700))
    @contextlib.contextmanager
    def cursor(self,path,fields):
        self.assert_fields=fields
        identity,parts=self.geometries[path]
        class Geometry(list):
            @property
            def pointCount(self):return sum(len(p) for p in self)
        self.open_cursors+=1
        try:yield iter([(Geometry(parts),identity)])
        finally:self.open_cursors-=1
    def create(self,parent,name):
        folder=Path(parent)/name;folder.mkdir();(folder/'fixture.gdbtable').write_bytes(b'test-only')
    def copy(self,source,target):
        self.copy_calls+=1;self.geometries[target]=self.geometries[source]
        if self.broken_copy:
            identity,parts=self.geometries[target]
            altered=[list(p) for p in parts];p=altered[0][0]
            altered[0][0]=types.SimpleNamespace(X=p.X,Y=p.Y,Z=p.Z+.01)
            self.geometries[target]=(identity,altered)


class ProtocolTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='gugis-protocol-unit-')
        self.root=Path(self.temp.name).resolve()
        with ZipFile(ROOT/'frontend/public/research/bristol-arcgis/bristol-arcgis-protocol.zip') as archive:
            self.assertTrue(all(not p.startswith('/') and '..' not in Path(p).parts for p in archive.namelist()))
            archive.extractall(self.root)
    def tearDown(self):self.temp.cleanup()
    def test_package_contains_six_unchanged_native_models_and_directed_geometry(self):
        manifest,digest=verified_manifest(self.root)
        public=json.loads((ROOT/'shared/bristol-arcgis-protocol.json').read_bytes())
        self.assertEqual(digest,public['manifest_sha256'])
        self.assertEqual(len(manifest['models']),6)
        self.assertEqual(len({m['geometry_sha256'] for m in manifest['models']}),6)
    def test_changed_component_and_path_traversal_fail_before_operations(self):
        manifest,_=verified_manifest(self.root)
        path=self.root/manifest['models'][0]['files'][0]['path']
        original=path.read_bytes();path.write_bytes(original+b'x')
        with self.assertRaisesRegex(ValueError,'Changed dataset'):verified_manifest(self.root)
        path.write_bytes(original)
        manifest['models'][0]['files'][0]['path']='../outside.shp'
        (self.root/'manifest.json').write_text(json.dumps(manifest),encoding='utf8')
        with self.assertRaisesRegex(ValueError,'Unexpected file paths'):verified_manifest(self.root)
    def test_fake_adapter_warmup_repeats_geometry_and_scope(self):
        adapter=Adapter(self.root)
        with contextlib.redirect_stdout(io.StringIO()):result=run(self.root,adapter)
        self.assertEqual(adapter.copy_calls,36)
        self.assertEqual(adapter.open_cursors,0)
        self.assertEqual(len(result['results']),6)
        for row in result['results']:
            self.assertEqual(len(row['read_ms']),5);self.assertEqual(len(row['copy_ms']),5)
            self.assertTrue(row['copy_coordinates_identical']);self.assertTrue(all(v>0 for v in row['copy_output_bytes']))
        self.assertIn('topology',result['scope'])
        self.assertEqual(adapter.assert_fields,['SHAPE@','SAMPLE_ID'])
    def test_copy_coordinate_corruption_stops_without_a_result(self):
        adapter=Adapter(self.root);adapter.broken_copy=True
        with self.assertRaisesRegex(ValueError,'coordinate multiset'):run(self.root,adapter)
        self.assertEqual(adapter.copy_calls,1);self.assertEqual(adapter.open_cursors,0)
    def test_coordinate_multiset_preserves_duplicate_controls_and_height(self):
        values=[(1.,2.,3.),(1.,2.,3.),(4.,5.,6.)]
        self.assertEqual(coordinate_digest(values),coordinate_digest(values[::-1]))
        self.assertNotEqual(coordinate_digest(values),coordinate_digest(values[1:]))
        self.assertNotEqual(coordinate_digest(values),coordinate_digest([(1.,2.,3.1),*values[1:]]))


if __name__=='__main__':unittest.main()
