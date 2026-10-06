import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
import {decodeSourceBandBinary,encodeSourceBandBinary,prepareSourceBandQuery} from '../src/compare/sourceRuledBandMath.ts';
const root=path.resolve('..'),folder=path.resolve(process.argv[2]),sha=b=>createHash('sha256').update(b).digest('hex');
const raw=await readFile(path.join(folder,'results.json')),report=JSON.parse(raw),body=await readFile(path.join(folder,report.reference.filename));
assert.equal(sha(body),report.reference.sha256);assert.equal(body.length,513*513*4);const dv=new DataView(body.buffer,body.byteOffset,body.byteLength),grid=Array.from({length:513*513},(_,i)=>dv.getFloat32(i*4,true));
const reference=(tile,x,y)=>{
  const fx=x+32,fy=y+32,i=64*tile.column+Math.min(63,Math.max(0,Math.ceil(fx)-1)),j=64*tile.row+Math.min(63,Math.max(0,Math.ceil(fy)-1)),u=fx-(i-64*tile.column),v=fy-(j-64*tile.row);
  const a=grid[j*513+i],b=grid[j*513+i+1],c=grid[(j+1)*513+i],d=grid[(j+1)*513+i+1],mixed=a-b-c+d;
  return {height:a+(b-a)*u+(c-a)*v+mixed*u*v,gradient:[b-a+mixed*v,c-a+mixed*u]};
};
const prepared=[],rows=[];
for(const tile of report.tiles){
  const bytes=await readFile(path.join(folder,tile.filename));assert.equal(bytes.length,tile.bytes);assert.equal(sha(bytes),tile.sha256);
  const model=decodeSourceBandBinary(bytes);assert.equal(sha(new Uint8Array(encodeSourceBandBinary(model))),tile.sha256);assert.deepEqual(model.origin_bng,tile.origin_bng);assert.deepEqual(model.clip_bounds,[-32,-32,32,32]);assert.equal(model.points.length,4225);assert.equal(model.patches.length,64);assert.ok(model.patches.every(p=>p.kind==='ruled-strip'));
  const fn=prepareSourceBandQuery(model);prepared.push(fn);let maxHeight=0,maxGradient=0,count=0,nodeCount=0;
  const check=(x,y,isNode=false)=>{
    const actual=fn.query(x,y),wanted=reference(tile,x,y);assert.ok(actual);assert.equal(actual.easting,tile.origin_bng[0]+x);assert.equal(actual.northing,tile.origin_bng[1]+y);
    const dz=Math.abs(actual.height-wanted.height),dg=Math.max(...actual.gradient.map((v,i)=>Math.abs(v-wanted.gradient[i])));maxHeight=Math.max(maxHeight,dz);maxGradient=Math.max(maxGradient,dg);assert.ok(dz<1e-8&&dg<1e-8);if(isNode)nodeCount++;else count++;
  };
  for(let j=0;j<64;j++)for(let i=0;i<64;i++)check(i-32+.271828182846,j-32+.414213562373);
  for(let j=0;j<65;j++)for(let i=0;i<65;i++)check(i-32,j-32,true);
  assert.equal(fn.query(-32.01,0),null);assert.equal(fn.query(32.01,0),null);assert.equal(fn.query(0,-32.01),null);assert.equal(fn.query(0,32.01),null);
  rows.push({id:tile.id,binary_sha256:tile.sha256,internal_queries:count,original_node_queries:nodeCount,max_height_difference_m:maxHeight,max_gradient_difference:maxGradient,world_coordinates_verified:true,outside_rejected:true});console.log(tile.id+': all cells and source nodes retain native height and gradients');
}
let seams=0,seamNodes=0,maxSeamHeight=0,maxTangentialGradient=0;
for(const tile of report.tiles){
  const current=prepared[tile.row*8+tile.column];
  for(const [valid,nextIndex,horizontal] of [[tile.column<7,tile.row*8+tile.column+1,false],[tile.row<7,(tile.row+1)*8+tile.column,true]])if(valid){
    const next=prepared[nextIndex];for(let k=0;k<=128;k++){
      const along=-32+k/2,a=current.query(horizontal?along:32,horizontal?32:along),b=next.query(horizontal?along:-32,horizontal?-32:along);assert.ok(a&&b);const dz=Math.abs(a.height-b.height);maxSeamHeight=Math.max(maxSeamHeight,dz);assert.ok(dz<1e-8);
      if(k%2){const dg=Math.abs(a.gradient[horizontal?0:1]-b.gradient[horizontal?0:1]);maxTangentialGradient=Math.max(maxTangentialGradient,dg);assert.ok(dg<1e-8);seams++;}else seamNodes++;
    }
  }
}
assert.equal(seams,7168);assert.equal(seamNodes,7280);
const scripts={};for(const name of ['frontend/scripts/audit-ruled-terrain-tiles.mjs','frontend/src/compare/sourceRuledBandMath.ts','frontend/src/compare/principalRuledMath.ts'])scripts[name]=sha((await readFile(path.join(root,name),'utf8')).replaceAll('\r\n','\n'));
await writeFile(path.join(folder,'native-audit.json'),JSON.stringify({schema:'gugis-ruled-terrain-tile-audit-v1',report_sha256:sha(raw),scripts,tiles:rows,total_internal_queries:rows.reduce((s,r)=>s+r.internal_queries,0),total_source_node_queries:rows.reduce((s,r)=>s+r.original_node_queries,0),seam_midpoint_pairs:seams,seam_source_node_pairs:seamNodes,max_seam_height_difference_m:maxSeamHeight,max_tangential_gradient_difference:maxTangentialGradient,scope:'Original-resolution local DTM function agreement and C0 height seams. Normal gradients may jump at source-cell boundaries. No performance, heap-memory or surveyed-ground accuracy claim.'}));
console.log('Verified all 64 actual native files, 532544 height/gradient queries and 14448 seam pairs');
