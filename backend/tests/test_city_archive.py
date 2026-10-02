import copy
import json
import unittest
from pydantic import ValidationError
from app.city_models import CityDocument
from app.studio_models import BuildingDocument
from app.services.box_parameters import box_set_mesh, identify_box_set
from app.services.building_generator import document_bytes
from app.services.city_archive import archive_bytes, load_city, pack_city
from app.services.city_generator import city_bytes


def sample_city():
    bounds = [[-0.1, -2.375, 0.000000001, 0.123456789123, 3.4, 5.67],
              [5, 0, 0, 6, 1, 1]]
    vertices, faces = box_set_mesh(bounds)
    sloped = copy.deepcopy(vertices[:8])
    for vertex in sloped[4:]:
        vertex[0] += 0.31415926535
    templates = {
        "wall": {"kind": "box", "size": [3, 0.2, 2.8], "color": "#d8b58d"},
        "window": {"kind": "box", "size": [1, 0.07, 1.5], "color": "#368dcc"},
        "frame": {"kind": "mesh", "vertices": vertices, "triangles": faces, "color": "#42566b"},
        "slope": {"kind": "mesh", "vertices": sloped, "triangles": faces[:12], "color": "#665495"},
    }
    doc = dict(format="gugis-studio", version="1.2", coordinate_system="ENU_METERS_WGS84",
               parameters={"name": "Original", "kind": "urban", "floors": 1, "units": 1}, templates=templates,
               overview={"body": templates["slope"]}, nodes=[
        {"id": "building", "name": "Original", "category": "building", "attributes": {"source": "Fixture"}},
        {"id": "unit", "name": "Unit", "parent": "building", "category": "unit", "unit": 1},
        {"id": "floor", "name": "Floor", "parent": "unit", "category": "floor", "unit": 1, "floor": 1},
        {"id": "room", "name": "Room", "parent": "floor", "category": "room", "unit": 1, "floor": 1},
        *[{"id": key, "name": key, "category": "wall", "parent": "room", "floor": 1, "unit": 1,
           "template": key, "position": [0.01 * i, 2, 3], "rotation_z": 17.3333333} for i, key in enumerate(templates)],
    ])
    other = copy.deepcopy(doc)
    other["parameters"]["name"] = "Neighbour"
    other["templates"]["frame"]["color"] = "#eadb9b"
    other["templates"]["wall"]["size"] = [7.12, 0.35, 4.2]
    return CityDocument.model_validate(dict(format="gugis-city", version="1.0", coordinate_system="ENU_METERS_WGS84",
        name="Lossless fixture", assets={"a": doc, "b": other}, instances=[
            {"id": k, "asset": k, "name": k, "longitude": -2.6, "latitude": 51.45, "heading": 29} for k in ["a", "b"]]))


class CityArchiveTests(unittest.TestCase):
    def setUp(self):
        self.city = sample_city()
        self.content, self.stats = pack_city(self.city)
        self.payload = json.loads(self.content)

    def test_old_and_shared_archives_restore_every_node_material_and_coordinate(self):
        for data in [city_bytes(self.city), self.content]:
            restored = load_city(data)
            self.assertEqual(restored, self.city)
            for key in self.city.assets:
                self.assertEqual(document_bytes(restored.assets[key]), document_bytes(self.city.assets[key]))
        self.assertEqual(archive_bytes(load_city(self.content)), self.content)

    def test_global_geometry_shares_across_colors_dimensions_and_buildings(self):
        self.assertEqual(len(self.payload["geometry_library"]), 3)
        a, b = (self.payload["assets"][key]["templates"] for key in ["a", "b"])
        self.assertEqual(a["wall"]["geometry"], b["window"]["geometry"])
        self.assertNotEqual(a["wall"]["size"], b["wall"]["size"])
        self.assertEqual(a["frame"]["geometry"], b["frame"]["geometry"])
        self.assertNotEqual(a["frame"]["color"], b["frame"]["color"])
        self.assertEqual(self.stats["component_instances"], 8)
        self.assertEqual(self.stats["shared_geometries"], 3)
        self.assertEqual(self.stats["local_bindings"], 8)
        self.assertEqual(self.stats["box_instances"], 4)

    def test_recognizes_only_exact_boxes_and_preserves_non_box_geometry(self):
        solids = self.city.assets["a"].templates
        self.assertIsNotNone(identify_box_set(solids["frame"].vertices, solids["frame"].triangles))
        self.assertIsNone(identify_box_set(solids["slope"].vertices, solids["slope"].triangles))
        altered = list(solids["frame"].triangles)
        altered[0], altered[1] = altered[1], altered[0]
        self.assertIsNone(identify_box_set(solids["frame"].vertices, altered))
        self.assertEqual(self.stats["box_set_records"], 1)
        self.assertEqual(self.stats["mesh_records"], 1)

    def test_unresolved_or_invalid_shared_geometry_is_rejected(self):
        mesh_id = self.payload["assets"]["a"]["templates"]["frame"]["geometry"]
        mutations = [
            lambda p: p["assets"]["a"]["templates"]["wall"].update(geometry="absent"),
            lambda p: p["assets"]["a"]["templates"]["wall"].pop("size"),
            lambda p: p["assets"]["a"]["templates"]["wall"].update(size=[1, -2, 3]),
            lambda p: p["assets"]["a"]["templates"]["frame"].update(size=[1, 2, 3]),
            lambda p: p["geometry_library"][mesh_id].update(bounds=[[0, 0, 0, 1, 0, 1]]),
            lambda p: p["geometry_library"][mesh_id].update(bounds=[[0, 0, 0, 1, 1, float("inf")]]),
            lambda p: p["geometry_library"][mesh_id].update(kind="sphere"),
            lambda p: p["geometry_library"][mesh_id].update(surprise=True),
            lambda p: p.update(version="9.9"),
        ]
        for mutate in mutations:
            value = copy.deepcopy(self.payload)
            mutate(value)
            with self.subTest(value=str(value)[:100]), self.assertRaises(ValidationError):
                load_city(value)

    def test_single_building_export_is_self_contained_and_edits_are_independent(self):
        restored = load_city(self.content)
        neighbour = document_bytes(restored.assets["b"])
        editable = restored.assets["a"].model_dump()
        editable["templates"]["frame"]["vertices"][0] = (-0.101, -2.375, 0.000000001)
        editable["templates"]["wall"]["color"] = "#abcdef"
        restored.assets["a"] = BuildingDocument.model_validate(editable)
        again = load_city(archive_bytes(restored))
        self.assertEqual(document_bytes(again.assets["b"]), neighbour)
        solo = document_bytes(again.assets["a"])
        self.assertEqual(BuildingDocument.model_validate_json(solo), again.assets["a"])
        self.assertNotIn(b'"geometry_library"', solo)
        self.assertNotIn(b'"geometry":', solo)

    def test_unused_library_entries_are_pruned_and_unplaced_assets_do_not_inflate_usage(self):
        self.payload["geometry_library"]["unused"] = {"kind": "box-set", "bounds": [[0, 0, 0, 99, 99, 99]]}
        self.payload["instances"] = self.payload["instances"][:1]
        content, stats = pack_city(load_city(self.payload))
        self.assertNotIn("unused", json.loads(content)["geometry_library"])
        self.assertEqual(stats["component_instances"], 4)
        self.assertEqual(stats["shared_geometries"], 3)


if __name__ == "__main__":
    unittest.main()
