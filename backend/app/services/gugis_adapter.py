from ..schemas import GugisObject


def to_gugis_collection(objects: list[GugisObject]) -> dict[str, object]:
    return {
        "format": "gugis-json",
        "version": "0.1.0",
        "coordinate_reference": "EPSG:4326+height_m",
        "object_count": len(objects),
        "objects": [obj.model_dump(mode="json") for obj in objects],
    }


def query_objects(
    objects: list[GugisObject],
    layer_id: str | None = None,
    structure_type: str | None = None,
    text: str | None = None,
    attributes: dict[str, object] | None = None,
) -> list[GugisObject]:
    result = objects
    if layer_id:
        result = [obj for obj in result if obj.layer_id == layer_id]
    if structure_type:
        result = [obj for obj in result if obj.structure_type == structure_type]
    if text:
        needle = text.lower()
        result = [
            obj
            for obj in result
            if needle in obj.object_id.lower()
            or needle in obj.name.lower()
            or any(needle in str(value).lower() for value in obj.attributes.values())
        ]
    if attributes:
        result = [
            obj
            for obj in result
            if all(str(obj.attributes.get(key)) == str(value) for key, value in attributes.items())
        ]
    return result
