import type {Terrain} from '../studio/environment';
import type {Vec3} from '../studio/model';
import {patchFaces,ruledPoint} from '../studio/terrainMath';

type Mesh={vertices:Vec3[];triangles:Vec3[]};
/** Parametric 3D display bound, including curved ENU XY. Not fixed-XY height error. */
export function boundedTerrainDisplay(terrain:Terrain,tolerance=.1,maxExpandedVertices=200000){
  if(!Number.isFinite(tolerance)||tolerance<=0||!Number.isSafeInteger(maxExpandedVertices)||maxExpandedVertices<1)throw new Error('显示精度或顶点预算无效。');
  const quads=terrain.patches.filter(p=>p.kind==='ruled-strip').flatMap(p=>p.left!.slice(0,-1).map((a,i)=>{
    const corners=[a,p.right![i],p.left![i+1],p.right![i+1]].map(id=>terrain.points[id]);
    if(!corners.flat().every(Number.isFinite))throw new Error('地形显示包含非有限坐标。');
    const twist=Math.hypot(...[0,1,2].map(axis=>corners[3][axis]-corners[1][axis]-corners[2][axis]+corners[0][axis]));
    return {corners,twist,divisions:Math.max(1,Math.min(256,Math.ceil(Math.sqrt(twist/(4*tolerance)))))};
  }));
  if(terrain.patches.some(p=>p.kind!=='ruled-strip'&&p.kind!=='triangle-strip'))throw new Error('公开预览仅接受直纹面带与三角带。');
  const faces=terrain.patches.filter(p=>p.kind==='triangle-strip').flatMap(p=>patchFaces(p));
  const estimated=()=>faces.length*3+quads.reduce((sum,q)=>sum+(q.divisions+1)**2,0);
  while(estimated()>maxExpandedVertices&&quads.some(q=>q.divisions>1))for(const q of quads)q.divisions=Math.max(1,Math.floor(q.divisions/2));
  const expanded=estimated();if(expanded>maxExpandedVertices)throw new Error('当前地形超过显示预算；未截断模型。');
  const ruled:Mesh={vertices:[],triangles:[]},triangles:Mesh={vertices:[],triangles:[]};
  for(const face of faces){const start=triangles.vertices.length;const vertices=face.map(id=>terrain.points[id]);if(!vertices.flat().every(Number.isFinite))throw new Error('三角面坐标无效。');triangles.vertices.push(...vertices);triangles.triangles.push([start,start+1,start+2]);}
  let bound=0;
  for(const {corners,divisions:d,twist} of quads){
    const start=ruled.vertices.length;
    for(let v=0;v<=d;v++)for(let u=0;u<=d;u++)ruled.vertices.push(ruledPoint(...corners as [Vec3,Vec3,Vec3,Vec3],u/d,v/d));
    for(let v=0;v<d;v++)for(let u=0;u<d;u++){const a=start+v*(d+1)+u,b=a+1,c=a+d+1,e=c+1;ruled.triangles.push([a,b,c],[b,e,c]);}
    bound=Math.max(bound,twist/(4*d*d));
  }
  function share(mesh:Mesh):Mesh{
    const vertices:Vec3[]=[],map=new Map<string,number>();
    const ids=mesh.vertices.map(point=>{const key=point.join(',');let id=map.get(key);if(id===undefined){id=vertices.length;map.set(key,id);vertices.push(point);}return id;});
    return {vertices,triangles:mesh.triangles.map(face=>face.map(id=>ids[id]) as Vec3)};
  }
  const meshes={'ruled-strip':share(ruled),'triangle-strip':share(triangles),'triangle-fan':{vertices:[],triangles:[]} as Mesh};
  return {meshes,displayDistanceBound:bound,capped:bound>tolerance,expandedVertices:expanded,vertices:Object.values(meshes).reduce((n,m)=>n+m.vertices.length,0)};
}
