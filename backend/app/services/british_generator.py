"""Editable solid assemblies, inspired by British architectural forms.

Landmark proportions and internal divisions are interpretive, never survey data.
Every visible part is a closed solid and belongs to a semantic space/floor.
"""
import json
import math

from ..studio_models import BuildingDocument, BuildingParameters

STONE = "#cabca1"
TRIM = "#ede1c8"
BRICK = "#a65f4b"
SLATE = "#495766"
GLASS = "#466e83"
IRON = "#33434b"

SOURCES = {
    "wills": "https://historicengland.org.uk/listing/the-list/list-entry/1218203",
    "cabot": "https://museums.bristol.gov.uk/narratives.php?irn=3492",
    "cathedral": "https://historicengland.org.uk/listing/the-list/list-entry/1202129",
}


def prism(outline, depth, vertical=False):
    """Extrude a convex CCW outline; vertical=True puts its outline in XZ."""
    n = len(outline)
    vertices = [[x, y, z] for z in (0, depth) for x, y in outline]
    faces = []
    for i in range(1, n - 1):
        faces.extend([[0, i + 1, i], [n, n + i, n + i + 1]])
    for i in range(n):
        j = (i + 1) % n
        faces.extend([[i, j, n + j], [i, n + j, n + i]])
    if vertical:
        vertices = [[x, -z, y] for x, y, z in vertices]
    return vertices, faces


