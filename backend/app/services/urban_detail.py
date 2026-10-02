"""Footprint-conforming, editable street buildings. Unobserved details are inferred.

No web calls, random shapes, or replacement bounding boxes: the original outline,
anchor and eaves height survive. Repeated bays share geometry across storeys.
"""
import json
import math
from ..studio_models import BuildingDocument
from .city_generator import triangulate_ring
from .british_generator import prism
from .component_colors import COMPONENT_COLORS, color_components


def refine_city(city, tags_by_id=None):
    """Return a new project; preserve every placement, shared reference and road."""
    from ..city_models import CityDocument
    tags_by_id = tags_by_id or {}
    assets = {}
    for key,doc in city.assets.items():
        try:
            assets[key] = refine_document(doc,tags_by_id.get(key.removeprefix("osm"),{}))
        except ValueError as error:
            raise ValueError(f"Building {key}: {error}") from error
    metadata = {**city.metadata,
        "细化说明":"街区建筑沿原始轮廓补全立面开间、门窗、楼板、楼梯及屋顶；无实测资料的结构均为推演",
        "配色说明":"10 类构件使用统一语义颜色，颜色不代表实际材质",
        "显示方式":"完整构件存入资产；远景使用独立简模，选栋与楼栋详查显示完整结构"}
    return CityDocument.model_validate({**city.model_dump(exclude={"assets"}),"assets":assets,"metadata":metadata})


def area(points):
    return abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(points, points[1:]+points[:1]))) / 2


def clip(poly, axis, bound, greater):
    """Clip a convex polygon against a closed half plane."""
    result = []
    for a,b in zip(poly, poly[1:]+poly[:1]):
        ia = a[axis] >= bound if greater else a[axis] <= bound
        ib = b[axis] >= bound if greater else b[axis] <= bound
        if ia:
            result.append(a)
        if ia != ib:
            t = (bound-a[axis])/(b[axis]-a[axis])
            result.append([a[0]+t*(b[0]-a[0]), a[1]+t*(b[1]-a[1])])
    clean = []
    for q in result:
        if not clean or math.dist(q, clean[-1]) > 1e-7:
            clean.append(q)
    if len(clean)>1 and math.dist(clean[0],clean[-1])<1e-7:
        clean.pop()
    return clean if len(clean)>=3 and area(clean)>1e-5 else []


def subtract_rectangle(poly, rect):
    if rect is None:
        return [poly]
    xmin,ymin,xmax,ymax = rect
    remaining, pieces = poly, []
    for axis,bound,inside in [(0,xmin,True),(0,xmax,False),(1,ymin,True),(1,ymax,False)]:
        if not remaining:
            break
        outside = clip(remaining,axis,bound,not inside)
        if outside:
            pieces.append(outside)
        remaining = clip(remaining,axis,bound,inside)
    return pieces


def combine(meshes):
    vertices, faces = [], []
    for v,f in meshes:
        start = len(vertices)
        vertices.extend(v)
        faces.extend([[i+start for i in face] for face in f])
    return dict(kind="mesh",vertices=vertices,triangles=faces)


def line_intervals(ring, level, vertical=False):
    """Interior intervals of a horizontal/vertical scan line in a simple ring."""
    points = [(y,x) for x,y in ring] if vertical else ring
    hits=[]
    for a,c in zip(points,points[1:]+points[:1]):
        if (a[1]<=level<c[1]) or (c[1]<=level<a[1]):
            hits.append(a[0]+(level-a[1])*(c[0]-a[0])/(c[1]-a[1]))
    hits.sort()
    return [(a,c) for a,c in zip(hits[::2],hits[1::2]) if c-a>.5]


def box_mesh(size, position=(0,0,0)):
    w,d,h = size
    v,f = prism([[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]],h)
    return [[x+position[0],y+position[1],z-h/2+position[2]] for x,y,z in v],f


def classify(tags, name, surface):
    kind = tags.get("building", "")
    if kind in {"garage","garages","shed","roof","service"} or surface < 18:
        return "附属建筑"
    if kind in {"industrial","warehouse"}:
        return "工业 / 仓储"
    if kind in {"civic","public","church","university","school","college","museum"} or any(
        word in name.lower() for word in ("museum","library","church","school","hall","theatre")
    ):
        return "公共建筑"
    if kind in {"commercial","retail","office","hotel"} or "shop" in tags:
        return "商业街屋"
    if kind in {"apartments","residential","dormitory"} and surface > 220:
        return "集合住宅"
    return "英式街屋"


