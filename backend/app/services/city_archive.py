"""City 1.1: shared geometry, independent materials, lossless box parameters."""
import hashlib
import json
from collections import Counter
from pydantic import TypeAdapter
from ..city_models import CityDocument, CityPayload, PooledCity
from .box_parameters import identify_box_set
from .city_generator import city_bytes

CITY_ADAPTER = TypeAdapter(CityPayload)


def expand_city(value):
    return value._document if isinstance(value, PooledCity) else value


def load_city(value):
    parsed = CITY_ADAPTER.validate_json(value) if isinstance(value, (str, bytes, bytearray)) else CITY_ADAPTER.validate_python(value)
    return expand_city(parsed)


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def normalized(value):
    if isinstance(value, dict):
        return {k:normalized(v) for k,v in value.items()}
    if isinstance(value, (list, tuple)):
        return [normalized(v) for v in value]
    if isinstance(value, float):
        return value if value else 0.0
    return value


def pack_city(document: CityDocument):
    legacy = city_bytes(document)
    payload = json.loads(legacy)
    library, signatures = {}, {}
    template_count = 0
    component_geometries = set()
    component_refs = Counter()
    uses = Counter(i.asset for i in document.instances)

    def binding(solid):
        if solid["kind"] == "box":
            geometry = {"kind":"box"}
        else:
            bounds = identify_box_set(solid["vertices"], solid["triangles"])
            geometry = {"kind":"box-set", "bounds":bounds} if bounds is not None else {
                "kind":"mesh", "vertices":solid["vertices"], "triangles":solid["triangles"]}
        geometry = normalized(geometry)
        signature = encode(geometry)
        key = "g" + hashlib.sha256(signature).hexdigest()[:20]
        if key in signatures and signatures[key] != signature:
            raise ValueError("Geometry identifier collision; archive was not written")
        library[key], signatures[key] = geometry, signature
        result = {"geometry":key, "color":solid["color"]}
        if solid["kind"] == "box":
            result["size"] = solid["size"]
        return result

    for key,asset in payload["assets"].items():
        asset["templates"] = {tid:binding(solid) for tid,solid in asset["templates"].items()}
        template_count += len(asset["templates"])
        if "overview" in asset:
            asset["overview"] = {tid:binding(solid) for tid,solid in asset["overview"].items()}
        for node in asset["nodes"]:
            if "template" in node and uses[key]:
                geometry = asset["templates"][node["template"]]["geometry"]
                component_geometries.add(geometry)
                component_refs[geometry] += uses[key]
    payload["version"] = "1.2" if document.environment is not None else "1.1"
    payload["geometry_library"] = library
    content = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    kinds = Counter(g["kind"] for g in library.values())
    stats = {
        "building_models":len(document.assets), "building_instances":len(document.instances),
        "component_instances":sum(component_refs.values()), "local_bindings":template_count,
        "shared_geometries":len(component_geometries), "library_records":len(library),
        "reused_geometries":sum(n>1 for n in component_refs.values()),
        "box_instances":sum(n for key,n in component_refs.items() if library[key]["kind"] == "box"),
        "box_set_records":kinds["box-set"], "mesh_records":kinds["mesh"],
        "archive_bytes":len(content), "legacy_bytes":len(legacy),
        "saved_bytes":len(legacy)-len(content),
    }
    return content, stats


def archive_bytes(document):
    return pack_city(document)[0]