class Assembly:
    def __init__(self, p, height, source=None):
        self.p, self.height = p, height
        self.nodes, self.templates, self.keys, self.groups = [], {}, {}, {}
        self.unit = 1
        self.offset = (0, 0)
        self.angle = 0
        attrs = {"数据来源": "地标形态参考模型" if source else "英式住宅参数模型",
                 "精度说明": "非测绘模型；尺寸、内部空间和分层为建模假设，可替换为实测实体",
                 "结构表达": "实体构件 / 空间 / 分层 / 翼部"}
        if source:
            attrs["参考资料"] = source
        self.group("building", None, p.name, "building", attributes=attrs)

    def group(self, id, parent, name, category, floor=None, unit=None, attributes=None):
        self.nodes.append(dict(id=id, parent=parent, name=name, category=category,
                               floor=floor, unit=unit, attributes=attributes or {}))

    def parent(self, z, category):
        f = min(self.p.floors, max(1, int(max(z, 0) / (self.height / self.p.floors)) + 1))
        u = self.unit
        uid, fid, rid = f"u{u}", f"u{u}f{f}", f"u{u}f{f}r"
        if uid not in self.groups:
            self.group(uid, "building", f"翼部 / 单元 {u}", "unit", unit=u)
            self.groups[uid] = True
        if fid not in self.groups:
            self.group(fid, uid, f"{f:02d} 层 / 建模分段", "floor", f, u,
                       {"层次依据": "参数化分段，非实测楼层" if self.p.kind in SOURCES else "设计楼层"})
            residential = self.p.kind in {"georgian", "victorian"}
            self.group(rid, fid, "住宅空间" if residential else "公共建筑空间", "room", f, u,
                       {"用途": "住宅" if residential else "公共建筑", "空间状态": "示意划分"})
            self.groups[fid] = True
        return (fid if category in {"slab", "roof", "stair"} else rid), f, u

    def solid(self, category, name, geometry, position, color):
        x, y, z = position
        parent, floor, unit = self.parent(z, category)
        c, s = math.cos(self.angle), math.sin(self.angle)
        position = [x*c-y*s+self.offset[0], x*s+y*c+self.offset[1], z]
        if geometry["kind"] == "box" and abs(c) < 1e-8:
            w,d,h=geometry["size"]
            geometry["size"]=[d,w,h]
        elif self.angle and abs(s) > 1e-8 and geometry["kind"] == "box":
            w, d, h = geometry["size"]
            vertices, faces = prism([[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]], h)
            geometry = dict(kind="mesh", vertices=[[a,b,t-h/2] for a,b,t in vertices], triangles=faces)
        if geometry["kind"] == "mesh":
            geometry["vertices"] = [[round((a*c-b*s)*self.p.scale, 5), round((a*s+b*c)*self.p.scale, 5), round(t*self.p.scale, 5)] for a,b,t in geometry["vertices"]]
        else:
            geometry["size"] = [round(v*self.p.scale, 5) for v in geometry["size"]]
        if geometry["kind"] == "mesh":
            geometry["vertices"] = [[v or 0.0 for v in q] for q in geometry["vertices"]]
        key = json.dumps({**geometry, "color": color}, sort_keys=True)
        if key not in self.keys:
            tid = f"t{len(self.templates)}"
            self.keys[key] = tid
            self.templates[tid] = {**geometry, "color": color}
        self.nodes.append(dict(id=f"c{len(self.nodes)}", parent=parent, name=name, category=category,
                               floor=floor, unit=unit, template=self.keys[key],
                               position=[round(v*self.p.scale, 5) for v in position]))

    def box(self, name, size, pos, color=STONE, category="wall"):
        self.solid(category, name, dict(kind="box", size=list(size)), pos, color)

    def profile(self, name, outline, depth, pos, color=STONE, category="ornament", vertical=False):
        vertices, faces = prism(outline, depth, vertical)
        self.solid(category, name, dict(kind="mesh", vertices=vertices, triangles=faces), pos, color)

    def octagon(self, name, radius, height, pos, color=TRIM, category="column"):
        self.profile(name, [(radius*math.cos(i*math.pi/4), radius*math.sin(i*math.pi/4)) for i in range(8)], height, pos, color, category)

    def spire(self, x, y, z, radius=0.7, height=3):
        v = [[radius*math.cos(i*math.pi/4), radius*math.sin(i*math.pi/4), 0] for i in range(8)] + [[0,0,height]]
        f = [[0,i+1,i] for i in range(1,7)] + [[i,(i+1)%8,8] for i in range(8)]
        self.solid("ornament", "八角尖顶", dict(kind="mesh", vertices=v, triangles=f), (x,y,z), TRIM)

    def roof(self, x, y, z, width, depth, rise):
        self.profile("双坡石板屋顶", [(-width/2,0),(width/2,0),(0,rise)], depth,
                     (x,y+depth/2,z), SLATE, "roof", True)
        self.box("屋脊压顶", (.24,depth+.3,.24), (x,y,z+rise), TRIM, "ornament")

    def window(self, x, y, z, w=1.4, h=2.6, gothic=True):
        outline = [(-w/2,0),(w/2,0),(w/2,h*.72),(0,h),(-w/2,h*.72)] if gothic else [(-w/2,0),(w/2,0),(w/2,h),(-w/2,h)]
        self.profile("尖拱玻璃" if gothic else "上下推拉窗", outline, .1, (x,y,z), GLASS, "window", True)
        for dx in (-w/2-.1, w/2+.1):
            self.box("石窗套", (.18,.24,h*.78), (x+dx,y,z+h*.39), TRIM, "ornament")
        self.box("石窗台", (w+.5,.44,.2), (x,y-.08,z), TRIM, "ornament")
        self.box("竖向窗梃", (.065,.15,h*.8), (x,y-.08,z+h*.4), TRIM, "railing")
        for q in (.3,.62):
            self.box("横向窗棂", (w,.16,.065), (x,y-.08,z+h*q), TRIM, "railing")
        if gothic:
            for dx in (-w*.22,w*.22):
                self.octagon("窗顶花饰", w*.13,.10,(x+dx,y,z+h*.75),TRIM,"ornament")
        else:
            self.box("过梁", (w+.4,.3,.18), (x,y,z+h+.12),TRIM,"ornament")

    def facade(self, width, depth, z, h, bays, color=STONE, gothic=True):
        """Real rectangular openings; layered lancets and frames within them."""
        bay = width / bays
        wh = h*.61
        for i in range(bays):
            x = -width/2 + bay*(i+.5)
            w = bay*.52
            for dx in (-1,1):
                self.box("窗间墙垛", ((bay-w)/2,.5,h), (x+dx*(bay+w)/4,-depth/2,z+h/2), color)
            self.box("窗下砌体", (w,.5,h*.17), (x,-depth/2,z+h*.085), color)
            self.box("窗上砌体", (w,.5,h*.22), (x,-depth/2,z+h*.89), color)
            self.window(x,-depth/2-.28,z+h*.17,w,wh,gothic)
        self.box("水平石腰线", (width+.4,.7,.2), (0,-depth/2,z+h),TRIM,"ornament")

    def hall(self, x, y, width, depth, height, bays=5):
        old = self.offset
        self.offset = (x,y)
        for a in (0,math.pi):
            self.angle = a
            self.facade(width,depth,0,height,bays)
        self.angle = 0
        side_bays=max(2,min(12,round(depth/7)))
        for a in (math.pi/2,math.pi*1.5):
            self.angle=a
            self.facade(depth,width,0,height,side_bays)
        self.angle=0
        self.box("大厅地板", (width,depth,.35),(0,0,.175),TRIM,"slab")
        self.roof(0,0,height,width+.6,depth+.6,width*.3)
        # Repeated internal columns and external stepped buttresses.
        for i in range(bays+1):
            xx = -width/2+width*i/bays
            for yy in (-depth/2-.5,depth/2+.5):
                for step in range(3):
                    self.box("阶梯扶壁", (.8,1.8-step*.4,height/3),(xx,yy, height/3*(step+.5)),STONE,"column")
                self.spire(xx, yy, height, .45, 1.8)
        for i in range(side_bays+1):
            yy=-depth/2+depth*i/side_bays
            for xx in (-width/2-.5,width/2+.5):
                for step in range(3):
                    self.box("侧廊阶梯扶壁",(1.8-step*.4,.8,height/3),(xx,yy,height/3*(step+.5)),STONE,"column")
                self.spire(xx,yy,height,.45,1.8)
        self.offset = old

    def tower(self, x, y, width, height, stages=4, color=STONE, octagonal_top=False):
        old = self.offset
        self.offset = (x,y)
        h = height/stages
        for f in range(stages):
            z = f*h
            for a in (0,math.pi/2,math.pi,math.pi*1.5):
                self.angle = a
                self.facade(width,width,z,h,3 if width>10 else 1,color)
            self.angle = 0
            self.box("塔内楼板", (width,width,.3),(0,0,z+.15),TRIM,"slab")
            for q in range(8):
                a=q*math.pi/4
                self.box("塔内旋梯踏步", (1.4,.7,.16),(math.cos(a)*1.3,math.sin(a)*1.3,z+h*(q+.5)/8),TRIM,"stair")
        for xx in (-width/2,width/2):
            for yy in (-width/2,width/2):
                self.octagon("角部八角扶壁", .8,height+1.3,(xx,yy,0))
                self.spire(xx,yy,height+1.3,.9,3.3)
        for a in (0,math.pi/2,math.pi,math.pi*1.5):
            self.angle = a
            self.box("塔顶女儿墙", (width+.5,.6,1),(0,-width/2,height+.5),TRIM,"railing")
            for i in range(7):
                self.box("垛口", (.7,.7,.7),(-width/2+width*i/6,-width/2,height+1.3),TRIM,"ornament")
        self.angle = 0
        if octagonal_top:
            self.octagon("八角钟楼基座",width*.39,.9,(0,0,height+1.5))
            for a in range(8):
                angle=a*math.pi/4
                self.octagon("钟楼柱",.28,5,(math.cos(angle)*width*.3,math.sin(angle)*width*.3,height+2.4))
            self.octagon("钟楼冠部",width*.39,.8,(0,0,height+7.4))
            self.spire(0,0,height+8.2,width*.34,2.4)
        self.offset = old

    def finish(self):
        # Groups are lazy-created by elevation: sort topologically, retaining part order.
        rank = {"building":0,"unit":1,"floor":2,"room":3}
        self.nodes.sort(key=lambda n: (rank.get(n["category"],4), n.get("unit") or 0, n.get("floor") or 0))
        return BuildingDocument.model_validate(dict(format="gugis-studio",version="1.1",coordinate_system="ENU_METERS_WGS84",
                        parameters=self.p.model_dump(),templates=self.templates,nodes=self.nodes))


