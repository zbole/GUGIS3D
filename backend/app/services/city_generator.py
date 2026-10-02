"""Offline city construction from retained OSM geometry and editable solid assets."""
import json
import math
from pathlib import Path
from .building_generator import generate_building, document_bytes
from ..studio_models import BuildingDocument, BuildingParameters
from ..city_models import CityDocument


def triangulate_ring(points):
    """Ear clipping for simple rings; reject ambiguous/degenerate input."""
    def cross(a,b,c): return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
    p=[]
    for q in points:
        if not p or math.dist(p[-1],q) > .005: p.append(q)
    if len(p)>1 and math.dist(p[0],p[-1])<.005: p.pop()
    changed=True
    while changed and len(p)>3:
        changed=False
        for i in range(len(p)):
            if abs(cross(p[i-1],p[i],p[(i+1)%len(p)]))<1e-7:
                p.pop(i); changed=True; break
    if not 3<=len(p)<=120: raise ValueError("Footprint must have 3–120 non-collinear vertices")
    if sum(p[i][0]*p[(i+1)%len(p)][1]-p[(i+1)%len(p)][0]*p[i][1] for i in range(len(p)))<0: p.reverse()
    remaining=list(range(len(p))); faces=[]
    while len(remaining)>3:
        for k,b in enumerate(remaining):
            a,c=remaining[k-1],remaining[(k+1)%len(remaining)]
            if cross(p[a],p[b],p[c])<=1e-8: continue
            if any(min(cross(p[a],p[b],p[j]),cross(p[b],p[c],p[j]),cross(p[c],p[a],p[j]))>=-1e-8 for j in remaining if j not in (a,b,c)): continue
            faces.append([a,b,c]);remaining.pop(k);break
        else: raise ValueError("Footprint is self-intersecting or cannot be triangulated")
    faces.append(remaining)
    return p,faces


def footprint_document(ring, name, height=10, source="用户提供的 GeoJSON", height_source="假设高度"):
    lon=sum(q[0] for q in ring)/len(ring);lat=sum(q[1] for q in ring)/len(ring)
    sx=111320*math.cos(math.radians(lat)); sy=111320
    points,top=triangulate_ring([((x-lon)*sx,(y-lat)*sy) for x,y,*_ in ring])
    n=len(points)
    vertices=[[round(x,5),round(y,5),z] for z in (0,height) for x,y in points]
    triangles=[[c,b,a] for a,b,c in top]+[[a+n,b+n,c+n] for a,b,c in top]
    for i in range(n):
        j=(i+1)%n;triangles.extend([[i,j,n+j],[i,n+j,n+i]])
    p=BuildingParameters(kind="footprint",name=name[:80],floors=1,units=1,longitude=lon,latitude=lat)
    nodes=[dict(id="building",name=p.name,category="building",attributes={"数据来源":source[:200],"精度说明":"LoD1 轮廓实体，未复原内部与立面", "高度依据":height_source[:200]}),
           dict(id="u1",parent="building",name="建筑",category="unit",unit=1),
           dict(id="u1f1",parent="u1",name="整体体量",category="floor",unit=1,floor=1),
           dict(id="room",parent="u1f1",name="未细分空间",category="room",unit=1,floor=1),
           dict(id="volume",parent="room",name="真实轮廓 / 推算体量",category="wall",unit=1,floor=1,template="volume",position=[0,0,0])]
    return BuildingDocument.model_validate(dict(format="gugis-studio",version="1.1",coordinate_system="ENU_METERS_WGS84",parameters=p.model_dump(),
                   templates={"volume":dict(kind="mesh",color="#aab5be",vertices=vertices,triangles=triangles)},nodes=nodes))


def city_bytes(city):
    payload=city.model_dump(mode="json",exclude_none=True)
    payload["assets"]={key:json.loads(document_bytes(doc)) for key,doc in city.assets.items()}
    return json.dumps(payload,ensure_ascii=False,separators=(",",":")).encode("utf-8")


