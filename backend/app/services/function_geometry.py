from ..schemas import GugisObject


def summarize_function_geometry(obj: GugisObject) -> dict[str, float | str | int]:
    function_type = obj.geometry.get("function_type", "unknown")
    height = float(obj.attributes.get("height_m", obj.geometry.get("height", 0)))
    return {
        "object_id": obj.object_id,
        "function_type": function_type,
        "height_m": height,
        "shape_type": obj.shape_type,
    }
