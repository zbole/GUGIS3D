"""One persisted semantic palette, shared with the browser legend."""
import json
from pathlib import Path
from ..studio_models import BuildingDocument

COMPONENT_COLORS = json.loads(
    (Path(__file__).resolve().parents[3] / "shared" / "component-colors.json").read_text()
)


def color_components(document: BuildingDocument) -> BuildingDocument:
    if all(not n.template or document.templates[n.template].color == COMPONENT_COLORS[n.category] for n in document.nodes):
        return document.model_copy(deep=True)
    # A material may be shared by different categories in older files. Split it
    # before recoloring so a roof never changes the color of a wall or window.
    result = document.model_copy(deep=True)
    templates, keys = {}, {}
    for node in result.nodes:
        if not node.template:
            continue
        key = (node.template, node.category)
        if key not in keys:
            identifier = f"pc{len(keys)}"
            keys[key] = identifier
            templates[identifier] = result.templates[node.template].model_copy(
                update={"color": COMPONENT_COLORS[node.category]}
            )
        node.template = keys[key]
    result.templates = templates
    return BuildingDocument.model_validate(result.model_dump(exclude_none=True))
