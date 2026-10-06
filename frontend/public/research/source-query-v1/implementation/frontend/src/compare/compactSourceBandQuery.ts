// Additive fast path for the published, complete 65 x 65 Float32 source windows.
// The frozen GPR4 reader/validator and generic query kernel remain unchanged.
import {prepareSourceBandQuery,validateSourceBandModel} from './sourceRuledBandMath.ts';

export function prepareCompactSourceBandQuery(value:unknown){
  const model=validateSourceBandModel(value),[west,south,east,north]=model.clip_bounds;
  const regular=model.points.length===4225&&model.patches.length===64&&east-west===64&&north-south===64&&Number.isInteger(west)&&Number.isInteger(south)&&
    model.points.every((p,id)=>p[0]===west+id%65&&p[1]===south+Math.floor(id/65)&&Math.fround(p[2])===p[2])&&
    model.patches.every((p,j)=>p.kind==='ruled-strip'&&p.left.length===65&&p.right.length===65&&p.left.every((id,i)=>id===j*65+i)&&p.right.every((id,i)=>id===(j+1)*65+i));
  if(!regular)return {...prepareSourceBandQuery(model),implementation:'generic-source-band' as const};
  const heights=Float64Array.from(model.points,p=>p[2]),origin=[...model.origin_bng];
  // Match the frozen 32 x 32 candidate index, its 1e-11 tolerance and first-hit
  // ownership. C0 height continuity does not imply equal gradients at seams.
  const locate=(coordinate:number,start:number)=>{
    const offset=coordinate-start,bin=Math.min(31,Math.floor(offset/2)),first=Math.max(0,2*bin-1),last=Math.min(63,2*bin+1);
    let cell=Math.max(first,Math.min(63,Math.floor(offset)-1));
    while(cell<=last){const local=coordinate-(start+cell);if(local>=-1e-11&&local<=1+1e-11)return [cell,local];cell++;}
    return null;
  };
  const query=(x:number,y:number)=>{
    if(!Number.isFinite(x)||!Number.isFinite(y)||x<west||x>east||y<south||y>north)return null;
    const horizontal=locate(x,west),vertical=locate(y,south);if(!horizontal||!vertical)return null;
    const [i,u]=horizontal,[j,v]=vertical,a=heights[j*65+i],b=heights[j*65+i+1],c=heights[(j+1)*65+i],d=heights[(j+1)*65+i+1];
    const along=b-a,across=c-a,mixed=d-c-b+a;
    return {height:a+u*along+v*(across+u*mixed),gradient:[along+v*mixed,across+u*mixed],patch:j,primitive:j*64+i,kind:'ruled-strip',u,v,segment:i,easting:origin[0]+x,northing:origin[1]+y};
  };
  return {query,primitives:4096,execution_points:4225,stored_points:4225,stored_patches:64,implementation:'compact-source-band' as const};
}
