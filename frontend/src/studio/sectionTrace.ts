import { Cartesian3, Cartographic, Matrix3, Matrix4, Transforms, Math as CM } from "@cesium/engine";
import type { CityDocument } from "./cityModel";
import type { Solid, Vec3 } from "./model";
import type { AnalysisPoint } from "./terrainAnalysis";
import { functionSolid, type Terrain } from "./environment";
import { terrainIndex } from "./terrainMath";

export interface TraceSegment { start: [number, number]; end: [number, number] }
export interface SectionTrace {
  objectId: string;
  segments: TraceSegment[];
  truncated: boolean;
  unavailable?: "no-terrain" | "no-source-height" | "object-missing";
  /** Triangles are the displayed solid's tessellation; source functions remain parametric. */
  basis: "rendered-solid-triangles";
}
type XYZ = { x: number; y: number; z: number };
const boxCorners: Vec3[] = [
  [-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],
  [-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1],
];
const boxFaces: Vec3[] = [
  [0,2,1],[0,3,2], [4,5,6],[4,6,7],
  [0,1,5],[0,5,4], [1,2,6],[1,6,5],
  [2,3,7],[2,7,6], [3,0,4],[3,4,7],
];
function triangleMesh(solid: Solid) {
  if (solid.kind !== "box") return { vertices: solid.vertices ?? [], triangles: solid.triangles ?? [] };
  const [width, depth, height] = solid.size!;
  return { vertices: boxCorners.map(([x,y,z]) => [x*width/2,y*depth/2,z*height/2] as Vec3), triangles: boxFaces };
}
function placeFrame(longitude: number, latitude: number, altitude: number, heading: number) {
  return Matrix4.multiplyByMatrix3(
    Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(longitude, latitude, altitude)),
    Matrix3.fromRotationZ(CM.toRadians(-heading)), new Matrix4());
}
function closest(a: XYZ, b: XYZ) { return Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z) < 1e-7; }
function cross(a: XYZ, b: XYZ, c: XYZ) { return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x); }
function interpolate(a: XYZ, b: XYZ, t: number): XYZ { return {
  x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t };
}
function inFiniteRoute(a: XYZ, b: XYZ, start: XYZ, end: XYZ, cumulative: number) {
  const dx=end.x-start.x, dy=end.y-start.y, length=Math.hypot(dx,dy);
  if(length<1e-7) return null;
  const station=(p: XYZ)=>((p.x-start.x)*dx+(p.y-start.y)*dy)/length;
  let sa=station(a),sb=station(b),lo=0,hi=1;
  if(Math.abs(sa-sb)<1e-10) { if(sa<0||sa>length) return null; }
  else {
    const t0=(0-sa)/(sb-sa), t1=(length-sa)/(sb-sa);
    lo=Math.max(0,Math.min(t0,t1));hi=Math.min(1,Math.max(t0,t1));
    if(hi<lo) return null;
  }
  const p=interpolate(a,b,lo),q=interpolate(a,b,hi);
  sa=station(p);sb=station(q);
  return { start:[cumulative+Math.max(0,Math.min(length,sa)),p.z] as [number,number],
    end:[cumulative+Math.max(0,Math.min(length,sb)),q.z] as [number,number] };
}
function triangleIntersection(vertices: XYZ[], start: XYZ, end: XYZ) {
  const distances=vertices.map(p=>cross(start,end,p));
  // A coplanar triangle's diagonal is a tessellation artifact. Neighbouring
  // non-coplanar faces provide its actual boundary at this section plane.
  if(distances.every(value=>Math.abs(value)<1e-8))return null;
  const points: XYZ[]=[];
  const add=(p: XYZ)=>{ if(!points.some(q=>closest(p,q))) points.push(p); };
  for(const [i,j] of [[0,1],[1,2],[2,0]]) {
    const da=distances[i],db=distances[j],a=vertices[i],b=vertices[j];
    if(Math.abs(da)<1e-8) add(a);
    if(da*db<0) add(interpolate(a,b,da/(da-db)));
    if(Math.abs(db)<1e-8) add(b);
  }
  if(points.length<2) return null;
  // A coplanar triangle contributes its longest edge; duplicate edges from
  // adjacent triangles are removed after projection.
  let pair:[XYZ,XYZ]=[points[0],points[1]],max=0;
  for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++) {
    const d=Math.hypot(points[i].x-points[j].x,points[i].y-points[j].y,points[i].z-points[j].z);
    if(d>max){max=d;pair=[points[i],points[j]];}
  }
  return max>1e-7?pair:null;
}
function key(segment: TraceSegment) {
  const parts=[segment.start,segment.end].map(p=>`${Math.round(p[0]*1000)}:${Math.round(p[1]*1000)}`).sort();
  return parts.join("/");
}
/** Plane intersections of the stored model at the current display tessellation. */
export function traceCityObject(city: CityDocument, path: AnalysisPoint[], objectId: string, limit = 5000): SectionTrace {
  if(path.length<2||path.length>64||limit<1) throw new RangeError("需要 2–64 个路线点及正数的交线预算。");
  const terrain=city.environment?.terrain,reference=terrain?.reference_height??0;
  if(!Number.isInteger(limit)||path.some(p=>![p.longitude,p.latitude,p.altitude].every(Number.isFinite)))
    throw new RangeError("剖切需要有效的路线坐标与正整数交线预算。");
  const empty=(unavailable:SectionTrace["unavailable"]):SectionTrace=>({objectId,segments:[],truncated:false,
    unavailable,basis:"rendered-solid-triangles"});
  if(!terrain)return empty("no-terrain");
  const anchor=terrain;
  const inverse=Matrix4.inverse(Transforms.eastNorthUpToFixedFrame(
    Cartesian3.fromDegrees(anchor.longitude,anchor.latitude)),new Matrix4());
  const local=(p: Cartesian3)=>{
    const projected=Matrix4.multiplyByPoint(inverse,p,new Cartesian3());
    // Preserve the scene's geodetic height rather than the anchor ENU Z,
    // which accumulates Earth-curvature drift across a city-wide route.
    projected.z=Cartographic.fromCartesian(p).height;
    return projected;
  };
  const route=path.map(p=>local(Cartesian3.fromDegrees(p.longitude,p.latitude)));
  let cumulative=0;
  const routeSegments=route.slice(1).map((end,i)=>{
    const start=route[i], current={start,end,cumulative};
    cumulative+=Math.hypot(end.x-start.x,end.y-start.y);
    return current;
  });
  const segments:TraceSegment[]=[],seen=new Set<string>();
  let truncated=false;
  const process=(solid:Solid,frame:Matrix4)=>{
    const mesh=triangleMesh(solid);
    const vertices=mesh.vertices.map(v=>local(Matrix4.multiplyByPoint(frame,new Cartesian3(...v),new Cartesian3())));
    for(const face of mesh.triangles) {
      const a=vertices[face[0]],b=vertices[face[1]],c=vertices[face[2]];
      if(!a||!b||!c) continue;
      for(const routePart of routeSegments) {
        const crossing=triangleIntersection([a,b,c],routePart.start,routePart.end);
        if(!crossing) continue;
        const segment=inFiniteRoute(crossing[0],crossing[1],routePart.start,routePart.end,routePart.cumulative);
        if(!segment) continue;
        segment.start[1]+=reference;segment.end[1]+=reference;
        const signature=key(segment);
        if(!seen.has(signature)) { seen.add(signature);segments.push(segment); }
        if(segments.length>=limit) { truncated=true; return; }
      }
    }
  };
  const building=city.instances.find(item=>item.id===objectId);
  if(building) {
    const document=city.assets[building.asset];
    if(!document)return empty("object-missing");
    const ground=terrainAt(terrain,building.longitude,building.latitude);
    if(ground===null)return empty("no-source-height");
    const sceneGround=city.environment?.drape_buildings ? ground : 0;
    const base=placeFrame(building.longitude,building.latitude,building.altitude+sceneGround,building.heading);
    for(const node of document.nodes) {
      if(!node.template||!node.position)continue;
      const solid=document.templates[node.template]; if(!solid)continue;
      const localFrame=Matrix4.multiplyByMatrix3(
        Matrix4.multiplyByTranslation(base,new Cartesian3(...node.position),new Matrix4()),
        Matrix3.fromRotationZ(CM.toRadians(node.rotation_z??0)),new Matrix4());
      process(solid,localFrame);if(truncated)break;
    }
  } else {
    const placement=city.environment?.features.find(item=>item.id===objectId);
    if(!placement)return empty("object-missing");
    const asset=city.environment!.feature_assets[placement.asset];
    if(!asset)return empty("object-missing");
    const ground=terrainAt(terrain,placement.longitude,placement.latitude);
    if(ground===null)return empty("no-source-height");
    const frame=Matrix4.multiplyByUniformScale(placeFrame(placement.longitude,placement.latitude,
      placement.altitude+ground,placement.heading),placement.scale,new Matrix4());
    for(const component of asset.components) {
      const localFrame=Matrix4.multiplyByTranslation(frame,new Cartesian3(...component.position),new Matrix4());
      process(functionSolid(component,24),localFrame);if(truncated)break;
    }
  }
  return {objectId,segments,truncated,basis:"rendered-solid-triangles"};
}

function terrainAt(terrain: Terrain, longitude:number,latitude:number) {
  const inverse=Matrix4.inverse(Transforms.eastNorthUpToFixedFrame(
    Cartesian3.fromDegrees(terrain.longitude,terrain.latitude)),new Matrix4());
  const p=Matrix4.multiplyByPoint(inverse,Cartesian3.fromDegrees(longitude,latitude),new Cartesian3());
  // Use the same native surface as the scene and semantic queries.
  const hit=terrainIndex(terrain).query(p.x,p.y);
  return hit ? hit.height-terrain.reference_height : null;
}
