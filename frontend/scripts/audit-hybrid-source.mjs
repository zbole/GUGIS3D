import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import {decodeSourceBandBinary,encodeSourceBandBinary,prepareSourceBandQuery} from '../src/compare/sourceRuledBandMath.ts';
const root=path.resolve('..'),folder=path.resolve(process.argv[2]),sha=b=>createHash('sha256').update(b).digest('hex');
if(!process.argv[2]||path.relative(root,folder).startsWith('..'))throw Error('Explicit repository research directory required');
const raw=await readFile(path.join(folder,'results.json')),report=JSON.parse(raw),rows=[];
function geometry(a,b,c,x,y){const ax=b[0]-a[0],ay=b[1]-a[1],bx=c[0]-a[0],by=c[1]-a[1],det=ax*by-ay*bx,inv=[by/det,-bx/det,-ay/det,ax/det];return{u:inv[0]*(x-a[0])+inv[1]*(y-a[1]),v:inv[2]*(x-a[0])+inv[3]*(y-a[1]),inv};}
function evaluate(p,x,y){const [a,b,c,d]=p.points,{u,v,inv}=geometry(a,b,c,x,y);let height,du,dv;if(p.kind==='ruled-strip'){height=(1-u)*(1-v)*a[2]+u*(1-v)*b[2]+(1-u)*v*c[2]+u*v*d[2];du=(1-v)*(b[2]-a[2])+v*(d[2]-c[2]);dv=(1-u)*(c[2]-a[2])+u*(d[2]-b[2]);}else{height=(1-u-v)*a[2]+u*b[2]+v*c[2];du=b[2]-a[2];dv=c[2]-a[2];}return {height,gradient:[du*inv[0]+dv*inv[2],du*inv[1]+dv*inv[3]]};}
function cell(m,e,i,j,u,v){const w=e.nx+1,a=m.points[j*w+i][2],b=m.points[j*w+i+1][2],c=m.points[(j+1)*w+i][2],d=m.points[(j+1)*w+i+1][2];return e.families[j*e.nx+i]==='ruled'?(1-u)*(1-v)*a+u*(1-v)*b+(1-u)*v*c+u*v*d:u+v<=1?(1-u-v)*a+u*b+v*c:(u+v-1)*d+(1-u)*c+(1-v)*b;}
for(const c of report.cases){
  const out=path.join(folder,c.id),reference=JSON.parse(await readFile(path.join(out,'reference.json')));assert.equal(c.candidates.length,147);const expected=new Set(['reference.json','source-window.tif',...c.candidates.flatMap(e=>[e.filename,e.binary_filename])]);assert.deepEqual((await readdir(out)).sort(),[...expected].sort());
  for(const e of c.candidates){
    const jr=await readFile(path.join(out,e.filename)),br=await readFile(path.join(out,e.binary_filename));assert.equal(jr.length,e.bytes);assert.equal(br.length,e.binary_bytes);assert.equal(sha(jr),e.sha256);assert.equal(sha(br),e.binary_sha256);const m=decodeSourceBandBinary(br);assert.deepEqual(m,JSON.parse(jr));assert.equal(sha(new Uint8Array(encodeSourceBandBinary(m))),e.binary_sha256);assert.deepEqual(m.origin_bng,c.origin_bng);
    const fn=prepareSourceBandQuery(m),primitives=[];for(const p of m.patches){if(p.kind==='ruled-strip')for(let i=0;i<p.left.length-1;i++)primitives.push({kind:p.kind,points:[p.left[i],p.left[i+1],p.right[i],p.right[i+1]].map(n=>m.points[n])});else for(let i=0;i<p.indices.length-2;i++)primitives.push({kind:p.kind,points:p.indices.slice(i,i+3).map(n=>m.points[n])});}
    assert.equal(fn.primitives,e.native_primitives);let dh=0,dg=0,checks=0,seams=0;
    for(let j=0;j<32;j++)for(let i=0;i<32;i++){
      const x=-32+2*(i+.271828182846),y=-32+2*(j+.414213562373),a=fn.query(x,y);assert.ok(a);const b=evaluate(primitives[a.primitive],x,y);dh=Math.max(dh,Math.abs(a.height-b.height));dg=Math.max(dg,...a.gradient.map((v,k)=>Math.abs(v-b.gradient[k])));assert.equal(a.easting,c.origin_bng[0]+x);assert.equal(a.northing,c.origin_bng[1]+y);checks++;
    }
    assert.ok(dh<1e-8);assert.ok(dg<1e-8);
    for(let j=0;j<65;j++)for(let i=0;i<65;i++){const a=fn.query(i-32,j-32);assert.ok(a);assert.ok(Math.abs(a.height-reference.height[j][i])<=e.continuous_bound_m+1e-9);checks++;}
    const [x,y]=e.maximum_witness_xy,q=fn.query(x,y);assert.ok(q);const ix=Math.min(63,Math.max(0,Math.floor(x+32))),iy=Math.min(63,Math.max(0,Math.floor(y+32))),u=x+32-ix,v=y+32-iy,z=reference.height,s=(1-u)*(1-v)*z[iy][ix]+u*(1-v)*z[iy][ix+1]+(1-u)*v*z[iy+1][ix]+u*v*z[iy+1][ix+1];assert.ok(Math.abs(Math.abs(q.height-s)-e.continuous_maximum_m)<1e-8);
    for(let j=0;j<e.ny;j++)for(let i=0;i<e.nx;i++)for(const t of [0,.125,.25,.5,.75,.875,1]){
      if(i+1<e.nx){assert.ok(Math.abs(cell(m,e,i,j,1,t)-cell(m,e,i+1,j,0,t))<1e-8);seams++;}
      if(j+1<e.ny){assert.ok(Math.abs(cell(m,e,i,j,t,1)-cell(m,e,i,j+1,t,0))<1e-8);seams++;}
    }
    for(const [x,y] of [[-32,-32],[-32,32],[32,-32],[32,32]])assert.ok(fn.query(x,y));assert.equal(fn.query(32.01,0),null);assert.equal(fn.query(0,-32.01),null);
    rows.push({case_id:c.id,filename:e.filename,binary_sha256:e.binary_sha256,queries:checks,independent_height_difference_m:dh,independent_gradient_difference:dg,seam_height_pairs:seams,maximum_witness_verified:true,outside_rejected:true});
  }
  console.log(c.id+': all 147 native candidates, source-node bounds and C0 edge functions verified');
}
const scripts={};for(const p of ['frontend/scripts/audit-hybrid-source.mjs','frontend/src/compare/sourceRuledBandMath.ts','frontend/src/compare/principalRuledMath.ts'])scripts[p]=sha((await readFile(path.join(root,p),'utf8')).replaceAll('\r\n','\n'));
await writeFile(path.join(folder,'native-audit.json'),JSON.stringify({schema:'gugis-hybrid-source-native-audit-v1',report_sha256:sha(raw),scripts,models:rows,internal_queries:rows.length*1024,source_node_queries:rows.length*4225,total_queries:rows.reduce((s,r)=>s+r.queries,0),seam_height_pairs:rows.reduce((s,r)=>s+r.seam_height_pairs,0),scope:'Complete saved-source correctness, all original-node bounds, continuous maximum witnesses and both adjacent cell edge functions. C0 height continuity only; no C1 gradient or timing/heap/ArcGIS claim.'}));
