import json
import unittest
from collections import Counter
from pathlib import Path
import numpy as np
from pydantic import ValidationError
from app.environment_models import Terrain, TerrainPatch, Environment, FeatureAsset
from app.services.terrain_builder import demo_terrain, from_grid, import_dem, upgrade_legacy_fans
from app.services.city_archive import load_city, archive_bytes


class EnvironmentTests(unittest.TestCase):
    def test_demo_uses_two_topologies_with_shared_edges(self):
        terrain=demo_terrain()
        self.assertEqual(set(p.kind for p in terrain.patches),{'ruled-strip','triangle-strip'})
        edges=Counter(tuple(sorted(e)) for p in terrain.patches for a,b,c in p.faces() for e in [(a,b),(b,c),(c,a)])
        self.assertTrue(all(n<=2 for n in edges.values()))
        self.assertEqual(sum(n==1 for n in edges.values()),52*4)
        self.assertTrue(terrain.demonstration)

    def test_legacy_fan_upgrade_preserves_exact_faces_and_control_points(self):
        x,y=np.meshgrid(np.arange(3),np.arange(3))
        points=[[float(a),float(b),float(a*a+b)] for a,b in zip(x.flat,y.flat)]
        legacy=Terrain(name='Legacy',longitude=0,latitude=0,vertical_datum='local',
                       reference_height=0,demonstration=True,source={},points=points,
                       patches=[TerrainPatch(id='fan',kind='triangle-fan',hub=4,
                                             ring=[0,1,2,5,8,7,6,3])])
        upgraded=upgrade_legacy_fans(legacy)
        self.assertEqual(upgraded.points,legacy.points)
        self.assertEqual(len(upgraded.patches),3)
        self.assertEqual({p.kind for p in upgraded.patches},{'triangle-strip'})
        before=Counter(tuple(sorted(face)) for p in legacy.patches for face in p.faces())
        after=Counter(tuple(sorted(face)) for p in upgraded.patches for face in p.faces())
        self.assertEqual(after,before)
        self.assertIs(upgrade_legacy_fans(upgraded),upgraded)

    def test_nodata_is_not_bridged(self):
        x,y=np.meshgrid(np.arange(5),np.arange(5));z=x+y+0.0;z[2,2]=np.nan
        terrain=from_grid(x,y,z,name='Hole',longitude=0,latitude=0,datum='local',demonstration=True,source={})
        self.assertEqual(len(terrain.points),24)
        for p in terrain.patches:
            for f in p.faces():
                points=[terrain.points[i] for i in f]
                self.assertFalse(min(a[0] for a in points)<2<max(a[0] for a in points) and min(a[1] for a in points)<2<max(a[1] for a in points))
        bad=terrain.model_dump();bad['patches'][0]['indices']=[0,0,999]
        with self.assertRaises(ValidationError):Terrain.model_validate(bad)

    def test_ascii_import_handles_cell_centres_crs_and_nodata(self):
        content=b'ncols 5\nnrows 5\nxllcorner 357900\nyllcorner 173000\ncellsize 10\nNODATA_value -9999\n10 11 12 13 14\n11 12 13 14 15\n12 13 -9999 15 16\n13 14 15 16 17\n14 15 16 17 18\n'
        terrain=import_dem(content,'test.asc','EPSG:27700','ODN',1)
        self.assertFalse(terrain.demonstration);self.assertEqual(terrain.vertical_datum,'ODN');self.assertEqual(len(terrain.points),24)
        self.assertEqual(terrain.points[0][2],14);self.assertEqual(terrain.points[-1][2],14)
        self.assertGreater(terrain.points[4][0],terrain.points[0][0])
        self.assertGreater(terrain.points[-1][1],terrain.points[0][1])
        with self.assertRaises(ValueError):import_dem(b'<VRTDataset/>','unsafe.vrt')

    def test_function_presets_and_archive_roundtrip(self):
        root=Path(__file__).resolve().parents[2]
        presets=json.loads((root/'shared/function-features.json').read_text(encoding='utf-8'))
        assets={k:FeatureAsset.model_validate(v) for k,v in presets.items()}
        env=Environment(terrain=demo_terrain(),feature_assets=assets)
        city=load_city(dict(format='gugis-city',version='1.0',coordinate_system='ENU_METERS_WGS84',name='Test',assets={},instances=[],roads=[],metadata={},environment=env.model_dump()))
        encoded=archive_bytes(city);self.assertEqual(json.loads(encoded)['version'],'1.2')
        restored=load_city(encoded);self.assertEqual(restored.environment,env)
        self.assertEqual(encoded,archive_bytes(restored))
        bad=presets['lamp'];bad['components'][0]['parameters']['radius']=-1
        with self.assertRaises(ValidationError):FeatureAsset.model_validate(bad)

    def test_downsampling_preserves_missing_pixels_that_nearest_sampling_would_skip(self):
        from rasterio.io import MemoryFile
        from rasterio.transform import from_origin
        values=np.full((400,400),10,dtype=np.float32);values[121,121]=-9999
        with MemoryFile() as mem:
            with mem.open(driver='GTiff',width=400,height=400,count=1,dtype='float32',crs='EPSG:4326',
                          transform=from_origin(-.14,51.51,.00005,.00005),nodata=-9999) as ds:
                ds.write(values,1)
            with mem.open() as ds:
                self.assertFalse(np.any(ds.read(1,out_shape=(4,4),masked=True).mask), 'reproduce the nearest-sampling omission')
            terrain=import_dem(mem.read(),'qa-hole.tif',stride=100,
                               clip_bounds=(-.14,51.49,-.12,51.51),center=(-.13,51.5))
        self.assertEqual(len(terrain.points),15)
        self.assertEqual(terrain.source['无效源像元'],'1')
        self.assertEqual(terrain.source['剔除采样控制点'],'1')
        self.assertIn('可能扩大缺测边缘',terrain.source['NoData处理'])
        # The missing interior control point excludes its four adjacent quads.
        self.assertEqual(sum(1 for p in terrain.patches for _ in p.faces()),10)

    def test_conservative_mask_covers_fractional_bins_across_native_chunk_boundaries(self):
        from rasterio.io import MemoryFile
        from rasterio.transform import from_origin
        from rasterio.windows import Window
        from app.services.terrain_builder import _conservative_sample_mask
        # 513/6=85.5: source pixel 256 straddles the reduced-bin and native-block boundaries.
        values=np.full((513,513),10,dtype=np.float32);values[256,256]=np.nan
        with MemoryFile() as mem:
            with mem.open(driver='GTiff',width=513,height=513,count=1,dtype='float32',
                          transform=from_origin(0,513,1,1)) as ds:
                ds.write(values,1)
            with mem.open() as ds:
                reads=[]
                class TrackedReader:
                    def read(self, *args, **kwargs):
                        reads.append(kwargs['window'])
                        return ds.read(*args, **kwargs)
                missing,count=_conservative_sample_mask(TrackedReader(),Window(0,0,513,513),6,6)
                self.assertEqual(count,1)
                self.assertEqual(set(zip(*np.nonzero(missing))),{(2,2),(2,3),(3,2),(3,3)})
                self.assertEqual(len(reads),9)
                self.assertTrue(all(w.width<=256 and w.height<=256 for w in reads))
                cropped,cropped_count=_conservative_sample_mask(ds,Window(256,256,200,200),2,2)
                self.assertEqual(cropped_count,1)
                self.assertEqual(set(zip(*np.nonzero(cropped))),{(0,0)})

    def test_source_pixel_budget_prevents_decompressing_an_oversized_crop(self):
        from unittest.mock import MagicMock, patch
        from rasterio.transform import from_origin
        dataset=MagicMock();dataset.count=1;dataset.crs='EPSG:4326';dataset.width=8000;dataset.height=8000
        dataset.transform=from_origin(-.138,51.508,.015/8000,.012/8000)
        with patch('rasterio.io.MemoryFile') as memory:
            memory.return_value.__enter__.return_value.open.return_value.__enter__.return_value=dataset
            with self.assertRaisesRegex(ValueError,'缺测检查预算'):
                import_dem(b'II*\x00','qa-large.tif',stride=100,clip_bounds=(-.138,51.496,-.123,51.508))
        dataset.read.assert_not_called()

    def test_dem_stride_is_validated_before_sampling(self):
        for stride in (0,101,1.5,True):
            with self.assertRaisesRegex(ValueError,'采样步长'):
                import_dem(b'', 'qa.asc', stride=stride)

    def test_geotiff_metadata_and_half_pixel_locations(self):
        from rasterio.io import MemoryFile
        from rasterio.transform import from_origin
        from pyproj import Transformer
        values=np.arange(25,dtype=np.float32).reshape(5,5)
        with MemoryFile() as mem:
            with mem.open(driver='GTiff',width=5,height=5,count=1,dtype='float32',crs='EPSG:27700',transform=from_origin(357900,173050,10,10),nodata=-9999) as dataset:
                dataset.write(values,1)
            content=mem.read()
        terrain=import_dem(content,'test.tif','', 'ODN',1)
        self.assertEqual(len(terrain.points),25)
        self.assertEqual(terrain.points[0][2],20)
        self.assertEqual(terrain.points[-1][2],4)
        self.assertIn('27700',terrain.source['源坐标系'])
        self.assertEqual(terrain.source['SHA256'],__import__('hashlib').sha256(content).hexdigest())

    def test_city_12_save_reload_export_and_old_version_guard(self):
        from fastapi.testclient import TestClient
        from app.main import app
        from app.routers import city as routes
        from tempfile import TemporaryDirectory
        from unittest.mock import patch
        payload=dict(format='gugis-city',version='1.0',coordinate_system='ENU_METERS_WGS84',name='Environment test',assets={},instances=[],roads=[],metadata={})
        with TemporaryDirectory() as directory, patch.object(routes,'CITY_DIR',Path(directory)), TestClient(app) as client:
            Path(directory,'current.gugis.json').write_bytes(archive_bytes(load_city(payload)))
            response=client.get('/city/current').json()
            payload['environment']=Environment(terrain=demo_terrain()).model_dump(mode='json',exclude_none=True)
            saved=client.post('/city/current',json={'base_revision':response['revision'],'document':payload})
            self.assertEqual(saved.status_code,200,saved.text)
            restored=client.get('/city/current').json()['document']
            self.assertEqual(restored['version'],'1.2')
            self.assertEqual(restored['environment'],payload['environment'])
            self.assertEqual(client.get('/city/export').json(),restored)
            restored['version']='1.1'
            self.assertEqual(client.post('/city/validate',json=restored).status_code,422)

if __name__=='__main__':unittest.main()
