import copy
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from app.main import app
from app.city_models import CityDocument
from app.services.city_archive import archive_bytes, encode
from app.services.city_generator import city_bytes
from app.services.box_parameters import box_set_mesh
from app.services.render_tiles import (RenderPackageError, RenderTileOverflow, TileLimits,
    build_package, digest, validate_package)
from app.routers import city, render_tiles


def fixture():
    vertices, triangles = box_set_mesh([[-5, -3, 0, 5, 3, 10]])
    sloped = copy.deepcopy(vertices)
    for point in sloped[4:]:
        point[0] += 1.5
    solids = {'box': {'kind': 'box', 'color': '#112233', 'size': [14, 6, 9]},
              'boxset': {'kind': 'mesh', 'color': '#445566', 'vertices': vertices, 'triangles': triangles},
              'slope': {'kind': 'mesh', 'color': '#778899', 'vertices': sloped, 'triangles': triangles}}
    building = {'format': 'gugis-studio', 'version': '1.2', 'coordinate_system': 'ENU_METERS_WGS84',
        'parameters': {'name': 'Original building', 'kind': 'urban', 'floors': 1, 'units': 1},
        'templates': solids, 'overview': solids,
        'nodes': [{'id': 'root', 'name': 'Building', 'category': 'building'},
                  {'id': 'unit', 'name': 'Unit', 'category': 'unit', 'unit': 1, 'parent': 'root'},
                  {'id': 'floor', 'name': 'Floor', 'category': 'floor', 'unit': 1, 'floor': 1, 'parent': 'unit'},
                  {'id': 'room', 'name': 'Room', 'category': 'room', 'unit': 1, 'floor': 1, 'parent': 'floor'},
                  *[{'id': f'node_{key}', 'name': key, 'category': 'wall', 'unit': 1, 'floor': 1, 'parent': 'room',
                     'template': key, 'position': [20 + i, -10, 7], 'rotation_z': 37.5} for i, key in enumerate(solids)]]}
    empty, absent = copy.deepcopy(building), copy.deepcopy(building)
    empty['overview'] = {}
    del absent['overview']
    return CityDocument.model_validate({'format': 'gugis-city', 'version': '1.0',
        'coordinate_system': 'ENU_METERS_WGS84', 'name': 'Render fixture',
        'assets': {'authored': building, 'empty': empty, 'absent': absent},
        'instances': [{'id': key, 'asset': key, 'name': key, 'longitude': 0, 'latitude': 0, 'heading': 21, 'altitude': 5}
                      for key in ['authored', 'empty', 'absent']],
        'metadata': {'source': '© OpenStreetMap contributors · ODbL 1.0', 'license': 'ODbL 1.0',
                     '精度说明': 'OSM footprints; inferred details, not surveyed geometry'}})


class RenderTilesTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'seed.gugis.json'
        self.cache = self.root / 'render-cache'
        self.original = archive_bytes(fixture())
        self.source.write_bytes(self.original)

    def build(self, **kwargs):
        return build_package(self.source, self.cache, 'bristol', **kwargs)

    def tile(self, manifest, index=0):
        return json.loads((self.cache / 'bristol' / manifest['revision'] / 'tiles' / f"{manifest['tiles'][index]['id']}.json").read_bytes())

    def test_exact_overview_mesh_boxset_and_full_fallback_transforms(self):
        manifest = self.build()
        payload = json.loads(self.original)
        assets, geometry, instances = {}, {}, {}
        for index in range(len(manifest['tiles'])):
            tile = self.tile(manifest, index)
            assets.update(tile['assets']); geometry.update(tile['geometry_library'])
            instances.update({p['id']: p for p in tile['instances']})
        self.assertEqual(manifest['revision'], digest(self.original))
        self.assertEqual(manifest['source_sha256'], digest(self.original))
        self.assertEqual(set(instances), {p.id for p in fixture().instances})
        self.assertEqual(set(assets), set(fixture().assets))
        self.assertEqual({g['kind'] for g in geometry.values()}, {'box', 'mesh', 'box-set'})
        for asset_id, asset in assets.items():
            original = payload['assets'][asset_id]
            self.assertEqual(asset['quality'], 'overview' if asset_id == 'authored' else 'full-fallback')
            expected = original.get('overview') or original['templates']
            for p in asset['primitives']:
                for key, value in expected[p['template_id']].items():
                    self.assertEqual(p[key], value)
                self.assertEqual(geometry[p['geometry']], payload['geometry_library'][p['geometry']])
                if asset_id == 'authored':
                    self.assertEqual(p['position'], [0, 0, 0]); self.assertEqual(p['rotation_z'], 0)
                    self.assertIsNone(p['node_id'])
                else:
                    node = next(n for n in original['nodes'] if n['id'] == p['node_id'])
                    self.assertEqual(p['position'], node['position']); self.assertEqual(p['rotation_z'], node['rotation_z'])
        self.assertEqual(manifest['counts']['overview_buildings'], 1)
        self.assertEqual(manifest['counts']['full_fallback_buildings'], 2)
        self.assertEqual(manifest['attribution']['metadata'], payload['metadata'])
        self.assertEqual(self.source.read_bytes(), self.original)

    def test_deterministic_immutable_rebuild_and_configuration_collision(self):
        first = self.build()
        self.assertEqual(first, self.build())
        self.assertEqual(first, build_package(self.source, self.root / 'other', 'bristol'))
        pointer = (self.cache / 'bristol' / 'active.json').read_bytes()
        with self.assertRaisesRegex(RenderPackageError, 'Immutable revision'):
            self.build(tile_size_m=100)
        self.assertEqual((self.cache / 'bristol' / 'active.json').read_bytes(), pointer)
        self.assertFalse(list((self.cache / 'bristol').glob('.build-*')))

    def test_exact_revision_quality_warnings_and_layer_limits_are_explicit(self):
        warnings = [{'code': 'seed-warning', 'message': 'Known source limit', 'osm_ids': [123]}]
        with patch('app.services.render_tiles.quality_warnings', return_value=warnings) as audit:
            manifest = self.build()
        audit.assert_called_once_with('bristol', digest(self.original))
        self.assertEqual(manifest['quality_warnings'], warnings)
        self.assertEqual(manifest['quality_warnings_source_revision'], manifest['revision'])
        self.assertEqual(manifest['layers']['buildings'], 'included')
        self.assertEqual(manifest['layers']['roads'], 'not-included')
        self.assertEqual(manifest['layers']['terrain'], 'not-included')

    def test_legacy_city_keeps_geometry_and_local_transforms(self):
        self.source.write_bytes(city_bytes(fixture()))
        manifest = self.build()
        assets, library = {}, {}
        for i in range(len(manifest['tiles'])):
            tile = self.tile(manifest, i); assets.update(tile['assets']); library.update(tile['geometry_library'])
        for p in assets['authored']['primitives']:
            expected = fixture().assets['authored'].overview[p['template_id']]
            actual = library[p['geometry']]
            if actual['kind'] == 'mesh':
                self.assertEqual(actual['vertices'], [list(v) for v in expected.vertices])
                self.assertEqual(actual['triangles'], [list(t) for t in expected.triangles])
            else:
                self.assertEqual(p['size'], list(expected.size))
        validate_package(self.cache / 'bristol' / manifest['revision'], expected_city='bristol', expected_revision=manifest['revision'])

    def test_spanning_building_present_in_every_intersecting_cell(self):
        value = fixture().model_dump(mode='json')
        value['instances'] = [dict(value['instances'][0], longitude=0, latitude=0, heading=90, altitude=0)]
        value['assets']['authored']['overview'] = {'wide': {'kind': 'box', 'color': '#ff0000', 'size': [600, 20, 10]}}
        self.source.write_bytes(city_bytes(CityDocument.model_validate(value)))
        manifest = self.build()
        self.assertEqual({tuple(t['grid']) for t in manifest['tiles']}, {(x, y) for x in (-1, 0) for y in (-2, -1, 0, 1)})
        for index, wanted in [(0, -10), (1, -300), (4, 300)]:
            self.assertAlmostEqual(manifest['bounds_enu'][index], wanted, places=4)
        for i in range(len(manifest['tiles'])):
            self.assertEqual([p['id'] for p in self.tile(manifest, i)['instances']], ['authored'])
        self.assertGreater(manifest['counts']['tile_building_references'], manifest['counts']['buildings'])
        self.assertEqual(manifest['dedupe_identity'], ['city_id', 'revision', 'instances[].id'])

    def test_bounds_include_component_rotation_translation_and_altitude(self):
        value = fixture().model_dump(mode='json')
        value['instances'] = [dict(value['instances'][1], heading=90, altitude=11)]
        asset = value['assets']['empty']; component = asset['nodes'][-3]
        asset['nodes'] = asset['nodes'][:4] + [dict(component, position=[300, -100, 20], rotation_z=90)]
        asset['templates']['box']['size'] = [20, 10, 6]
        self.source.write_bytes(city_bytes(CityDocument.model_validate(value)))
        manifest = self.build()
        for got, wanted in zip(manifest['bounds_enu'], [-110, -305, 28, -90, -295, 34]):
            self.assertAlmostEqual(got, wanted, places=4)

    def test_overflow_fails_without_partial_publication_or_silent_drops(self):
        for limits in [TileLimits(max_buildings=1), TileLimits(max_primitives=1), TileLimits(max_bytes=100), TileLimits(max_tiles=1)]:
            with self.subTest(limits=limits), self.assertRaises(RenderTileOverflow) as error:
                self.build(limits=limits)
            self.assertTrue(error.exception.tiles); self.assertFalse(self.cache.exists())
        self.build()
        pointer = (self.cache / 'bristol' / 'active.json').read_bytes()
        with self.assertRaises(RenderTileOverflow):
            self.build(limits=TileLimits(max_bytes=100))
        self.assertEqual((self.cache / 'bristol' / 'active.json').read_bytes(), pointer)

    def test_source_mismatch_invalid_or_draped_source_rejected(self):
        source = json.loads(self.original); source['metadata']['city_id'] = 'london'
        self.source.write_bytes(encode(source))
        with self.assertRaisesRegex(RenderPackageError, 'city_id'):
            self.build()
        source['metadata'].pop('city_id'); source['environment'] = {'drape_buildings': True}; source['version'] = '1.2'
        self.source.write_bytes(encode(source))
        with self.assertRaisesRegex(RenderPackageError, 'draped'):
            self.build()
        self.source.write_bytes(b'{"invalid":true}')
        with self.assertRaises(ValueError):
            self.build()
        self.assertFalse(self.cache.exists())

    def test_unused_assets_and_unrelated_metadata_are_not_exported(self):
        value = fixture().model_dump(mode='json')
        value['assets']['unused'] = copy.deepcopy(value['assets']['authored'])
        value['metadata']['analysis_private_note'] = 'Do not copy unrelated saved analysis'
        self.source.write_bytes(city_bytes(CityDocument.model_validate(value)))
        manifest = self.build()
        self.assertEqual(manifest['counts']['assets'], 3)
        self.assertNotIn('analysis_private_note', manifest['attribution']['metadata'])
        for index in range(len(manifest['tiles'])):
            self.assertNotIn('unused', self.tile(manifest, index)['assets'])
        value['instances'] = []
        self.source.write_bytes(city_bytes(CityDocument.model_validate(value)))
        empty = self.build()
        self.assertEqual(empty['counts']['assets'], 0)
        self.assertEqual(empty['tiles'], [])

    def test_source_byte_limit_is_bounded_before_validation(self):
        with patch('app.services.render_tiles.MAX_SOURCE_BYTES', 64), self.assertRaisesRegex(RenderPackageError, '128 MiB'):
            self.build()
        self.assertFalse(self.cache.exists())
        self.assertEqual(self.source.read_bytes(), self.original)

    def test_empty_city_builds_explicit_empty_package(self):
        self.source.write_bytes(archive_bytes(CityDocument(format='gugis-city', version='1.0', coordinate_system='ENU_METERS_WGS84', name='Empty', assets={}, instances=[])))
        manifest = self.build()
        self.assertEqual(manifest['tiles'], []); self.assertEqual(manifest['counts']['buildings'], 0)
        self.assertIsNone(manifest['bounds_enu'])

    def test_source_inside_cache_rejected_before_overwrite(self):
        self.cache.mkdir(); self.source = self.cache / 'source.json'; self.source.write_bytes(self.original)
        with self.assertRaisesRegex(RenderPackageError, 'outside'):
            self.build()
        self.assertEqual(self.source.read_bytes(), self.original)

    def test_corrupt_package_validation_rejects_tile_hash(self):
        manifest = self.build(); path = self.cache / 'bristol' / manifest['revision']
        tile = path / 'tiles' / f"{manifest['tiles'][0]['id']}.json"; tile.write_bytes(tile.read_bytes() + b' ')
        with self.assertRaises(RenderPackageError):
            validate_package(path, expected_city='bristol', expected_revision=manifest['revision'])

    def client(self):
        for module, name, value in [(render_tiles, 'CACHE_ROOT', self.cache), (city, 'CITY_DIR', self.root / 'formal' / 'city'), (city, 'SEED', self.source)]:
            helper = patch.object(module, name, value); helper.start(); self.addCleanup(helper.stop)
        return TestClient(app)

    def test_endpoints_never_initialize_or_parse_city_and_support_etags(self):
        manifest = self.build(); client = self.client()
        with patch('app.services.render_tiles.load_city', side_effect=AssertionError('No city parse on read')), patch.object(city, 'read_current', side_effect=AssertionError('No initialization')):
            response = client.get('/cities/bristol/render/manifest')
            self.assertEqual(response.status_code, 200, response.text); self.assertEqual(response.json(), manifest)
            self.assertEqual(response.headers['x-render-freshness'], 'current'); self.assertEqual(response.headers['cache-control'], 'no-cache')
            self.assertEqual(client.get('/cities/bristol/render/manifest', headers={'If-None-Match': 'W/' + response.headers['etag']}).status_code, 304)
            descriptor = manifest['tiles'][0]; tile = client.get(descriptor['url'])
            self.assertEqual(tile.status_code, 200); self.assertEqual(digest(tile.content), descriptor['sha256'])
            self.assertEqual(tile.headers['cache-control'], 'private, max-age=31536000, immutable')
            self.assertEqual(client.get(descriptor['url'], headers={'If-None-Match': tile.headers['etag']}).status_code, 304)
        self.assertFalse((self.root / 'formal').exists()); self.assertEqual(self.source.read_bytes(), self.original)

    def test_unknown_stale_and_unbuilt_are_explicit_without_writes(self):
        client = self.client(); result = client.get('/cities/bristol/render/manifest')
        self.assertEqual(result.status_code, 404)
        self.assertEqual(result.json()['detail']['code'], 'render_package_unavailable'); self.assertFalse(self.cache.exists())
        manifest = self.build(); self.source.write_bytes(self.original + b' ')
        result = client.get('/cities/bristol/render/manifest')
        self.assertEqual(result.status_code, 200); self.assertEqual(result.headers['x-render-freshness'], 'unknown')
        self.assertEqual(result.json()['revision'], manifest['revision']); self.assertFalse((self.root / 'formal').exists())

    def test_city_revision_tile_traversal_and_hash_integrity(self):
        manifest = self.build(); client = self.client()
        for city_id in ['unknown', '..', '%2e%2e', 'Bristol', 'bristol%2f..']:
            self.assertEqual(client.get(f'/cities/{city_id}/render/manifest').status_code, 404)
        for revision in ['a' * 63, 'A' * 64, 'g' * 64, '%2e%2e', 'a%2fb']:
            self.assertEqual(client.get(f'/cities/bristol/render/{revision}/tiles/x0_y0').status_code, 404)
        for tile_id in ['manifest.json', '%2e%2e', 'x0_y0.json', 'x0_y0%2f..', 'x999999999_y0']:
            self.assertEqual(client.get(f"/cities/bristol/render/{manifest['revision']}/tiles/{tile_id}").status_code, 404)
        self.assertEqual(client.get(f"/cities/london/render/{manifest['revision']}/tiles/x0_y0").status_code, 404)
        descriptor = manifest['tiles'][0]
        path = self.cache / 'bristol' / manifest['revision'] / 'tiles' / f"{descriptor['id']}.json"
        path.write_bytes(path.read_bytes().replace(b'authored', b'altered!', 1))
        self.assertEqual(client.get(descriptor['url']).status_code, 404)

    def test_previous_tiles_remain_after_new_revision_and_symlinks_blocked(self):
        first = self.build(); self.source.write_bytes(self.original + b' '); second = self.build(); client = self.client()
        self.assertNotEqual(first['revision'], second['revision'])
        self.assertEqual(client.get(first['tiles'][0]['url']).status_code, 200)
        self.assertEqual(client.get('/cities/bristol/render/manifest').json()['revision'], second['revision'])
        path = self.cache / 'bristol' / first['revision'] / 'tiles' / f"{first['tiles'][0]['id']}.json"
        path.unlink(); path.symlink_to(self.source)
        self.assertEqual(client.get(first['tiles'][0]['url']).status_code, 404)


if __name__ == '__main__':
    unittest.main()
