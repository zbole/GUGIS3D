"""Create true 3D solids in local meters, then instance them into a semantic graph."""
import json

from ..studio_models import BuildingDocument, BuildingParameters


def document_bytes(document: BuildingDocument) -> bytes:
    # Keep the format/version/coordinate contract explicit in every exported file.
    payload = document.model_dump(mode="json", exclude_none=True)
    for node in payload["nodes"]:
        if not node["rotation_z"]:
            del node["rotation_z"]
        if not node["attributes"]:
            del node["attributes"]
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def statistics(document: BuildingDocument) -> dict:
    payload = json.loads(document_bytes(document))
    components = [node for node in payload["nodes"] if "template" in node]
    expanded = {**payload, "nodes": [({**n, "solid": payload["templates"][n["template"]]} if "template" in n else n) for n in payload["nodes"]]}
    del expanded["templates"]
    for node in expanded["nodes"]:
        node.pop("template", None)
    expanded_size = len(json.dumps(expanded, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    size = len(document_bytes(document))
    return {"nodes": len(document.nodes), "components": len(components), "templates": len(document.templates),
            "dwellings": sum(n.category == "dwelling" for n in document.nodes),
            "compact_bytes": size, "inline_geometry_bytes": expanded_size,
            "saved_bytes": expanded_size-size}


def generate_building(p: BuildingParameters) -> BuildingDocument:
    if p.kind in {'tudor','warehouse','chapel','civic'}:
        from .extra_buildings import generate_extra
        from .component_colors import color_components
        return color_components(generate_extra(p))
    if p.kind not in {"tower", "villa"}:
        from .british_generator import generate_british
        from .component_colors import color_components
        return color_components(generate_british(p))
    templates, nodes, template_keys = {}, [], {}
    from .component_colors import COMPONENT_COLORS
    colors = COMPONENT_COLORS

    def group(id, parent, name, category, floor=None, unit=None, attributes=None):
        nodes.append(dict(id=id, parent=parent, name=name, category=category, floor=floor, unit=unit, attributes=attributes or {}))

    def box(parent, category, name, size, position, floor, unit):
        size = tuple(round(v, 4) for v in size)
        key = (category, size)
        if key not in template_keys:
            tid = f"t{len(templates)+1}"
            template_keys[key] = tid
            templates[tid] = dict(kind="box", color=colors[category], size=size)
        nodes.append(dict(id=f"c{len(nodes)}", parent=parent, name=name, category=category,
                          floor=floor, unit=unit, template=template_keys[key], position=[round(v, 4) for v in position]))

    group("building", None, p.name, "building", attributes={"数据来源": "参数化合成示例", "住户信息": "虚构演示编号，不含真实个人信息"})
    h, width, depth = p.floor_height, 14, 10
    for u in range(1, p.units+1):
        ux = (u-(p.units+1)/2)*width
        uid = f"u{u}"
        group(uid, "building", f"{u} 单元", "unit", unit=u)
        for f in range(1, p.floors+1):
            z = (f-1)*h
            fid = f"u{u}f{f}"
            group(fid, uid, f"{f:02d} 层", "floor", f, u, {"标高 m": str(round(z, 2))})
            box(fid, "slab", "楼板", [width, depth, .22], [ux, 0, z+.11], f, u)
            for s in range(12):
                box(fid, "stair", f"楼梯踏步 {s+1}", [1.8, .38, .18], [ux, -2.2+s*.38, z+.3+s*(h-.4)/12], f, u)
            for d, dx in enumerate([-4, 4], 1):
                x, did = ux+dx, f"{fid}d{d}"
                group(did, fid, f"{f:02d}0{d} 室", "dwelling", f, u,
                      {"住户编号": f"DEMO-U{u}-{f:02d}0{d}", "用途": "住宅", "建筑模块面积 m²": "60", "信息类型": "合成示例"})
                # Front and rear walls are separate solids around real window openings.
                for side, y in [("南", -4.9), ("北", 4.9)]:
                    for suffix, sz, pos in [
                        ("窗下墙", [6, .2, .85], [x,y,z+.22+.425]),
                        ("窗上墙", [6,.2,h-2.37], [x,y,z+2.37+(h-2.37)/2]),
                        ("左墙垛", [1.25,.2,1.3], [x-2.375,y,z+1.72]),
                        ("右墙垛", [1.25,.2,1.3], [x+2.375,y,z+1.72]),
                    ]:
                        box(did, "wall", side+suffix, sz, pos, f, u)
                    box(did, "window", side+"窗", [3.5,.07,1.3], [x,y,z+1.72], f, u)
                    box(did, "railing", side+"窗中梃", [.06,.12,1.3], [x,y,z+1.72], f, u)
                # Side walls; corridor side has an actual doorway.
                outer_x, inner_x = (x-2.9, x+2.9) if d == 1 else (x+2.9, x-2.9)
                box(did, "wall", "外侧墙", [.2,9.6,h-.22], [outer_x,0,z+.22+(h-.22)/2], f, u)
                for y in [-2.7,2.7]:
                    box(did, "wall", "入户门侧墙", [.2,4.2,h-.22], [inner_x,y,z+.22+(h-.22)/2], f,u)
                box(did, "wall", "门上墙", [.2,1.2,h-2.32], [inner_x,0,z+2.32+(h-2.32)/2], f,u)
                box(did, "door", "入户门", [.08,1.2,2.1], [inner_x,0,z+1.27], f,u)
                box(did, "balcony", "悬挑阳台板", [4,1.6,.18], [x,-5.75,z+.3], f,u)
                box(did, "railing", "阳台前栏板", [4,.08,.85], [x,-6.5,z+.9], f,u)
                for bx in [-1.96,1.96]:
                    box(did, "railing", "阳台侧栏板", [.08,1.5,.85], [x+bx,-5.75,z+.9], f,u)
        # Closed gable prism from explicit XYZ vertices. Roof pitch is not footprint extrusion.
        a,b,r = 7.3,5.3, 2.8 if p.kind == "villa" else 1.2
        templates["roof"] = dict(kind="mesh",color=colors["roof"],vertices=[[-a,-b,0],[a,-b,0],[a,b,0],[-a,b,0],[0,-b,r],[0,b,r]],
                                 triangles=[[0,3,2],[0,2,1],[0,1,4],[3,5,2],[0,4,5],[0,5,3],[1,2,5],[1,5,4]])
        roof_parent=f"u{u}f{p.floors}"
        box(roof_parent,"slab","屋顶板",[width,depth,.2],[ux,0,p.floors*h],p.floors,u)
        nodes.append(dict(id=f"roof{u}",parent=roof_parent,name="双坡实体屋顶",category="roof",floor=p.floors,unit=u,template="roof",position=[ux,0,p.floors*h+.1]))
    if p.scale != 1:
        for template in templates.values():
            if template["kind"] == "box":
                template["size"] = [round(v*p.scale, 5) for v in template["size"]]
            else:
                template["vertices"] = [[round(v*p.scale, 5) for v in q] for q in template["vertices"]]
        for node in nodes:
            if "position" in node:
                node["position"] = [round(v*p.scale, 5) for v in node["position"]]
    return BuildingDocument.model_validate(dict(format="gugis-studio", version="1.1", coordinate_system="ENU_METERS_WGS84", parameters=p.model_dump(), templates=templates, nodes=nodes))