class Builder:
    def __init__(self, original, ring, height, floors, profile):
        self.original, self.ring, self.height = original, ring, height
        self.h, self.floors, self.profile = height/floors, floors, profile
        self.nodes, self.templates, self.keys = [], {}, {}
        attrs = dict(original.nodes[0].attributes)
        attrs.update({"精度说明":"原始轮廓保留；立面开间、楼层、屋顶及内部结构为规则推演，非实测复原",
                      "结构表达":"逐层实体 / 门窗开口 / 窗框 / 楼梯井 / 屋顶 / 沿轮廓立面",
                      "细化类型":profile,"细化版本":"urban-detail-1",
                      "配色依据":"按构件类别统一配色，颜色不表示真实建筑材质"})
        self.nodes.append(dict(id="building",name=original.parameters.name,category="building",attributes=attrs))
        self.nodes.append(dict(id="u1",parent="building",name="建筑单元",category="unit",unit=1))
        for floor in range(1,floors+1):
            self.nodes.extend([
                dict(id=f"f{floor}",parent="u1",name=f"{floor:02d} 层",category="floor",floor=floor,unit=1,
                     attributes={"标高 m":str(round((floor-1)*self.h,3)),"楼层依据":"高度与 OSM 标签推演，未实测"}),
                dict(id=f"r{floor}",parent=f"f{floor}",name="室内空间（推演）",category="room",floor=floor,unit=1)
            ])

    def solid(self, category, name, geometry, position, floor, rotation=0):
        geometry = json.loads(json.dumps(geometry))
        if geometry["kind"] == "box":
            geometry["size"] = [round(v,5) for v in geometry["size"]]
        else:
            geometry["vertices"] = [[round(v,5) or 0.0 for v in q] for q in geometry["vertices"]]
        geometry["color"] = COMPONENT_COLORS[category]
        key = json.dumps(geometry,sort_keys=True,separators=(",",":"))
        if key not in self.keys:
            self.keys[key] = f"t{len(self.templates)}"
            self.templates[self.keys[key]] = geometry
        self.nodes.append(dict(id=f"c{len(self.nodes)}",parent=f"f{floor}" if category in {"slab","roof","stair"} else f"r{floor}",
                               name=name,category=category,template=self.keys[key],position=[round(v,5) for v in position],
                               rotation_z=round((rotation+180)%360-180,7),floor=floor,unit=1))

    def box(self, category, name, size, position, floor, rotation=0):
        self.solid(category,name,dict(kind="box",size=size),position,floor,rotation)


