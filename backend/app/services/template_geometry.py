from ..schemas import GugisObject


def summarize_template_instance(obj: GugisObject) -> dict[str, object]:
    return {
        "object_id": obj.object_id,
        "template_id": obj.geometry.get("template_id"),
        "prototype_object_id": obj.geometry.get("prototype_object_id"),
        "instance_transform": obj.geometry.get("instance_transform", {}),
    }
