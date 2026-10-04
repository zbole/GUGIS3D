import json
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from app.city_models import CityDocument
from app.services.city_archive import archive_bytes
from app.services.render_profiles import PROFILE_PATH, read_profiles, resolve_tile_size
from app.services.render_tiles import validate_package

ROOT = Path(__file__).resolve().parents[2]


class RenderProfileTests(unittest.TestCase):
    def test_bad_profiles_and_nonfinite_sizes_are_rejected(self):
        profiles = json.loads(PROFILE_PATH.read_bytes())
        with TemporaryDirectory() as temp:
            path = Path(temp) / 'profiles.json'
            for changed in [dict(profiles, schema='unknown'),
                            dict(profiles, tile_size_m={}),
                            dict(profiles, tile_size_m={**profiles['tile_size_m'], 'york': True}),
                            dict(profiles, tile_size_m={**profiles['tile_size_m'], 'york': 10001})]:
                path.write_text(json.dumps(changed), encoding='utf-8')
                with self.assertRaises(ValueError):
                    read_profiles(path)
        for value in [True, None, 'NaN', 'Infinity', 0, 9, 10001, 'automatic']:
            with self.assertRaises(ValueError):
                resolve_tile_size(value, 'york')

    def test_default_cli_builds_real_package_without_changing_source(self):
        document = CityDocument.model_validate({'format': 'gugis-city', 'version': '1.0',
            'coordinate_system': 'ENU_METERS_WGS84', 'name': 'Test snapshot',
            'assets': {'a': {'format': 'gugis-studio', 'version': '1.2',
                'coordinate_system': 'ENU_METERS_WGS84', 'parameters': {'name': 'Test', 'kind': 'urban', 'floors': 1, 'units': 1},
                'templates': {'box': {'kind': 'box', 'color': '#aaaaaa', 'size': [5, 5, 10]}},
                'overview': {'box': {'kind': 'box', 'color': '#aaaaaa', 'size': [5, 5, 10]}},
                'nodes': [{'id': 'root', 'name': 'Building', 'category': 'building'},
                          {'id': 'unit', 'name': 'Unit', 'category': 'unit', 'parent': 'root', 'unit': 1},
                          {'id': 'floor', 'name': 'Floor', 'category': 'floor', 'parent': 'unit', 'unit': 1, 'floor': 1},
                          {'id': 'room', 'name': 'Room', 'category': 'room', 'parent': 'floor', 'unit': 1, 'floor': 1},
                          {'id': 'body', 'name': 'Body', 'category': 'wall', 'parent': 'room', 'unit': 1, 'floor': 1,
                           'template': 'box', 'position': [0, 0, 0]}]}},
            'instances': [{'id': 'i', 'name': 'Building', 'asset': 'a', 'longitude': -1.083, 'latitude': 53.9595}]})
        with TemporaryDirectory() as temp:
            root = Path(temp); source = root / 'source.gugis.json'; cache = root / 'cache'
            content = archive_bytes(document); source.write_bytes(content)
            command = [sys.executable, str(ROOT / 'data-pipeline/build_render_tiles.py'),
                       str(source), '--city', 'york', '--output', str(cache)]
            result = subprocess.run(command, capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)
            summary = json.loads(result.stdout)
            self.assertEqual(summary['tile_size_m'], 125)
            self.assertEqual(summary['tile_size_selection'], 'city-profile')
            manifest = json.loads((Path(summary['path']) / 'manifest.json').read_bytes())
            self.assertEqual(manifest['grid']['tile_size_m'], 125)
            self.assertEqual(manifest['counts']['buildings'], 1)
            validate_package(Path(summary['path']), expected_city='york', expected_revision=summary['revision'])
            self.assertEqual(source.read_bytes(), content)
            # Invalid configuration fails before publication and leaves the active package intact.
            before = (cache / 'york/active.json').read_bytes()
            bad = subprocess.run(command + ['--tile-size', 'NaN'], capture_output=True, text=True, timeout=30)
            self.assertEqual(bad.returncode, 2)
            self.assertEqual((cache / 'york/active.json').read_bytes(), before)
            self.assertEqual(source.read_bytes(), content)
