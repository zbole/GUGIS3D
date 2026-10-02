import hashlib
import json
import math
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

from app.environment_models import Terrain, TerrainPatch
from app.services.terrain_comparison import (TriangleSurface, compare_queries, circular_difference,
    export_comparison_suite, local_derivatives)
from app.services.terrain_multipatch import export_multipatch


class TerrainComparisonTests(unittest.TestCase):
    def test_derivatives_use_local_axes_circular_angles_and_exclude_boundaries_and_flat_directions(self):
        # A 90-degree grid rotation and scale 2 must not change local slope/aspect.
        slope, aspect = local_derivatives({'gx': -.2, 'gy': .15}, 2, 3, lambda x, y: (-2 * y, 2 * x))
        self.assertAlmostEqual(slope, math.degrees(math.atan(.5)))
        self.assertAlmostEqual(aspect, math.degrees(math.atan2(-.3, -.4)) % 360)
        self.assertEqual(circular_difference(1, 359), 2)
        self.assertEqual(circular_difference(359, 1), -2)
        class Plane:
            def query(self, x, y):
                return {'height': .3*x + .4*y, 'gx': .3, 'gy': .4, 'patch': 'plane', 'onEdge': x == 0} if x >= 0 else None
        points = [{'x': x, 'y': 3, 'height': .3*x + 1.2 if x >= 0 else None,
                   'slope': slope if x >= 0 else None, 'aspect': aspect if x >= 0 else None,
                   'nativeOnEdge': x == 0 if x >= 0 else None} for x in (2, 0, -1)]
        rows, summary = compare_queries(Plane(), points, lambda x, y: (x, y))
        self.assertEqual(summary['derivatives']['slopeMatchedCount'], 1)
        self.assertEqual(summary['derivatives']['boundaryExcludedCount'], 1)
        self.assertAlmostEqual(summary['derivatives']['slope']['rmsDegrees'], 0)
        self.assertAlmostEqual(summary['derivatives']['aspect']['rmsDegrees'], 0)
        self.assertIsNone(rows[-1]['multipatchSlope'])
        self.assertIsNone(rows[-1]['slopeErrorDegrees'])
        flat = [{**points[0], 'slope': .01, 'aspect': 359}]
        _, flat_summary = compare_queries(Plane(), flat, lambda x, y: (x, y))
        self.assertEqual(flat_summary['derivatives']['nearFlatExcludedCount'], 1)
        self.assertIsNone(flat_summary['derivatives']['aspect']['rmsDegrees'])

    def test_actual_file_facet_derivatives_converge_to_native_saddle_without_false_nodata(self):
        from app.services.terrain_multipatch import bng_projector
        terrain = self.terrain()
        points = []
        for x, y in ((2.13, 3.41), (6.28, 8.67), (8.39, 3.27)):
            gx, gy = .002*y, .002*x
            points.append({'x': x, 'y': y, 'height': .002*x*y, 'slope': math.degrees(math.atan(math.hypot(gx, gy))),
                'aspect': math.degrees(math.atan2(-gx, -gy)) % 360, 'nativeOnEdge': False})
        results = []
        with tempfile.TemporaryDirectory() as temp:
            for n in (1, 8):
                root = Path(temp)/f'n{n}'
                package = Path(temp)/f'n{n}.zip'
                export_multipatch(terrain, package, subdivisions=n)
                with ZipFile(package) as z:
                    z.extractall(root)
                _, summary = compare_queries(TriangleSurface(root/'terrain'), points, bng_projector(terrain))
                self.assertEqual(summary['derivatives']['slopeMatchedCount'], 3)
                results.append(summary['derivatives'])
        self.assertLess(results[1]['slope']['rmsDegrees'], results[0]['slope']['rmsDegrees'])
        self.assertLess(results[1]['aspect']['rmsDegrees'], results[0]['aspect']['rmsDegrees'])

    def terrain(self):
        return Terrain(name='Known z = 0.002xy saddle', longitude=-2.603, latitude=51.454,
            vertical_datum='local', reference_height=0, demonstration=True, source={},
            points=[[0, 0, 0], [10, 0, 0], [0, 10, 0], [10, 10, .2]],
            patches=[TerrainPatch(id='saddle', kind='ruled-strip', left=[0, 1], right=[2, 3])])

    def test_real_four_resolution_readback_reduces_known_saddle_error_and_keeps_nodata(self):
        points = [{'id': f'q{i}', 'x': x, 'y': y, 'height': z,
                   'patch': 'saddle' if z is not None else None, 'kind': 'ruled-strip' if z is not None else None}
                  for i, (x, y, z) in enumerate([(5, 5, .05), (2.5, 2.5, .0125), (7.5, 7.5, .1125), (-10, -10, None)])]
        fixture = {'schema': 'gugis-terrain-query-fixture-v1', 'cityRevision': 'a' * 64,
            'nativeKernel': 'known analytic saddle', 'points': points, 'statistics': {}, 'worstRuledCell': None,
            'profiles': [{'id': 'cell', 'name': 'Known diagonal', 'points': [{**p, 'distance': i * 2} for i, p in enumerate(points)]}]}
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            script = root / 'run_arcgis_pro.py'
            script.write_text('# test packaging only', encoding='utf-8')
            package = root / 'suite.zip'
            report = export_comparison_suite(self.terrain(), fixture, package, arcgis_script=script)
            variants = report['variants']
            self.assertEqual([v['ruledSubdivisions'] for v in variants], [1, 2, 4, 8])
            self.assertAlmostEqual(variants[0]['queries']['sampledMaxAbsHeightErrorMetres'], .05, places=6)
            self.assertAlmostEqual(variants[1]['queries']['sampledMaxAbsHeightErrorMetres'], .0125, places=6)
            self.assertLess(variants[2]['queries']['sampledMaxAbsHeightErrorMetres'], 1e-6)
            for v in variants:
                self.assertEqual(v['queries']['matchedCount'], 3)
                self.assertEqual(v['queries']['coverageMismatchCount'], 0)
                self.assertEqual(v['profiles'][0]['samples'][-1]['height'], None)
                self.assertEqual(v['profiles'][0]['samples'][-1]['multipatchHeight'], None)
                self.assertAlmostEqual(v['maxRuledHeightErrorMetres'], .05 / v['ruledSubdivisions']**2)
            self.assertEqual(report['arcgisRuntimeStatus'], 'not-measured')
            self.assertEqual(report['packageSha256'], hashlib.sha256(package.read_bytes()).hexdigest())
            repeated = export_comparison_suite(self.terrain(), fixture, root/'repeat.zip', arcgis_script=script)
            self.assertEqual(report['bundleId'], repeated['bundleId'])
            self.assertEqual(report['packageSha256'], repeated['packageSha256'])
            # The same dataset with changed experiment code is a different experiment.
            script.write_text('# changed experiment script', encoding='utf-8')
            changed = export_comparison_suite(self.terrain(), fixture, root/'changed.zip', arcgis_script=script)
            self.assertNotEqual(report['bundleId'], changed['bundleId'])
            with ZipFile(package) as archive:
                self.assertIn('run_arcgis_pro.py', archive.namelist())
                self.assertIn('native-terrain.gugis.json', archive.namelist())
                self.assertEqual(json.loads(archive.read('comparison-report.json'))['bundleId'], report['bundleId'])
                for v in variants:
                    for file in v['files']:
                        content = archive.read(file['path'])
                        self.assertEqual(len(content), file['bytes'])
                        self.assertEqual(hashlib.sha256(content).hexdigest(), file['sha256'])

    def test_invalid_tessellation_never_writes_an_excessive_or_fractional_mesh(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'invalid.zip'
            for value in (0, 9, 1.5, True):
                with self.assertRaises(ValueError):
                    export_multipatch(self.terrain(), path, subdivisions=value)
            self.assertFalse(path.exists())
