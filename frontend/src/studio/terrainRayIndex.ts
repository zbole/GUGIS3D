import {Cartesian3,Matrix4,type Ray} from 'cesium';
import type {Terrain,TerrainPatch} from './environment';
import type {Vec3} from './model';
import {terrainIndex,type TerrainHit} from './terrainMath';
import {terrainSampler} from './terrainScene';

type Bounds=[number,number,number,number,number,number];
type Entry={order:number;bounds:Bounds;center:Vec3;patch:TerrainPatch};
type Node={bounds:Bounds;left?:Node;right?:Node;entries?:Entry[]};
const padding=1e-7; // Same closed-box tolerance as the frozen native ray kernel.
const maxSubsetCells=256;

function intersects(bounds:Bounds,origin:Vec3,direction:Vec3){
  let near=0,far=Infinity;
  for(let axis=0;axis<3;axis++){
    if(Math.abs(direction[axis])<1e-12){
      if(origin[axis]<bounds[axis]-padding||origin[axis]>bounds[axis+3]+padding)return false;
    }else{
      const a=(bounds[axis]-origin[axis]-padding)/direction[axis];
      const b=(bounds[axis+3]-origin[axis]+padding)/direction[axis];
      near=Math.max(near,Math.min(a,b));far=Math.min(far,Math.max(a,b));
      if(near>far)return false;
    }
  }
  return near<=far;
}

/** Spatial filtering only; selected cells use the unchanged native ray solver. */
export function buildTerrainRayHierarchy(terrain:Terrain,leafSize=8){
  if(!Number.isSafeInteger(leafSize)||leafSize<2||leafSize>64)throw new Error('Invalid terrain ray leaf size');
  const native=terrainIndex(terrain),pointIds=new Map(terrain.points.map((point,index)=>[point,index]));
  const entries:Entry[]=native.cells.map((cell,order)=>{
    const min=[0,1,2].map(axis=>Math.min(...cell.points.map(point=>point[axis]))) as Vec3;
    const max=[0,1,2].map(axis=>Math.max(...cell.points.map(point=>point[axis]))) as Vec3;
    const ids=cell.points.map(point=>pointIds.get(point)!);
    // Preserve corner order, patch kind/ID and native u/v orientation. These
    // temporary one-cell patches are never exported or written to a project.
    const patch:TerrainPatch=cell.quad?{id:cell.patch.id,kind:'ruled-strip',left:[ids[0],ids[2]],right:[ids[1],ids[3]]}
      :cell.patch.kind==='triangle-fan'?{id:cell.patch.id,kind:'triangle-fan',hub:ids[0],ring:[ids[1],ids[2]]}
      :{id:cell.patch.id,kind:'triangle-strip',indices:ids};
    return {order,bounds:[...min,...max] as Bounds,center:min.map((value,axis)=>(value+max[axis])/2) as Vec3,patch};
  });
  let nodes=0,leaves=0;
  function build(items:Entry[]):Node{
    nodes++;
    const bounds:Bounds=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
    const centerMin:Vec3=[Infinity,Infinity,Infinity],centerMax:Vec3=[-Infinity,-Infinity,-Infinity];
    for(const item of items)for(let axis=0;axis<3;axis++){
      bounds[axis]=Math.min(bounds[axis],item.bounds[axis]);bounds[axis+3]=Math.max(bounds[axis+3],item.bounds[axis+3]);
      centerMin[axis]=Math.min(centerMin[axis],item.center[axis]);centerMax[axis]=Math.max(centerMax[axis],item.center[axis]);
    }
    if(items.length<=leafSize){leaves++;return {bounds,entries:items};}
    const axis=[0,1,2].reduce((best,current)=>centerMax[current]-centerMin[current]>centerMax[best]-centerMin[best]?current:best,0);
    items.sort((a,b)=>a.center[axis]-b.center[axis]||a.order-b.order);
    const middle=Math.floor(items.length/2);
    return {bounds,left:build(items.slice(0,middle)),right:build(items.slice(middle))};
  }
  const root=entries.length?build(entries):null;
  function raycastWithStats(origin:Vec3,rayDirection:Vec3){
    let nodesTested=0,cellsTested=0;
    const selected:Entry[]=[],length=Math.hypot(...rayDirection);
    const empty={hit:null as TerrainHit|null,nodesTested,cellsTested,candidateCells:0,solvedCells:0,fallback:false};
    if(!length||!Number.isFinite(length)||![...origin,...rayDirection].every(Number.isFinite)||!root)return empty;
    const direction=rayDirection.map(value=>value/length) as Vec3;
    const stack=[root];
    while(stack.length){
      const node=stack.pop()!;nodesTested++;
      if(!intersects(node.bounds,origin,direction))continue;
      if(node.entries){
        for(const entry of node.entries){
          cellsTested++;
          if(intersects(entry.bounds,origin,direction))selected.push(entry);
          // Highly overlapping sheets/long rays must not allocate a second large
          // native index per click. The original solver remains a safe fallback.
          if(selected.length>maxSubsetCells)return {hit:native.raycast(origin,rayDirection),nodesTested,cellsTested,
            candidateCells:selected.length,solvedCells:native.cells.length,fallback:true};
        }
      }else{stack.push(node.right!,node.left!);}
    }
    if(!selected.length)return {...empty,nodesTested,cellsTested};
    // Source order keeps the original solver's exact-distance ties and one-sided
    // boundary derivative choice. Do not prune by an approximate hit distance.
    selected.sort((a,b)=>a.order-b.order);
    const subset:Terrain={...terrain,patches:selected.map(entry=>entry.patch)};
    const hit=terrainIndex(subset).raycast(origin,rayDirection);
    return {hit,nodesTested,cellsTested,candidateCells:selected.length,solvedCells:selected.length,fallback:false};
  }
  return {statistics:Object.freeze({cells:entries.length,nodes,leaves,leafSize,maxSubsetCells}),raycastWithStats,
    raycast:(origin:Vec3,direction:Vec3)=>raycastWithStats(origin,direction).hit};
}

const cache=new WeakMap<Terrain,ReturnType<typeof buildTerrainRayHierarchy>>();
export function terrainRayHierarchy(terrain:Terrain){
  let index=cache.get(terrain);
  if(!index){index=buildTerrainRayHierarchy(terrain);cache.set(terrain,index);}
  return index;
}

/** Geographic wrapper; ordinary height/point analysis keeps the frozen index. */
export function acceleratedTerrainSampler(terrain?:Terrain|null,mode:'linear'|'hierarchy'='linear'){
  const sampler=terrainSampler(terrain);
  if(mode!=='linear'&&mode!=='hierarchy')throw new Error('Invalid terrain ray mode');
  if(!sampler||!terrain||mode==='linear'||sampler.index.cells.length<4096)return sampler;
  const inverse=Matrix4.inverse(sampler.frame,new Matrix4());
  return {...sampler,ray:(ray:Ray)=>{
    const origin=Matrix4.multiplyByPoint(inverse,ray.origin,new Cartesian3());
    const direction=Matrix4.multiplyByPointAsVector(inverse,ray.direction,new Cartesian3());
    const hit=terrainRayHierarchy(terrain).raycast([origin.x,origin.y,origin.z+terrain.reference_height],[direction.x,direction.y,direction.z]);
    return hit?{hit,position:Matrix4.multiplyByPoint(sampler.frame,new Cartesian3(hit.x,hit.y,hit.height-terrain.reference_height),new Cartesian3())}:null;
  }};
}
