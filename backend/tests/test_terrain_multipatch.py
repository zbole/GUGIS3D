import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

import shapefile

from app.environment_models import Terrain, TerrainPatch
from app.services.terrain_multipatch import export_multipatch


class MultipatchTests(unittest.TestCase):
    def test_export_is_readable_triangle_strip_with_known_height_error(self):
        terrain = Terrain(name='Test saddle', longitude=-2.603, latitude=51.454,
                          vertical_datum='local', reference_height=0,
                          demonstration=True, source={},
                          points=[[0, 0, 0], [10, 0, 0], [0, 10, 0], [10, 10, 0.2]],
                          patches=[TerrainPatch(id='r0', kind='ruled-strip',
                                                left=[0, 1], right=[2, 3])])
        with tempfile.TemporaryDirectory() as temp:
            package = Path(temp) / 'terrain.zip'
            metrics = export_multipatch(terrain, package, city_revision='revision')
            with ZipFile(package) as archive:
                self.assertEqual(set(archive.namelist()),
                                 {'terrain.shp', 'terrain.shx', 'terrain.dbf',
                                  'terrain.prj', 'terrain.cpg'})
                self.assertIn('PROJCS', archive.read('terrain.prj').decode())
                archive.extractall(temp)
            with shapefile.Reader(str(Path(temp) / 'terrain')) as reader:
                self.assertEqual(reader.shapeType, shapefile.MULTIPATCH)
                self.assertEqual(len(reader), 1)
                shape = reader.shape(0)
                self.assertEqual(list(shape.partTypes), [shapefile.TRIANGLE_STRIP] * 2)
                self.assertEqual(list(shape.parts), [0, 6])
                self.assertEqual(reader.record(0)['PATCH_ID'], 'r0')
                self.assertEqual(max(shape.z), 0.2)
                for start in shape.parts:
                    vertices = shape.points[start:start + 6]
                    # The first triangle of every part faces upward in EPSG:27700.
                    a, b, c = vertices[:3]
                    self.assertGreater((b[0]-a[0])*(c[1]-a[1])-
                                       (b[1]-a[1])*(c[0]-a[0]), 0)
            self.assertEqual(metrics['cityRevision'], 'revision')
            self.assertTrue(metrics['readBackVerified'])
            self.assertEqual(metrics['multipatchTriangles'], 8)
            self.assertEqual(metrics['nativeTriangles'], 2)
            self.assertAlmostEqual(metrics['maxRuledHeightErrorMetres'], 0.0125)
            self.assertGreater(metrics['multipatchFilesBytes'], metrics['gugisTerrainBytes'])


if __name__ == '__main__':
    unittest.main()
