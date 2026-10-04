import type { Terrain } from '../studio/environment';
import type { Vec3 } from '../studio/model';
import { patchFaces, ruledPoint } from '../studio/terrainMath';
export type ResearchMesh = {vertices:Vec3[];triangles:Vec3[]};

/** Exact coordinate interning: no rounding, resampling or face removal. */
export function shareResearchVertices(mesh:ResearchMesh):ResearchMesh{
  const vertices:Vec3[]=[],lookup=new Map<string,number>();
  const indices=mesh.vertices.map(point=>{
    if(!point.every(Number.isFinite))throw new Error('Nonfinite research display vertex');
    const key=point.join(',');
    const existing=lookup.get(key);
    if(existing!==undefined)return existing;
    const index=vertices.length;lookup.set(key,index);vertices.push(point);return index;
  });
  return {vertices,triangles:mesh.triangles.map(face=>face.map(index=>indices[index]) as Vec3)};
}
/** Display-only tessellation. Native archives and query statistics stay intact. */
export function researchTerrainMeshes(terrain:Terrain,tolerance:number,maxVertices=180000,shareVertices=true){
  if(!Number.isFinite(tolerance)||tolerance<=0)throw new Error('Invalid display tolerance');
  if(!Number.isSafeInteger(maxVertices)||maxVertices<1)throw new Error('Invalid display vertex budget');
  if(typeof shareVertices!=='boolean')throw new Error('Invalid display sharing option');
  const quads=terrain.patches.filter(p=>p.kind==='ruled-strip').flatMap(p=>p.left!.slice(0,-1).map((a,i)=>{
    const corners=[a,p.right![i],p.left![i+1],p.right![i+1]].map(id=>terrain.points[id]);
    if([0,1].some(axis=>Math.abs(corners[3][axis]-corners[1][axis]-corners[2][axis]+corners[0][axis])>1e-8))
      throw new Error('研究显示误差界仅适用于平行四边形投影');
    const twist=Math.abs(corners[3][2]-corners[1][2]-corners[2][2]+corners[0][2]);
    return {corners,twist,divisions:Math.max(1,Math.min(256,Math.ceil(Math.sqrt(twist/(4*tolerance)))))};
  }));
  const faces=terrain.patches.filter(p=>p.kind!=='ruled-strip').flatMap(p=>patchFaces(p));
  let estimated=faces.length*3+quads.reduce((sum,q)=>sum+(q.divisions+1)**2,0);
  while(estimated>maxVertices&&quads.some(q=>q.divisions>1)){
    for(const q of quads)q.divisions=Math.max(1,Math.floor(q.divisions/2));
    estimated=faces.length*3+quads.reduce((sum,q)=>sum+(q.divisions+1)**2,0);
  }
  if(estimated>maxVertices)throw new Error('研究地形超过显示顶点预算，请使用较粗的误差档位');
  const ruled:ResearchMesh={vertices:[],triangles:[]},triangles:ResearchMesh={vertices:[],triangles:[]};
  for(const face of faces){const offset=triangles.vertices.length;triangles.vertices.push(...face.map(id=>terrain.points[id]));triangles.triangles.push([offset,offset+1,offset+2]);}
  let displayBound=0;
  for(const {corners,divisions:d,twist} of quads){
    const start=ruled.vertices.length;
    for(let v=0;v<=d;v++)for(let u=0;u<=d;u++)ruled.vertices.push(ruledPoint(...corners as [Vec3,Vec3,Vec3,Vec3],u/d,v/d));
    for(let v=0;v<d;v++)for(let u=0;u<d;u++){
      const a=start+v*(d+1)+u,b=a+1,c=a+d+1,e=c+1;
      ruled.triangles.push([a,b,c],[b,e,c]);
    }
    displayBound=Math.max(displayBound,twist/(4*d*d));
  }
  const meshes={'ruled-strip':shareVertices?shareResearchVertices(ruled):ruled,
    'triangle-strip':shareVertices?shareResearchVertices(triangles):triangles,
    'triangle-fan':{vertices:[],triangles:[]} as ResearchMesh};
  const vertices=Object.values(meshes).reduce((sum,mesh)=>sum+mesh.vertices.length,0);
  return {meshes,displayBound,vertices,expandedVertices:estimated,sharedVertices:shareVertices,
    vertexSavingPercent:estimated?(1-vertices/estimated)*100:0,capped:displayBound>tolerance};
}