def seed_city(detailed=True):
    osm=json.loads((Path(__file__).resolve().parents[2]/"data"/"bristol-osm.json").read_text(encoding="utf-8"))
    assets,instances,roads={},[],[]
    def add(id,doc,lon=None,lat=None,heading=0,name=None):
        assets[id]=doc
        p=doc.parameters
        instances.append(dict(id=id,asset=id,name=name or p.name,longitude=lon if lon is not None else p.longitude,latitude=lat if lat is not None else p.latitude,altitude=0,heading=heading))
    landmarks=[("wills",175488942,"Wills Memorial Building",-2.6044,51.4563,8,-14),
               ("cabot",22751075,"Cabot Tower",-2.6069,51.4540,5,0),
               ("cathedral",48937931,"Bristol Cathedral",-2.6007,51.4517,6,-90)]
    # WGS84 anchors come from retained OSM outlines; detailed shapes remain interpretive.
    excluded={i[1] for i in landmarks}
    for kind,osmid,name,lon,lat,floors,heading in landmarks:
        e=next((e for e in osm["elements"] if e["id"]==osmid),None)
        if e:
            coords=e["geometry"][:-1]
            lon=sum(q["lon"] for q in coords)/len(coords);lat=sum(q["lat"] for q in coords)/len(coords)
        add(kind,generate_building(BuildingParameters(kind=kind,name=name,floors=floors,units=1,longitude=lon,latitude=lat)),heading=heading)
    candidates=[]
    for e in osm["elements"]:
        tags=e["tags"]; geom=e.get("geometry",[])
        if len(geom)<2:continue
        if "building" in tags and e["id"] not in excluded and geom[0]==geom[-1]:
            lon=sum(q["lon"] for q in geom)/len(geom);lat=sum(q["lat"] for q in geom)/len(geom)
            distance=((lon+2.603)*.623)**2+(lat-51.454)**2
            candidates.append((distance,e))
        elif "highway" in tags and tags.get("area")!="yes":
            roads.append(dict(id=f"r{e['id']}",name=tags.get("name","街道")[:100],width=3 if tags["highway"] in {"footway","path","steps"} else 7,
                              coordinates=[[q["lon"],q["lat"]] for q in geom]))
    skipped=0
    for _,e in sorted(candidates,key=lambda pair:pair[0]):
        if len(instances)>=603:break
        tags=e["tags"]
        try:
            try: height=float(tags.get("height",""));reason="OSM height 标签（未测量核验）"
            except ValueError:
                try: height=float(tags.get("building:levels","3"))*3.2;reason="OSM 楼层 × 3.2 m" if "building:levels" in tags else "缺少高度：假设 3 层 × 3.2 m"
                except ValueError:height=9.6;reason="不可解析高度：假设 9.6 m"
            if not 1<=height<=150:height=9.6;reason="异常高度：假设 9.6 m"
            name=tags.get("name") or " ".join(filter(None,[tags.get("addr:housenumber"),tags.get("addr:street")])) or f"街区建筑 · {e['id']}"
            doc=footprint_document([[q["lon"],q["lat"]] for q in e["geometry"]],name,height,f"OpenStreetMap way/{e['id']} · ODbL 1.0",reason)
            add(f"osm{e['id']}",doc)
        except ValueError:skipped+=1
    # A separate design block demonstrates instance reuse without claiming these are surveyed houses.
    for kind,latitude in [("georgian",51.4527),("victorian",51.45225)]:
        asset=generate_building(BuildingParameters(kind=kind,name=f"英式街区设计 · {kind}",floors=3,units=1))
        assets[kind]=asset
        for i in range(6):
            instances.append(dict(id=f"{kind}{i}",asset=kind,name=f"设计街区 · {'乔治式' if kind=='georgian' else '维多利亚式'} {i+1}",longitude=-2.6084+i*.00012,latitude=latitude,altitude=0,heading=0))
    city = CityDocument.model_validate(dict(format="gugis-city",version="1.0",coordinate_system="ENU_METERS_WGS84",name="布里斯托 · 城市复现项目",assets=assets,instances=instances,roads=roads,
        metadata={"范围":"Brandon Hill / Park Street / College Green 周边的起始街区；非全市完整模型", "轮廓数据":"© OpenStreetMap contributors · ODbL 1.0", "许可":"https://www.openstreetmap.org/copyright", "数据库许可":"https://opendatacommons.org/licenses/odbl/1-0/", "数据时间":osm.get("osm3s",{}).get("timestamp_osm_base",""),
                  "精度说明":"真实 OSM 轮廓与街道；多数高度推算。地标为形态参考，设计街区为合成示范。无地形高程。", "采样说明":f"按距核心区中心距离选取 600 个可转换建筑轮廓；跳过 {skipped} 个不支持的轮廓；未获取 multipolygon 关系。"}))
    if detailed:
        from .urban_detail import refine_city
        return refine_city(city,{str(e["id"]):e.get("tags",{}) for e in osm["elements"]})
    return city