def generate_british(p: BuildingParameters):
    if p.kind == "footprint":
        raise ValueError("Footprint objects must be supplied through a geometry file")
    if p.kind in {"georgian", "victorian"}:
        h, w, d = p.floor_height, 7.5, 11
        b=Assembly(p,p.floors*h)
        for u in range(1,p.units+1):
            b.unit=u
            b.offset=((u-(p.units+1)/2)*w,0)
            for f in range(p.floors):
                z=f*h
                for a in (0,math.pi):
                    b.angle=a
                    b.facade(w,d,z,h,3,BRICK if p.kind=="victorian" else STONE,False)
                b.angle=0
                for xx in (-w/2,w/2):
                    b.box("分户墙",(.25,d,h),(xx,0,z+h/2),STONE)
                b.box("楼层板",(w,d,.22),(0,0,z+.11),TRIM,"slab")
                b.box("内部隔墙",(w,.16,h),(0,1.4,z+h/2))
                for s in range(12):
                    b.box("直跑楼梯",(1.1,.3,.15),(2.6,-1.4+s*.3,z+(s+1)*h/12),STONE,"stair")
                if p.kind=="victorian":
                    # Canted bay, individually faced panes, a true projecting polygon solid.
                    outline=[(-1.65,-5.5),(-1.25,-7),(1.25,-7),(1.65,-5.5)]
                    b.profile("斜角凸窗基座",outline,.55,(0,0,z),BRICK,"wall")
                    b.profile("凸窗顶檐",outline,.22,(0,0,z+h-.2),TRIM,"ornament")
                    b.window(0,-7,z+.65,2, h-1.05,False)
                    for xx,angle in [(-1.45,-.26),(1.45,.26)]:
                        b.angle=angle
                        b.window(xx,-6.0,z+.65,.55,h-1.05,False)
                    b.angle=0
            b.roof(0,0,p.floors*h,w+.2,d+.5,3 if p.kind=="victorian" else 1.7)
            for xx in (-w/2+.5,w/2-.5):
                b.box("砖砌烟囱",(.85,1.35,2.5),(xx,1.2,p.floors*h+2.3),BRICK,"ornament")
                for yy in (.8,1.6):
                    b.octagon("陶制烟囱帽",.19,.65,(xx,yy,p.floors*h+3.55),BRICK,"ornament")
            b.box("入户门",(1.1,.16,2.2),(2.5,-5.8,1.1),"#274e57","door")
            for xx in (1.8,3.2):
                b.octagon("门廊立柱",.16,2.4,(xx,-6.2,0),TRIM)
            b.box("门廊檐口",(1.9,1.2,.25),(2.5,-6,2.55),TRIM,"ornament")
            for i in range(3):
                b.box("入口台阶",(1.9,1.8-i*.4,.16),(2.5,-6.5,i*.16),TRIM,"stair")
            if p.kind=="victorian":
                b.profile("前立面尖山墙",[(-1.8,0),(1.8,0),(0,2.8)],.35,(0,-5.65,p.floors*h-.3),BRICK,"ornament",True)
                b.window(0,-6,p.floors*h,1,1.7,True)
        return b.finish()
    height={"wills":65.5,"cabot":32,"cathedral":43}[p.kind]
    b=Assembly(p,height,SOURCES[p.kind])
    if p.kind=="wills":
        b.tower(-18,-15,14,55,5,octagonal_top=True)
        b.hall(15,-12,40,13,16,7)
        b.hall(32,10,12,31,16,3)
        b.hall(6,32,42,17,19,7)
        b.tower(34,-14,9,22,3)
    elif p.kind=="cabot":
        b.box("砂岩台基",(11,11,.8),(0,0,.4),STONE,"slab")
        b.tower(0,0,6.4,21,4,BRICK,True)
        b.box("入口门扇",(1.4,.2,2.4),(0,-3.5,1.2),IRON,"door")
    else:
        b.hall(0,0,22,78,20,6)
        b.hall(-16,4,10,70,18,3)
        b.hall(16,4,10,70,18,3)
        b.hall(0,7,56,14,21,8)
        b.tower(0,7,14,39,3)
        for x in (-14,14):
            b.tower(x,-34,9.5,34,3)
        # Rose window and radial stone tracery on the west end.
        v,f=prism([(3.8*math.cos(i*math.pi/12),3.8*math.sin(i*math.pi/12)) for i in range(24)],.16,True)
        b.solid("window","西立面玫瑰窗",dict(kind="mesh",vertices=v,triangles=f),(0,-39.5,12),GLASS)
        for i in range(12):
            a=i*math.pi/6
            # Slender closed prisms in the facade plane.
            outline=[(0,0),(.12,0),(3.6*math.cos(a)+.12,3.6*math.sin(a)),(3.6*math.cos(a),3.6*math.sin(a))]
            if abs(math.sin(a))<.01:
                b.box("玫瑰窗横梃",(7.2,.2,.12),(0,-39.7,12),TRIM,"railing")
            else:
                if math.sin(a)<0: outline.reverse()
                b.profile("玫瑰窗放射窗棂",outline,.2,(0,-39.7,12),TRIM,"railing",True)
    return b.finish()
