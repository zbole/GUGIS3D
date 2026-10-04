"""Exact geometry, full costs and native recovery of published ArcGIS files."""
import hashlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile
import numpy as np
import shapefile
from pyproj import CRS
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'data-pipeline'))
from export_raster_multipatch import readback_heights, recover_native, packed, triangles_digest


class RasterMultipatchTests(unittest.TestCase):
    def test_exact_geometry_georeferencing_recovery_and_reported_costs(self):
        digest=lambda value:hashlib.sha256(value).hexdigest()
        report=json.loads((ROOT/'shared/raster-multipatch-benchmark.json').read_bytes())
        parent=(ROOT/'shared/raster-triangle-benchmark.json').read_bytes()
        self.assertEqual(report['parent_sha256'],digest(parent))
        self.assertEqual(report['origin_xy'],[2494500.25,1141499.75])
        self.assertIsNone(report['arcgis_execution'])
        self.assertEqual(len(report['variants']),4)
        for path,sha in report['source_fingerprints'].items():
            self.assertEqual(sha,digest((ROOT/path).read_bytes().replace(b'\r\n',b'\n')))
        for row in report['variants']:
            public=ROOT/'frontend/public/research/hybrid-terrain'
            raw=(public/row['download']['filename']).read_bytes()
            self.assertEqual(digest(raw),row['download']['sha256'])
            self.assertEqual(len(raw),row['download']['bytes'])
            with ZipFile(io.BytesIO(raw)) as archive:
                components=row['components']
                self.assertEqual({p['filename'].rsplit('.',1)[1] for p in components},{'shp','shx','dbf','prj','cpg'})
                for item in components+[row['native_recovery']]:
                    content=archive.read(item['filename'])
                    self.assertEqual(len(content),item['bytes']);self.assertEqual(digest(content),item['sha256'])
                self.assertEqual(row['core_bytes'],sum(p['bytes'] for p in components))
                self.assertEqual(row['with_native_recovery_bytes'],row['core_bytes']+row['native_recovery']['bytes'])
                self.assertEqual(CRS.from_wkt(archive.read('terrain.prj').decode()).to_epsg(),2056)
                reader=shapefile.Reader(shp=io.BytesIO(archive.read('terrain.shp')),shx=io.BytesIO(archive.read('terrain.shx')),dbf=io.BytesIO(archive.read('terrain.dbf')))
                self.assertEqual(len(reader),1);self.assertEqual(reader.shapeType,31)
                shape=reader.shape(0);self.assertTrue(all(p==0 for p in shape.partTypes))
                parts=[[[*xy,z] for xy,z in zip(shape.points[a:b],shape.z[a:b])]
                    for a,b in zip(shape.parts,[*shape.parts[1:],len(shape.points)])]
                geometry=triangles_digest(parts)
                self.assertEqual(geometry['triangles'],row['triangles'])
                self.assertEqual(geometry['oriented_triangle_multiset_sha256'],row['oriented_triangle_multiset_sha256'])
                native=archive.read('native.json')
                recovered=packed(recover_native(parts,json.loads(archive.read('native-recovery.json'))))
                self.assertEqual(native,recovered)
                self.assertEqual(native,(public/'models/swiss-dem-crop'/row['native_filename']).read_bytes())
                self.assertEqual(digest(native),row['native_sha256'])
                fixture_bytes=archive.read('query-fixture.json');fixture=json.loads(fixture_bytes)
                self.assertEqual(digest(fixture_bytes),row['offgrid']['fixture_sha256'])
                # Read a deterministic subset through the saved XYZ parser.
                sites=np.asarray(fixture['xy'])[::32]
                actual=readback_heights(parts,sites,report['origin_xy'])
                error=np.abs(actual-np.asarray(fixture['reference'])[::32])
                self.assertLessEqual(float(error.max()),row['target_m'])
                self.assertEqual(digest(archive.read('reference.npz')),report['source_reference_sha256'])
                self.assertEqual(row['offgrid']['samples'],4096);self.assertEqual(row['source_grid']['samples'],16641)
                self.assertLess(row['offgrid']['native_kernel_max_difference_m'],1e-8)
                self.assertLess(row['source_grid']['native_geometry_max_difference_m'],1e-8)
                self.assertLessEqual(row['continuous_certificate']['max_error_bound_m'],row['target_m'])
                for key,numerator,denominator in [
                    ('native_vs_core_saving_percent',row['native_bytes'],row['core_bytes']),
                    ('native_vs_recoverable_saving_percent',row['native_bytes'],row['with_native_recovery_bytes']),
                    ('hybrid_vs_core_saving_percent',row['compact_hybrid_bytes'],row['core_bytes'])]:
                    self.assertAlmostEqual(row[key],100*(1-numerator/denominator))
                self.assertEqual(row['coordinate_translation_max_difference_m'],0)
                self.assertTrue(row['byte_identical_native_recovery']);self.assertIsNone(row['arcgis_execution'])

    def test_readback_rejects_degenerate_or_reversed_geometry_and_missing_sites(self):
        with self.assertRaisesRegex(ValueError,'Degenerate or reversed'):
            readback_heights([[[0,0,0],[0,1,0],[1,0,0]]],np.asarray([[.2,.2]]),[0,0])
        with self.assertRaisesRegex(ValueError,'missed'):
            readback_heights([[[0,0,0],[1,0,0],[0,1,0]]],np.asarray([[2,2]]),[0,0])


if __name__=='__main__':unittest.main()