def refine_document(original: BuildingDocument, tags=None) -> BuildingDocument:
    if original.parameters.kind != "footprint":
        return color_components(original)
    tags = tags or {}
    volume_node = next(n for n in original.nodes if n.template)
    volume = original.templates[volume_node.template]
    if volume.kind != "mesh":
        raise ValueError("细化需要闭合的轮廓挤出实体")
    z0 = min(v[2] for v in volume.vertices)
    height = max(v[2] for v in volume.vertices)-z0
    base = z0+volume_node.position[2]
    angle = math.radians(volume_node.rotation_z)
    ring, triangles = triangulate_ring([
        (x*math.cos(angle)-y*math.sin(angle)+volume_node.position[0],
         x*math.sin(angle)+y*math.cos(angle)+volume_node.position[1])
        for x,y,z in volume.vertices if abs(z-z0)<1e-5
    ])
    surface = area(ring)
    profile = classify(tags,original.parameters.name,surface)
    try:
        floors = int(float(tags.get("building:levels","")))
    except ValueError:
        floors = round(height/(4.2 if profile == "工业 / 仓储" else 3.2))
    floors = max(1,min(30,floors, max(1,int(height/2.2))))
    if profile == "附属建筑":
        floors = 1
    b = Builder(original,ring,height,floors,profile)
    b.nodes[0]["attributes"]["建筑用途标签"] = str(tags.get("building","缺少用途标签"))[:200]
    # The incenter of an ear triangle lies inside the original polygon. Its
    # incircle bounds the entire stair rectangle, including on concave plans.
    candidates = []
    for face in triangles:
        a,c,d = [ring[i] for i in face]
        sides = [math.dist(c,d),math.dist(a,d),math.dist(a,c)]
        perimeter = sum(sides)
        center = [sum(p[k]*s for p,s in zip((a,c,d),sides))/perimeter for k in (0,1)]
        candidates.append((2*area([a,c,d])/perimeter,center))
    radius,center = max(candidates,key=lambda p:p[0])
    core = None
    if floors > 1 and radius >= 1.0:
        factor = min(1,radius/2.0)
        cw,cd = 1.6*factor,3.0*factor
        core = [center[0]-cw/2,center[1]-cd/2,center[0]+cw/2,center[1]+cd/2]
    b.nodes[0]["attributes"]["室内依据"] = (
        "楼梯井位于轮廓内接区域；楼板留洞，内隔墙为示意布局" if core else
        "低层或狭小轮廓；未虚构无法容纳的楼梯井，室内空间未细分"
    )
    edges = list(zip(ring,ring[1:]+ring[:1]))
    entrance = max(range(len(edges)),key=lambda i:math.dist(*edges[i]))
    spacing = {"公共建筑":4.8,"工业 / 仓储":6.0,"集合住宅":4.0,"商业街屋":3.8,"英式街屋":3.3,"附属建筑":5.0}[profile]
    # Broader bays on very large facades bound full-detail geometry without
    # dropping buildings, storeys, short edges or their source outline.
    perimeter = sum(math.dist(a,c) for a,c in edges)
    spacing = max(spacing, perimeter * floors / 700)
    principal = math.atan2(edges[entrance][1][1]-edges[entrance][0][1],edges[entrance][1][0]-edges[entrance][0][0])
    ca,sa=math.cos(principal),math.sin(principal)
    aligned=[(x*ca+y*sa,-x*sa+y*ca) for x,y in ring]
    axis_center=(center[0]*ca+center[1]*sa,-center[0]*sa+center[1]*ca)
    partitions=[]
    if profile != "附属建筑" and height>=2.4 and surface>35:
        # Corridor walls and cross partitions are clipped against each wing of
        # the actual polygon, so L/U plans do not acquire walls across open air.
        for y in (axis_center[1]-2.0,axis_center[1]+2.0):
            for left,right in line_intervals(aligned,y):
                if right-left>3: partitions.append(((left+.20,y),(right-.20,y)))
        xmin,xmax=min(x for x,y in aligned),max(x for x,y in aligned)
        divisions=max(1,min(14,int((xmax-xmin)/7)))
        for i in range(1,divisions):
            x=xmin+(xmax-xmin)*i/divisions
            for low,high in line_intervals(aligned,x,True):
                for a,c in ((low,min(high,axis_center[1]-2.08)),(max(low,axis_center[1]+2.08),high)):
                    if c-a>2.4: partitions.append(((x,a+.20),(x,c-.20)))
    for floor in range(1,floors+1):
        z = base+(floor-1)*b.h
        meshes = []
        for triangle in triangles:
            poly = [ring[i] for i in triangle]
            for piece in subtract_rectangle(poly,core if floor>1 else None):
                piece = [(round(x,5),round(y,5)) for x,y in piece]
                changed = True
                while changed and len(piece)>=3:
                    changed=False
                    for i in range(len(piece)):
                        a,c,d=piece[i-1],piece[i],piece[(i+1)%len(piece)]
                        if abs((c[0]-a[0])*(d[1]-c[1])-(c[1]-a[1])*(d[0]-c[0])) < 1e-6:
                            piece.pop(i);changed=True;break
                if len(piece)<3:
                    continue
                v,f = prism(piece,min(.20,height*.08))
                if sum(len(m[0]) for m in meshes)+len(v)>240:
                    b.solid("slab","沿原轮廓楼板（楼梯井留洞）",combine(meshes),(0,0,z),floor)
                    meshes=[]
                meshes.append((v,f))
        if meshes:
            b.solid("slab","沿原轮廓楼板（楼梯井留洞）",combine(meshes),(0,0,z),floor)
        for edge,(a,c) in enumerate(edges):
            length = math.dist(a,c)
            ux,uy = (c[0]-a[0])/length,(c[1]-a[1])/length
            rotation = math.degrees(math.atan2(uy,ux))
            def at(t,inward,h):
                return (a[0]+ux*t-uy*inward,a[1]+uy*t+ux*inward,h)
            bays = max(1,min(18,round(length/spacing)))
            bay = length/bays
            wall_h = max(.3,b.h-.20)
            if bay<1.3 or height<2.4:
                b.box("wall","短边砌体",(length,.20,wall_h),at(length/2,.10,z+.20+wall_h/2),floor,rotation)
                continue
            for index in range(bays):
                door = floor==1 and edge==entrance and index==bays//2
                opening = min(bay*.55,2.3 if profile=="工业 / 仓储" else 1.8)
                bottom = .20 if door else .20+wall_h*.22
                top = .20+wall_h*.83
                side = (bay-opening)/2
                pieces = [box_mesh((side,.20,wall_h),(-opening/2-side/2,.10,.20+wall_h/2)),
                          box_mesh((side,.20,wall_h),(opening/2+side/2,.10,.20+wall_h/2)),
                          box_mesh((opening,.20,b.h-top),(0,.10,top+(b.h-top)/2))]
                if bottom>.20:
                    pieces.append(box_mesh((opening,.20,bottom-.20),(0,.10,.20+(bottom-.20)/2)))
                location = at(bay*(index+.5),0,z)
                b.solid("wall","门洞周边砌体" if door else "窗洞周边砌体",combine(pieces),location,floor,rotation)
                b.box("door" if door else "window","入口门" if door else "分层立面窗",(opening,.065,top-bottom),
                      at(bay*(index+.5),.018,z+(top+bottom)/2),floor,rotation)
                frame = [box_mesh((.065,.12,top-bottom+.10),(dx,-.04,(bottom+top)/2)) for dx in (-opening/2,opening/2)]
                frame.extend(box_mesh((opening,.12,.065),(0,-.04,h)) for h in (bottom,top))
                if not door:
                    frame.extend([box_mesh((.05,.12,top-bottom),(0,-.04,(bottom+top)/2)),
                                  box_mesh((opening,.12,.05),(0,-.04,bottom+(top-bottom)*.55))])
                b.solid("railing","门套" if door else "窗框与十字窗棂",combine(frame),location,floor,rotation)
            b.box("ornament","层间檐口 / 腰线",(length,.30,.12),at(length/2,.025,z+b.h-.06),floor,rotation)
        if core:
            cw,cd = core[2]-core[0],core[3]-core[1]
            if floor<floors:
                stairs = [box_mesh((cw*.80,cd/10,.15),(0,-cd/2+cd*(i+.5)/10,.25+b.h*(i+1)/10)) for i in range(10)]
                b.solid("stair","楼梯井直跑楼梯（推演）",combine(stairs),(center[0],center[1],z),floor)
            # The small partition beside the stair lies within the same incircle.
            b.box("wall","楼梯间内隔墙",(.12,cd,wall_h),(core[0]+.06,center[1],z+.20+wall_h/2),floor)
            if floor>1:
                b.box("railing","楼梯井护栏",(.065,cd,.85),(core[2]-.04,center[1],z+.65),floor)
        if profile=="公共建筑" and radius>3:
            for dx in (-radius*.36,radius*.36):
                b.box("column","室内结构柱（推演）",(.40,.40,wall_h),(center[0]+dx,center[1],z+.20+wall_h/2),floor)
        for index,(a,c) in enumerate(partitions):
            x,y=(a[0]+c[0])/2,(a[1]+c[1])/2
            length=math.dist(a,c)
            door_w,door_h=min(.95,length*.25),min(2.10,wall_h*.80)
            side=(length-door_w)/2
            rid=f"zone{floor}_{index}"
            b.nodes.append(dict(id=rid,parent=f"f{floor}",name=f"室内分区 {index+1:02d}（推演）",category="room",floor=floor,unit=1,
                                attributes={"布局依据":"沿轮廓裁切的走廊 / 房间分隔；不代表真实房间用途或户型"}))
            geometry=combine([box_mesh((side,.12,wall_h),(-door_w/2-side/2,0,wall_h/2)),
                              box_mesh((side,.12,wall_h),(door_w/2+side/2,0,wall_h/2)),
                              box_mesh((door_w,.12,wall_h-door_h),(0,0,door_h+(wall_h-door_h)/2))])
            rotation=math.degrees(principal+math.atan2(c[1]-a[1],c[0]-a[0]))
            position=(x*ca-y*sa,x*sa+y*ca,z+.20)
            b.solid("wall","室内隔墙与门洞",geometry,position,floor,rotation)
            b.nodes[-1]["parent"]=rid
            b.box("door","分区通行门",(door_w,.06,door_h),(position[0],position[1],z+.20+door_h/2),floor,rotation)
            b.nodes[-1]["parent"]=rid
    # Pitched roofs follow four-sided convex plans. Complex outlines get an
    # exact-footprint flat roof and parapets, avoiding invented roof overhangs.
    convex = len(ring)==4 and all((ring[(i+1)%4][0]-ring[i][0])*(ring[(i+2)%4][1]-ring[(i+1)%4][1])-
                                (ring[(i+1)%4][1]-ring[i][1])*(ring[(i+2)%4][0]-ring[(i+1)%4][0])>0 for i in range(4))
    pitched = convex and tags.get("roof:shape", "gabled" if profile in {"英式街屋","附属建筑"} else "flat") in {"gabled","hipped","pyramidal"}
    roof_z = base+height
    if pitched:
        corners = list(ring)
        if math.dist(corners[0],corners[1])>math.dist(corners[1],corners[2]):
            corners = corners[1:]+corners[:1]
        rise = min(3.2,math.dist(corners[0],corners[1])*.32)
        vertices = [[x,y,0] for x,y in corners]+[
            [(corners[a][0]+corners[c][0])/2,(corners[a][1]+corners[c][1])/2,rise] for a,c in [(0,1),(2,3)]]
        roof = dict(kind="mesh",vertices=vertices,triangles=[[0,3,2],[0,2,1],[0,1,4],[3,5,2],[0,4,5],[0,5,3],[1,2,5],[1,5,4]])
    else:
        # Original volume topology can be reused with a shallow extrusion.
        v,f = [],[]
        for x,y in ring:v.append([x,y,0])
        for x,y in ring:v.append([x,y,.22])
        n=len(ring)
        f.extend([[c,d,a] for a,d,c in triangles])
        f.extend([[a+n,d+n,c+n] for a,d,c in triangles])
        for i in range(n):
            j=(i+1)%n;f.extend([[i,j,n+j],[i,n+j,n+i]])
        roof=dict(kind="mesh",vertices=v,triangles=f)
        for a,c in edges:
            length=math.dist(a,c)
            b.box("railing","屋顶女儿墙",(length,.15,.50),((a[0]+c[0])/2,(a[1]+c[1])/2,roof_z+.47),floors,
                  math.degrees(math.atan2(c[1]-a[1],c[0]-a[0])))
    b.solid("roof","轮廓适配双坡屋顶" if pitched else "复杂轮廓平屋顶",roof,(0,0,roof_z),floors)
    if radius>1.1:
        chimney_h = 1.1+(rise if pitched else .22)
        b.box("ornament","烟囱 / 屋顶通风构件（推演）",(.55,.55,chimney_h),(center[0],center[1],roof_z+chimney_h/2),floors)
    b.nodes[0]["attributes"]["屋顶依据"] = "四边轮廓双坡屋顶（推演）" if pitched else "复杂轮廓平屋顶（推演）"
    overview_body = volume.model_dump(exclude_none=True)
    overview_body["vertices"] = [[x,y,z] for z in (base,roof_z) for x,y in ring]
    n=len(ring)
    overview_body["triangles"] = [[c,d,a] for a,d,c in triangles]+[[a+n,d+n,c+n] for a,d,c in triangles]
    for i in range(n):
        j=(i+1)%n;overview_body["triangles"].extend([[i,j,n+j],[i,n+j,n+i]])
    overview_body["color"] = COMPONENT_COLORS["wall"]
    overview_roof = {**roof,"vertices":[[x,y,z+roof_z] for x,y,z in roof["vertices"]],"color":COMPONENT_COLORS["roof"]}
    params = original.parameters.model_dump()
    params.update(kind="urban",floors=floors,units=1,floor_height=max(2.5,min(4.5,b.h)))
    return BuildingDocument.model_validate(dict(format="gugis-studio",version="1.2",coordinate_system="ENU_METERS_WGS84",
        parameters=params,templates=b.templates,nodes=b.nodes,overview={"body":overview_body,"roof":overview_roof}))
